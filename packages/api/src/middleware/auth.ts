import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import {
  BILLING_ENDPOINTS,
  ERROR_CODES,
  PRODUCT_REGISTRY,
  QUOTA_EMAIL_PENDING_LEASE_MINUTES,
  QUOTA_WARNING_THRESHOLD_FRACTION,
  createLogger,
  getBillingEndpointsForProduct,
} from "@prontiq/shared";
import { hashKey } from "@prontiq/shared";
import type { ApiKeyRecord, QuotaEmailTask, RedirectRecord, UsageCounterRecord } from "@prontiq/shared";
import { __resetRateLimiterForTesting as resetBurstRateLimiterForTesting, applyBurstRateLimit } from "./rate-limit.js";
import { captureDynamoClient } from "../tracing.js";

type UsageUpdateResult = {
  creditCost: number;
  limitEmailPendingAt?: string;
  limitEmailSent?: boolean;
  overage: boolean;
  quotaExceeded: boolean;
  requestCount: number;
  resetAt: string;
  warningEmailPendingAt?: string;
  warningEmailSent?: boolean;
};

let ddb: DynamoDBDocumentClient | undefined;
let lambda: LambdaClient | undefined;
let quotaEmailEnqueuerOverride: ((task: QuotaEmailTask) => Promise<void>) | undefined;
const logger = createLogger("api-auth");

const REDIRECT_SCOPE = "REDIRECT";
const USAGE_TTL_SECONDS = 90 * 24 * 60 * 60;

declare module "hono" {
  interface ContextVariableMap {
    apiKey: ApiKeyRecord;
    apiKeyHash: string;
    product: string;
  }
}

function getDdb(): DynamoDBDocumentClient {
  if (!ddb) {
    ddb = DynamoDBDocumentClient.from(captureDynamoClient(new DynamoDBClient({})));
  }
  return ddb;
}

function getLambda(): LambdaClient {
  if (!lambda) {
    lambda = new LambdaClient({});
  }
  return lambda;
}

function getKeysTableName(): string {
  return process.env.KEYS_TABLE_NAME ?? "prontiq-keys";
}

function getUsageTableName(): string {
  return process.env.USAGE_TABLE_NAME ?? "prontiq-usage";
}

function getQuotaEmailWorkerFunctionName(): string | null {
  return process.env.QUOTA_EMAIL_WORKER_FUNCTION_NAME ?? null;
}

function getMonthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

function getResetAt(now: Date): string {
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return nextMonth.toISOString();
}

function getUsageTtl(now: Date): number {
  return Math.floor(now.getTime() / 1000) + USAGE_TTL_SECONDS;
}

function resolveBillingEndpointKey(path: string, product: string): string | null {
  const segments = path.split("/").filter(Boolean);
  const endpointSegments = segments.slice(2);
  if (endpointSegments.length === 0) {
    return null;
  }

  if (product === "address") {
    if (endpointSegments[0] === "lookup" && endpointSegments[1] === "postcode") {
      return "address.lookup_postcode";
    }
    if (endpointSegments[0] === "lookup" && endpointSegments[1] === "suburb") {
      return "address.lookup_suburb";
    }
    if (
      endpointSegments[0] === "autocomplete" ||
      endpointSegments[0] === "validate" ||
      endpointSegments[0] === "enrich" ||
      endpointSegments[0] === "reverse"
    ) {
      return `address.${endpointSegments[0]}`;
    }
  }

  return null;
}

function productHasBillingDefinitions(product: string): boolean {
  return getBillingEndpointsForProduct(product).length > 0;
}

function getCreditCost(path: string, product: string): number | null {
  if (!productHasBillingDefinitions(product)) {
    return null;
  }
  const billingKey = resolveBillingEndpointKey(path, product);
  if (!billingKey) {
    return null;
  }
  const definition = BILLING_ENDPOINTS[billingKey];
  if (!definition || definition.product !== product) {
    return null;
  }
  return definition.creditCost;
}

