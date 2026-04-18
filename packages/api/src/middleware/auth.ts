import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createMiddleware } from "hono/factory";
import {
  BILLING_ENDPOINTS,
  ERROR_CODES,
  PRODUCT_REGISTRY,
  getBillingEndpointsForProduct,
} from "@prontiq/shared";
import { hashKey } from "@prontiq/shared/keys";
import type { ApiKeyRecord, RedirectRecord, UsageCounterRecord } from "@prontiq/shared";

type RateLimitBucket = {
  lastRefillAtMs: number;
  tokens: number;
};

type UsageUpdateResult = {
  creditCost: number;
  overage: boolean;
  quotaExceeded: boolean;
  requestCount: number;
  resetAt: string;
};

let ddb: DynamoDBDocumentClient | undefined;

const rateLimitBuckets = new Map<string, RateLimitBucket>();
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
    ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return ddb;
}

function getKeysTableName(): string {
  return process.env.KEYS_TABLE_NAME ?? "prontiq-keys";
}

function getUsageTableName(): string {
  return process.env.USAGE_TABLE_NAME ?? "prontiq-usage";
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

function consumeRateLimitToken(
  apiKeyHash: string,
  rateLimit: number | null,
  nowMs: number = Date.now(),
): { allowed: boolean; retryAfterSeconds?: number } {
  if (rateLimit == null || !Number.isFinite(rateLimit) || rateLimit <= 0) {
    return { allowed: true };
  }

  const current = rateLimitBuckets.get(apiKeyHash) ?? {
    lastRefillAtMs: nowMs,
    tokens: rateLimit,
  };

  const elapsedSeconds = Math.max(0, (nowMs - current.lastRefillAtMs) / 1000);
  const refilledTokens = Math.min(rateLimit, current.tokens + elapsedSeconds * rateLimit);

  if (refilledTokens < 1) {
    rateLimitBuckets.set(apiKeyHash, {
      lastRefillAtMs: nowMs,
      tokens: refilledTokens,
    });
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - refilledTokens) / rateLimit)),
    };
  }

  rateLimitBuckets.set(apiKeyHash, {
    lastRefillAtMs: nowMs,
    tokens: refilledTokens - 1,
  });
  return { allowed: true };
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
    ReturnValues: "UPDATED_NEW",
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
      overage: limit != null && record.tier !== "free" && requestCount > limit,
      quotaExceeded: false,
      requestCount,
      resetAt,
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

export function __resetRateLimiterForTesting(): void {
  rateLimitBuckets.clear();
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

    const rateLimitResult = consumeRateLimitToken(record.apiKeyHash, record.rateLimit);
    if (!rateLimitResult.allowed) {
      c.header("Retry-After", String(rateLimitResult.retryAfterSeconds ?? 1));
      return c.json(
        {
          error: {
            ...ERROR_CODES.RATE_LIMITED,
            code: "RATE_LIMITED" as const,
            request_id: c.get("requestId"),
          },
        },
        429,
      );
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

    await next();
  });
}
