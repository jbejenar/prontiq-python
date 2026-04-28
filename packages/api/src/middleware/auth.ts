import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import {
  BILLING_ENDPOINTS,
  ERROR_CODES,
  PLANS,
  PRODUCT_REGISTRY,
  QUOTA_EMAIL_PENDING_LEASE_MINUTES,
  QUOTA_WARNING_THRESHOLD_FRACTION,
  billingUsageEventV2Schema,
  createLogger,
  deriveBillingUsageEventId,
  getBillingEndpointsForProduct,
} from "@prontiq/shared";
import { hashKey } from "@prontiq/shared";
import type {
  ApiKeyRecord,
  BillingEndpointDefinition,
  BillingUsageEventV1,
  BillingUsageEventV2,
  QuotaEmailTask,
  RedirectRecord,
  UsageCounterRecord,
} from "@prontiq/shared";
import {
  __resetRateLimiterForTesting as resetBurstRateLimiterForTesting,
  applyBurstRateLimit,
} from "./rate-limit.js";
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
let sqs: SQSClient | undefined;
let quotaEmailEnqueuerOverride: ((task: QuotaEmailTask) => Promise<void>) | undefined;
let billingEventEnqueuerOverride:
  | ((event: BillingUsageEventV1 | BillingUsageEventV2) => Promise<void>)
  | undefined;
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