function getWarningThreshold(limit: number): number {
  return Math.ceil(limit * QUOTA_WARNING_THRESHOLD_FRACTION);
}

function isFreshPendingLease(pendingAt: string | undefined, now: Date): boolean {
  if (!pendingAt) {
    return false;
  }
  const pendingDate = new Date(pendingAt);
  if (Number.isNaN(pendingDate.getTime())) {
    return false;
  }
  const cutoff = now.getTime() - QUOTA_EMAIL_PENDING_LEASE_MINUTES * 60 * 1000;
  return pendingDate.getTime() >= cutoff;
}

function getQuotaEmailTasks(
  record: ApiKeyRecord,
  product: string,
  scope: string,
  usageResult: UsageUpdateResult,
  now: Date,
): QuotaEmailTask[] {
  const limit = record.quotaPerProduct;
  if (limit == null) {
    return [];
  }

  const tasks: QuotaEmailTask[] = [];
  if (
    usageResult.requestCount >= getWarningThreshold(limit) &&
    usageResult.warningEmailSent !== true &&
    !isFreshPendingLease(usageResult.warningEmailPendingAt, now)
  ) {
    tasks.push({
      apiKeyHash: record.apiKeyHash,
      orgId: record.orgId,
      product,
      scope,
      threshold: "warning",
    });
  }
  if (
    usageResult.requestCount >= limit &&
    usageResult.limitEmailSent !== true &&
    !isFreshPendingLease(usageResult.limitEmailPendingAt, now)
  ) {
    tasks.push({
      apiKeyHash: record.apiKeyHash,
      orgId: record.orgId,
      product,
      scope,
      threshold: "limit",
    });
  }
  return tasks;
}

async function enqueueQuotaEmailTask(task: QuotaEmailTask): Promise<void> {
  if (quotaEmailEnqueuerOverride) {
    await quotaEmailEnqueuerOverride(task);
    return;
  }
  const functionName = getQuotaEmailWorkerFunctionName();
  if (!functionName) {
    return;
  }
  await getLambda().send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(task)),
    }),
  );
}

function getExecutionCtxWaitUntil(c: Context): ((promise: Promise<unknown>) => void) | null {
  try {
    return c.executionCtx.waitUntil.bind(c.executionCtx);
  } catch {
    return null;
  }
}

function enqueueQuotaEmailTasksInBackground(
  c: Context,
  record: ApiKeyRecord,
  product: string,
  scope: string,
  quotaEmailTasks: QuotaEmailTask[],
): void {
  const enqueuePromise = Promise.allSettled(
    quotaEmailTasks.map((task) => enqueueQuotaEmailTask(task)),
  ).then((enqueueResults) => {
    for (const [index, result] of enqueueResults.entries()) {
      if (result.status === "rejected") {
        logger.warn("Quota email enqueue failed", {
          apiKeyHash: record.apiKeyHash,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          orgId: record.orgId,
          product,
          scope,
          threshold: quotaEmailTasks[index]?.threshold,
        });
      }
    }
  });

  const waitUntil = getExecutionCtxWaitUntil(c);
  if (waitUntil) {
    waitUntil(enqueuePromise);
    return;
  }

  void enqueuePromise;
}

function setRateLimitHeaders(
  limit: number | null,
  remaining: number | null,
  resetAt: string,
  product: string,
  setHeader: (name: string, value: string) => void,
): void {
  setHeader("X-RateLimit-Product", product);
  setHeader("X-RateLimit-Reset", resetAt);
  if (limit != null) {
    setHeader("X-RateLimit-Limit", String(limit));
  }
  if (remaining != null) {
    setHeader("X-RateLimit-Remaining", String(remaining));
  }
}

async function getKeyRecord(apiKeyHash: string): Promise<ApiKeyRecord | undefined> {
  const result = await getDdb().send(
    new GetCommand({
      TableName: getKeysTableName(),
      Key: { apiKeyHash },
    }),
  );
  return result.Item as ApiKeyRecord | undefined;
}

async function getRedirectRecord(apiKeyHash: string): Promise<RedirectRecord | undefined> {
  const result = await getDdb().send(
    new GetCommand({
      TableName: getUsageTableName(),
      Key: {
        apiKeyHash,
        scope: REDIRECT_SCOPE,
      },
    }),
  );
  return result.Item as RedirectRecord | undefined;
}

async function resolveKeyRecord(rawApiKey: string, now: Date): Promise<ApiKeyRecord | undefined> {
  const presentedHash = hashKey(rawApiKey);
  const directRecord = await getKeyRecord(presentedHash);
  if (directRecord) {
    return directRecord;
  }

  const redirectRecord = await getRedirectRecord(presentedHash);
  if (!redirectRecord) {
    return undefined;
  }

  const nowEpochSeconds = Math.floor(now.getTime() / 1000);
  if (redirectRecord.authValidUntil <= nowEpochSeconds) {
    return undefined;
  }

  if (redirectRecord.newHash === presentedHash) {
    return undefined;
  }

  return getKeyRecord(redirectRecord.newHash);
}

async function incrementUsage(
  record: ApiKeyRecord,
  creditCost: number,
  product: string,
  now: Date,
): Promise<UsageUpdateResult> {
  const monthKey = getMonthKey(now);
  const resetAt = getResetAt(now);
  const usageScope = `${product}#${monthKey}`;
  const limit = record.quotaPerProduct;

  if (record.tier === "free" && limit != null && creditCost > limit) {
    return {
      creditCost,
      overage: false,
      requestCount: limit,
      quotaExceeded: true,
      resetAt,
    };
  }

  const command = new UpdateCommand({
    TableName: getUsageTableName(),
    Key: {
      apiKeyHash: record.apiKeyHash,
      scope: usageScope,
    },
    UpdateExpression:
      "SET #lastUsedAt = :now, #ttl = if_not_exists(#ttl, :ttl), #lastPushedCumulativeCount = if_not_exists(#lastPushedCumulativeCount, :zero) ADD #requestCount :creditCost",
    ExpressionAttributeNames: {
      "#lastPushedCumulativeCount": "lastPushedCumulativeCount",
      "#lastUsedAt": "lastUsedAt",
      "#requestCount": "requestCount",
      "#ttl": "ttl",
    },
    ExpressionAttributeValues: {
      ":creditCost": creditCost,
      ":now": now.toISOString(),
      ":ttl": getUsageTtl(now),
      ":zero": 0,
      ...(record.tier === "free" && limit != null
        ? { ":maxBeforeIncrement": Math.max(0, limit - creditCost) }
        : {}),
    },
    ...(record.tier === "free" && limit != null
      ? {
          ConditionExpression:
            "attribute_not_exists(#requestCount) OR #requestCount <= :maxBeforeIncrement",
        }
      : {}),
    ReturnValues: "ALL_NEW",
  });

  try {
    const result = await getDdb().send(command);
    const attributes = result.Attributes as Partial<UsageCounterRecord> | undefined;
    const requestCount = attributes?.requestCount;
    if (typeof requestCount !== "number") {
      throw new Error("requestCount missing from usage update result");
    }

    return {
      creditCost,
      limitEmailPendingAt: attributes?.limitEmailPendingAt,
      limitEmailSent: attributes?.limitEmailSent,
      overage: limit != null && record.tier !== "free" && requestCount > limit,
      quotaExceeded: false,
      requestCount,
      resetAt,
      warningEmailPendingAt: attributes?.warningEmailPendingAt,
      warningEmailSent: attributes?.warningEmailSent,
    };
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return {
        creditCost,
        overage: false,
        requestCount: limit ?? 0,
        quotaExceeded: true,
        resetAt,
      };
    }
    throw error;
  }
}