function getSqs(): SQSClient {
  if (!sqs) {
    sqs = new SQSClient({ maxAttempts: 2 });
  }
  return sqs;
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

function getBillingEventsQueueUrl(): string | null {
  return process.env.BILLING_EVENTS_QUEUE_URL ?? null;
}

function billingEventsEnabled(): boolean {
  return process.env.BILLING_EVENTS_ENABLED === "true";
}

function counterPeriodSource(): "calendar" | "lago" {
  return process.env.COUNTER_PERIOD_SOURCE === "lago" ? "lago" : "calendar";
}

function getMonthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

function getResetAt(now: Date): string {
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return nextMonth.toISOString();
}

function getUsageScope(record: ApiKeyRecord, product: string, now: Date): string {
  if (counterPeriodSource() === "lago" && record.billingPeriodKey) {
    return `${product}#period#${record.billingPeriodKey}`;
  }
  return `${product}#${getMonthKey(now)}`;
}

function getUsageResetAt(record: ApiKeyRecord, now: Date): string {
  if (counterPeriodSource() === "lago" && record.billingPeriodEndingAt) {
    const parsed = new Date(record.billingPeriodEndingAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return getResetAt(now);
}

function getPlanEnforcementMode(
  record: ApiKeyRecord,
): "hard_cap" | "soft_overage" | "uncapped_tracked" {
  return (
    PLANS[record.tier]?.enforcementMode ?? (record.tier === "free" ? "hard_cap" : "soft_overage")
  );
}

function isHardCapped(record: ApiKeyRecord): boolean {
  return getPlanEnforcementMode(record) === "hard_cap";
}

function isSoftOverage(record: ApiKeyRecord): boolean {
  return getPlanEnforcementMode(record) === "soft_overage";
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

function getBillingEndpoint(
  path: string,
  product: string,
): {
  billingEndpointKey: string;
  definition: BillingEndpointDefinition;
} | null {
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
  return { billingEndpointKey: billingKey, definition };
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
  if (limit == null || limit <= 0) {
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

async function enqueueBillingEvent(event: BillingUsageEventV2): Promise<void> {
  if (billingEventEnqueuerOverride) {
    await billingEventEnqueuerOverride(event);
    return;
  }
  const queueUrl = getBillingEventsQueueUrl();
  if (!queueUrl) {
    throw new Error("BILLING_EVENTS_QUEUE_URL is required when billing events are enabled");
  }
  await getSqs().send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(event),
    }),
  );
}

function buildBillingEvent(
  c: Context,
  record: ApiKeyRecord,
  product: string,
  usageScope: string,
  usageResult: UsageUpdateResult,
  billingEndpointKey: string,
  definition: BillingEndpointDefinition,
  now: Date,
): BillingUsageEventV2 {
  const eventId = deriveBillingUsageEventId({
    apiKeyHash: record.apiKeyHash,
    billingEndpointKey,
    creditDelta: usageResult.creditCost,
    orgId: record.orgId,
    requestCountAfterIncrement: usageResult.requestCount,
    usageScope,
  });
  return billingUsageEventV2Schema.parse({
    version: 2,
    eventId,
    occurredAt: now.toISOString(),
    orgId: record.orgId,
    apiKeyHash: record.apiKeyHash,
    keyPrefix: record.keyPrefix,
    product,
    billingEndpointKey,
    meterEventName: definition.meterEventName,
    creditDelta: usageResult.creditCost,
    usageScope,
    requestCountAfterIncrement: usageResult.requestCount,
    source: {
      requestId: c.get("requestId") ?? "unknown",
      method: c.req.method,
      path: c.req.path,
      stage: process.env.PRONTIQ_STAGE ?? "unknown",
    },
  });
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
  const resetAt = getUsageResetAt(record, now);
  const usageScope = getUsageScope(record, product, now);
  const limit = record.quotaPerProduct;
  const hardCapped = isHardCapped(record);

  if (hardCapped && limit != null && creditCost > limit) {
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
    // `ADD #version :one` is the optimistic-concurrency sentinel
    // consumed by `rotateKey`'s usage-row migration in
    // `packages/control-plane/src/key-management.ts`. Every writer
    // that mutates a usage row MUST bump version; without this,
    // rotate's Delete CondExpr (which asserts `version = :rv`) would
    // miss races where a non-requestCount field is mutated. See
    // UsageCounterRecord.version doc comment.
    UpdateExpression:
      "SET #lastUsedAt = :now, #ttl = if_not_exists(#ttl, :ttl), #lastPushedCumulativeCount = if_not_exists(#lastPushedCumulativeCount, :zero) ADD #requestCount :creditCost, #version :one",
    ExpressionAttributeNames: {
      "#lastPushedCumulativeCount": "lastPushedCumulativeCount",
      "#lastUsedAt": "lastUsedAt",
      "#requestCount": "requestCount",
      "#ttl": "ttl",
      "#version": "version",
    },
    ExpressionAttributeValues: {
      ":creditCost": creditCost,
      ":now": now.toISOString(),
      ":one": 1,
      ":ttl": getUsageTtl(now),
      ":zero": 0,
      ...(hardCapped && limit != null
        ? { ":maxBeforeIncrement": Math.max(0, limit - creditCost) }
        : {}),
    },
    ...(hardCapped && limit != null
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
      overage: limit != null && isSoftOverage(record) && requestCount > limit,
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

export function __setBillingEventEnqueuerForTesting(
  enqueuer: ((event: BillingUsageEventV1 | BillingUsageEventV2) => Promise<void>) | undefined,
): void {
  billingEventEnqueuerOverride = enqueuer;
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

    const billingEndpoint = getBillingEndpoint(c.req.path, product);
    if (billingEndpoint == null) {
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
    if (billingEventsEnabled()) {
      if (!record.orgId || !getBillingEventsQueueUrl()) {
        logger.error("Billing event emission is enabled but orgId or queue URL is missing", {
          apiKeyHash: record.apiKeyHash,
          hasOrgId: Boolean(record.orgId),
          hasQueueUrl: Boolean(getBillingEventsQueueUrl()),
          orgId: record.orgId,
          product,
        });
        return c.json(
          {
            error: {
              ...ERROR_CODES.INTERNAL_ERROR,
              code: "INTERNAL_ERROR" as const,
              request_id: c.get("requestId"),
              details: {
                product,
                reason: "billing_event_configuration_missing",
              },
            },
          },
          500,
        );
      }
    }

    const usageResult = await incrementUsage(
      record,
      billingEndpoint.definition.creditCost,
      product,
      now,
    );
    const usageScope = getUsageScope(record, product, now);
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

    if (billingEventsEnabled()) {
      let event: BillingUsageEventV2 | undefined;
      try {
        event = buildBillingEvent(
          c,
          record,
          product,
          usageScope,
          usageResult,
          billingEndpoint.billingEndpointKey,
          billingEndpoint.definition,
          now,
        );
        await enqueueBillingEvent(event);
      } catch (error) {
        logger.error("Billing event enqueue failed after local usage increment", {
          apiKeyHash: record.apiKeyHash,
          billingEndpointKey: billingEndpoint.billingEndpointKey,
          creditDelta: usageResult.creditCost,
          error: error instanceof Error ? error.message : String(error),
          eventId: event?.eventId,
          meterEventName: billingEndpoint.definition.meterEventName,
          orgId: record.orgId,
          requestId: c.get("requestId"),
          requestCountAfterIncrement: usageResult.requestCount,
          usageScope,
        });
        return c.json(
          {
            error: {
              ...ERROR_CODES.INTERNAL_ERROR,
              code: "INTERNAL_ERROR" as const,
              request_id: c.get("requestId"),
              details: {
                product,
                reason: "billing_event_enqueue_failed",
              },
            },
          },
          500,
        );
      }
    }

    const quotaEmailTasks = getQuotaEmailTasks(record, product, usageScope, usageResult, now);
    if (quotaEmailTasks.length > 0) {
      enqueueQuotaEmailTasksInBackground(c, record, product, usageScope, quotaEmailTasks);
    }

    await next();
  });
}