export function __setDdbForTesting(client: DynamoDBDocumentClient | undefined): void {
  ddb = client;
}

export function __setQuotaEmailEnqueuerForTesting(
  enqueuer: ((task: QuotaEmailTask) => Promise<void>) | undefined,
): void {
  quotaEmailEnqueuerOverride = enqueuer;
}

export function __resetRateLimiterForTesting(): void {
  resetBurstRateLimiterForTesting();
}

export function auth() {
  return createMiddleware(async (c, next) => {
    const rawApiKey = c.req.header("X-Api-Key");
    if (!rawApiKey) {
      return c.json(
        {
          error: {
            ...ERROR_CODES.MISSING_API_KEY,
            code: "MISSING_API_KEY" as const,
            request_id: c.get("requestId"),
          },
        },
        401,
      );
    }

    const now = new Date();
    const record = await resolveKeyRecord(rawApiKey, now);

    if (!record || !record.active) {
      return c.json(
        {
          error: {
            ...ERROR_CODES.INVALID_API_KEY,
            code: "INVALID_API_KEY" as const,
            request_id: c.get("requestId"),
          },
        },
        401,
      );
    }

    c.set("apiKey", record);
    c.set("apiKeyHash", record.apiKeyHash);

    if (record.paymentOverdue) {
      c.header("X-Payment-Overdue", "true");
    }

    const product = c.req.path.split("/")[2];
    if (!product || !PRODUCT_REGISTRY[product]) {
      await next();
      return;
    }

    c.set("product", product);

    if (!record.products.includes(product)) {
      return c.json(
        {
          error: {
            ...ERROR_CODES.PRODUCT_NOT_ALLOWED,
            code: "PRODUCT_NOT_ALLOWED" as const,
            request_id: c.get("requestId"),
            details: { product, allowed: record.products },
          },
        },
        403,
      );
    }

    const rateLimitResponse = applyBurstRateLimit(c, record);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const creditCost = getCreditCost(c.req.path, product);
    if (creditCost == null) {
      return c.json(
        {
          error: {
            ...ERROR_CODES.INTERNAL_ERROR,
            code: "INTERNAL_ERROR" as const,
            request_id: c.get("requestId"),
            details: {
              product,
              reason: "billing_endpoint_weights_missing",
            },
          },
        },
        500,
      );
    }
    const usageResult = await incrementUsage(record, creditCost, product, now);
    const usageScope = `${product}#${getMonthKey(now)}`;
    if (usageResult.quotaExceeded && record.quotaPerProduct != null) {
      setRateLimitHeaders(
        record.quotaPerProduct,
        0,
        usageResult.resetAt,
        product,
        c.header.bind(c),
      );
      return c.json(
        {
          error: {
            ...ERROR_CODES.QUOTA_EXCEEDED,
            code: "QUOTA_EXCEEDED" as const,
            request_id: c.get("requestId"),
            details: {
              credits_required: usageResult.creditCost,
              product,
              used: record.quotaPerProduct,
              limit: record.quotaPerProduct,
              resets_at: usageResult.resetAt,
            },
          },
        },
        429,
      );
    }

    const remaining =
      record.quotaPerProduct == null
        ? null
        : Math.max(0, record.quotaPerProduct - usageResult.requestCount);

    setRateLimitHeaders(
      record.quotaPerProduct,
      remaining,
      usageResult.resetAt,
      product,
      c.header.bind(c),
    );

    if (usageResult.overage) {
      c.header("X-RateLimit-Over", "true");
    }

    const quotaEmailTasks = getQuotaEmailTasks(record, product, usageScope, usageResult, now);
    if (quotaEmailTasks.length > 0) {
      enqueueQuotaEmailTasksInBackground(c, record, product, usageScope, quotaEmailTasks);
    }

    await next();
  });
}
