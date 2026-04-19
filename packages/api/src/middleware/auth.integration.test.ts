import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DynamoDBClient, CreateTableCommand, DeleteTableCommand, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { Hono } from "hono";
import type { ExecutionContext } from "hono";
import {
  auth,
  __resetRateLimiterForTesting,
  __setDdbForTesting,
  __setQuotaEmailEnqueuerForTesting,
} from "./auth.js";
import type { ApiKeyRecord, QuotaEmailTask, RedirectRecord, UsageCounterRecord } from "@prontiq/shared";
import { hashKey } from "@prontiq/shared";

const DDB_URL = process.env.DYNAMODB_TEST_URL ?? "http://localhost:8000";
const TEST_SUFFIX = Date.now().toString();
const KEYS_TABLE = `prontiq-keys-test-${TEST_SUFFIX}`;
const USAGE_TABLE = `prontiq-usage-test-${TEST_SUFFIX}`;
const NOW_SECONDS = Math.floor(Date.now() / 1000);
const CURRENT_MONTH = new Date().toISOString().slice(0, 7);

const client = new DynamoDBClient({
  endpoint: DDB_URL,
  region: "ap-southeast-2",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

const docClient = DynamoDBDocumentClient.from(client);

const app = new Hono();
app.use("/v1/*", auth());
app.get("/v1/address/autocomplete", (c) => c.json({ ok: true }));
app.get("/v1/address/enrich", (c) => c.json({ ok: true }));
app.get("/v1/address/reverse", (c) => c.json({ ok: true }));
app.get("/v1/abn/ping", (c) => c.json({ ok: true }));

function makeKeyRecord(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    apiKeyHash: "hash",
    keyPrefix: "pq_test_hash",
    ownerEmail: "owner@example.com",
    orgId: "org_123",
    tier: "free",
    products: ["address"],
    quotaPerProduct: 2,
    rateLimit: 10,
    active: true,
    paymentOverdue: false,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    createdAt: "2026-04-01T00:00:00.000Z",
    lastUsedAt: null,
    ...overrides,
  };
}

async function createTables(): Promise<void> {
  await client.send(
    new CreateTableCommand({
      TableName: KEYS_TABLE,
      AttributeDefinitions: [
        { AttributeName: "apiKeyHash", AttributeType: "S" },
        { AttributeName: "orgId", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "apiKeyHash", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "orgId-index",
          KeySchema: [{ AttributeName: "orgId", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );

  await client.send(
    new CreateTableCommand({
      TableName: USAGE_TABLE,
      AttributeDefinitions: [
        { AttributeName: "apiKeyHash", AttributeType: "S" },
        { AttributeName: "scope", AttributeType: "S" },
        { AttributeName: "newHash", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "apiKeyHash", KeyType: "HASH" },
        { AttributeName: "scope", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "newHash-redirect-index",
          KeySchema: [{ AttributeName: "newHash", KeyType: "HASH" }],
          Projection: { ProjectionType: "KEYS_ONLY" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );

  for (const tableName of [KEYS_TABLE, USAGE_TABLE]) {
    for (let i = 0; i < 20; i += 1) {
      const result = await client.send(new DescribeTableCommand({ TableName: tableName }));
      if (result.Table?.TableStatus === "ACTIVE") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function seedKey(rawKey: string, overrides: Partial<ApiKeyRecord> = {}): Promise<ApiKeyRecord> {
  const record = makeKeyRecord({
    apiKeyHash: hashKey(rawKey),
    ...overrides,
  });
  await docClient.send(
    new PutCommand({
      TableName: KEYS_TABLE,
      Item: record,
    }),
  );
  return record;
}

async function seedRedirect(rawKey: string, newHash: string): Promise<void> {
  await seedRedirectRecord({
    apiKeyHash: hashKey(rawKey),
    scope: "REDIRECT",
    newHash,
    authValidUntil: NOW_SECONDS + 300,
    ttl: NOW_SECONDS + 90 * 24 * 60 * 60,
  });
}

async function seedRedirectRecord(redirectRecord: RedirectRecord): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: USAGE_TABLE,
      Item: redirectRecord,
    }),
  );
}

async function seedExpiredRedirect(rawKey: string, newHash: string): Promise<void> {
  const redirectRecord: RedirectRecord = {
    apiKeyHash: hashKey(rawKey),
    scope: "REDIRECT",
    newHash,
    authValidUntil: NOW_SECONDS - 1,
    ttl: NOW_SECONDS + 90 * 24 * 60 * 60,
  };

  await seedRedirectRecord(redirectRecord);
}

async function seedUsage(record: UsageCounterRecord): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: USAGE_TABLE,
      Item: record,
    }),
  );
}

async function request(path: string, apiKey?: string): Promise<Response> {
  return requestWithExecutionContext(path, undefined, apiKey);
}

async function requestWithExecutionContext(
  path: string,
  executionCtx?: ExecutionContext,
  apiKey?: string,
): Promise<Response> {
  const headers = new Headers();
  if (apiKey) {
    headers.set("X-Api-Key", apiKey);
  }

  return app.request(
    new Request(`http://localhost${path}`, {
      headers,
      method: "GET",
    }),
    undefined,
    undefined,
    executionCtx,
  );
}

before(async () => {
  process.env.KEYS_TABLE_NAME = KEYS_TABLE;
  process.env.USAGE_TABLE_NAME = USAGE_TABLE;
  __setDdbForTesting(docClient);
  await createTables();
});

after(async () => {
  __setDdbForTesting(undefined);
  delete process.env.KEYS_TABLE_NAME;
  delete process.env.USAGE_TABLE_NAME;
  await client.send(new DeleteTableCommand({ TableName: KEYS_TABLE }));
  await client.send(new DeleteTableCommand({ TableName: USAGE_TABLE }));
});

beforeEach(async () => {
  __resetRateLimiterForTesting();
  __setQuotaEmailEnqueuerForTesting(undefined);
});

test("missing API key returns MISSING_API_KEY", async () => {
  const response = await request("/v1/address/autocomplete");
  const body = (await response.json()) as { error: { code: string } };

  assert.equal(response.status, 401);
  assert.equal(body.error.code, "MISSING_API_KEY");
});

test("valid free-tier key allows requests up to quota then rejects the next one", async () => {
  const rawKey = "pq_test_valid_key_123";
  await seedKey(rawKey, { quotaPerProduct: 2, rateLimit: 10, tier: "free" });

  const first = await request("/v1/address/autocomplete", rawKey);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("X-RateLimit-Remaining"), "1");

  const second = await request("/v1/address/autocomplete", rawKey);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("X-RateLimit-Remaining"), "0");

  const third = await request("/v1/address/autocomplete", rawKey);
  const body = (await third.json()) as { error: { code: string } };
  assert.equal(third.status, 429);
  assert.equal(body.error.code, "QUOTA_EXCEEDED");
});

test("growth-tier key can exceed quota and gets the overage header", async () => {
  const rawKey = "pq_test_growth_key_123";
  await seedKey(rawKey, {
    products: ["address", "abn"],
    quotaPerProduct: 1,
    rateLimit: 10,
    tier: "growth",
  });

  const first = await request("/v1/address/autocomplete", rawKey);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("X-RateLimit-Over"), null);

  const second = await request("/v1/address/autocomplete", rawKey);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("X-RateLimit-Over"), "true");
});

test("weighted address endpoint consumes multiple credits from the family quota", async () => {
  const rawKey = "pq_test_enrich_key_123";
  await seedKey(rawKey, { quotaPerProduct: 3, rateLimit: 10, tier: "free" });

  const first = await request("/v1/address/enrich", rawKey);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("X-RateLimit-Remaining"), "0");

  const second = await request("/v1/address/autocomplete", rawKey);
  const body = (await second.json()) as {
    error: { code: string; details?: { credits_required?: number } };
  };
  assert.equal(second.status, 429);
  assert.equal(body.error.code, "QUOTA_EXCEEDED");
  assert.equal(body.error.details?.credits_required, 1);
});

test("reverse endpoint rejects a free-tier request that would overflow remaining credits", async () => {
  const rawKey = "pq_test_reverse_key_123";
  await seedKey(rawKey, { quotaPerProduct: 2, rateLimit: 10, tier: "free" });

  const first = await request("/v1/address/autocomplete", rawKey);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("X-RateLimit-Remaining"), "1");

  const second = await request("/v1/address/reverse", rawKey);
  const body = (await second.json()) as {
    error: { code: string; details?: { credits_required?: number } };
  };
  assert.equal(second.status, 429);
  assert.equal(body.error.code, "QUOTA_EXCEEDED");
  assert.equal(body.error.details?.credits_required, 2);
});

test("burst limiter returns RATE_LIMITED with Retry-After", async () => {
  const rawKey = "pq_test_rate_key_123";
  await seedKey(rawKey, { quotaPerProduct: 10, rateLimit: 1, tier: "starter" });

  const first = await request("/v1/address/autocomplete", rawKey);
  assert.equal(first.status, 200);

  const second = await request("/v1/address/autocomplete", rawKey);
  const body = (await second.json()) as { error: { code: string } };
  assert.equal(second.status, 429);
  assert.equal(body.error.code, "RATE_LIMITED");
  assert.equal(second.headers.get("Retry-After"), "1");
});

test("product gating rejects disallowed products", async () => {
  const rawKey = "pq_test_product_key_123";
  await seedKey(rawKey, { products: ["address"], tier: "starter", quotaPerProduct: 10, rateLimit: 10 });

  const response = await request("/v1/abn/ping", rawKey);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(response.status, 403);
  assert.equal(body.error.code, "PRODUCT_NOT_ALLOWED");
});

test("enabled products without billing weights fail closed", async () => {
  const rawKey = "pq_test_abn_unrated_key_123";
  await seedKey(rawKey, { products: ["address", "abn"], tier: "starter", quotaPerProduct: 10, rateLimit: 10 });

  const response = await request("/v1/abn/ping", rawKey);
  const body = (await response.json()) as {
    error: { code: string; details?: { product?: string; reason?: string } };
  };
  assert.equal(response.status, 500);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.details?.product, "abn");
  assert.equal(body.error.details?.reason, "billing_endpoint_weights_missing");
});

test("unknown route inside a rated product fails closed", async () => {
  const rawKey = "pq_test_unknown_address_route_123";
  await seedKey(rawKey, { products: ["address"], tier: "starter", quotaPerProduct: 10, rateLimit: 10 });

  const response = await request("/v1/address/ping", rawKey);
  const body = (await response.json()) as {
    error: { code: string; details?: { product?: string; reason?: string } };
  };
  assert.equal(response.status, 500);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.details?.product, "address");
  assert.equal(body.error.details?.reason, "billing_endpoint_weights_missing");
});

test("payment overdue key authenticates and emits the response header", async () => {
  const rawKey = "pq_test_overdue_key_123";
  await seedKey(rawKey, {
    paymentOverdue: true,
    quotaPerProduct: 10,
    rateLimit: 10,
    tier: "starter",
  });

  const response = await request("/v1/address/autocomplete", rawKey);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Payment-Overdue"), "true");
});

test("redirect fallback authenticates with the new active key", async () => {
  const oldRawKey = "pq_test_old_key_123";
  const newRawKey = "pq_test_new_key_123";
  const newRecord = await seedKey(newRawKey, {
    quotaPerProduct: 10,
    rateLimit: 10,
    tier: "starter",
  });

  await seedRedirect(oldRawKey, newRecord.apiKeyHash);

  const response = await request("/v1/address/autocomplete", oldRawKey);
  assert.equal(response.status, 200);
});

test("redirect to inactive key is rejected", async () => {
  const oldRawKey = "pq_test_redirect_old_123";
  const newRawKey = "pq_test_redirect_new_123";
  const newRecord = await seedKey(newRawKey, {
    active: false,
    quotaPerProduct: 10,
    rateLimit: 10,
    tier: "starter",
  });

  await seedRedirect(oldRawKey, newRecord.apiKeyHash);

  const response = await request("/v1/address/autocomplete", oldRawKey);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(response.status, 401);
  assert.equal(body.error.code, "INVALID_API_KEY");
});

test("expired redirect is rejected", async () => {
  const oldRawKey = "pq_test_expired_old_123";
  const newRawKey = "pq_test_expired_new_123";
  const newRecord = await seedKey(newRawKey, {
    quotaPerProduct: 10,
    rateLimit: 10,
    tier: "starter",
  });

  await seedExpiredRedirect(oldRawKey, newRecord.apiKeyHash);

  const response = await request("/v1/address/autocomplete", oldRawKey);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(response.status, 401);
  assert.equal(body.error.code, "INVALID_API_KEY");
});

test("redirect to missing target is rejected", async () => {
  const oldRawKey = "pq_test_missing_target_old_123";
  await seedRedirect(oldRawKey, hashKey("pq_test_missing_target_new_123"));

  const response = await request("/v1/address/autocomplete", oldRawKey);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(response.status, 401);
  assert.equal(body.error.code, "INVALID_API_KEY");
});

test("self-loop redirect is rejected", async () => {
  const rawKey = "pq_test_redirect_loop_123";
  await seedRedirect(rawKey, hashKey(rawKey));

  const response = await request("/v1/address/autocomplete", rawKey);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(response.status, 401);
  assert.equal(body.error.code, "INVALID_API_KEY");
});

test("existing usage rows are incremented in place", async () => {
  const rawKey = "pq_test_usage_key_123";
  const record = await seedKey(rawKey, { quotaPerProduct: 5, rateLimit: 10, tier: "starter" });
  await seedUsage({
    apiKeyHash: record.apiKeyHash,
    scope: `address#${CURRENT_MONTH}`,
    requestCount: 4,
    ttl: NOW_SECONDS + 90 * 24 * 60 * 60,
    lastUsedAt: "2026-04-01T00:00:00.000Z",
    lastPushedCumulativeCount: 4,
  });

  const response = await request("/v1/address/autocomplete", rawKey);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-RateLimit-Remaining"), "0");
});

test("existing usage rows are incremented by endpoint credit cost", async () => {
  const rawKey = "pq_test_usage_weighted_key_123";
  const record = await seedKey(rawKey, { quotaPerProduct: 10, rateLimit: 10, tier: "starter" });
  await seedUsage({
    apiKeyHash: record.apiKeyHash,
    scope: `address#${CURRENT_MONTH}`,
    requestCount: 4,
    ttl: NOW_SECONDS + 90 * 24 * 60 * 60,
    lastUsedAt: "2026-04-01T00:00:00.000Z",
    lastPushedCumulativeCount: 4,
  });

  const response = await request("/v1/address/enrich", rawKey);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-RateLimit-Remaining"), "3");
});

test("80% threshold enqueues a warning quota email task", async () => {
  const enqueued: QuotaEmailTask[] = [];
  __setQuotaEmailEnqueuerForTesting(async (task) => {
    enqueued.push(task);
  });

  const rawKey = "pq_test_warning_threshold_key_123";
  const record = await seedKey(rawKey, { quotaPerProduct: 5, rateLimit: 10, tier: "starter" });
  await seedUsage({
    apiKeyHash: record.apiKeyHash,
    scope: `address#${CURRENT_MONTH}`,
    requestCount: 3,
    ttl: NOW_SECONDS + 90 * 24 * 60 * 60,
    lastUsedAt: "2026-04-01T00:00:00.000Z",
    lastPushedCumulativeCount: 3,
  });

  const response = await request("/v1/address/autocomplete", rawKey);
  assert.equal(response.status, 200);
  assert.deepEqual(enqueued, [
    {
      apiKeyHash: record.apiKeyHash,
      orgId: record.orgId,
      product: "address",
      scope: `address#${CURRENT_MONTH}`,
      threshold: "warning",
    },
  ]);
});

test("100% threshold enqueues both warning and limit quota email tasks when crossed in one request", async () => {
  const enqueued: QuotaEmailTask[] = [];
  __setQuotaEmailEnqueuerForTesting(async (task) => {
    enqueued.push(task);
  });

  const rawKey = "pq_test_limit_threshold_key_123";
  const record = await seedKey(rawKey, { quotaPerProduct: 3, rateLimit: 10, tier: "starter" });

  const response = await request("/v1/address/enrich", rawKey);
  assert.equal(response.status, 200);
  assert.deepEqual(enqueued, [
    {
      apiKeyHash: record.apiKeyHash,
      orgId: record.orgId,
      product: "address",
      scope: `address#${CURRENT_MONTH}`,
      threshold: "warning",
    },
    {
      apiKeyHash: record.apiKeyHash,
      orgId: record.orgId,
      product: "address",
      scope: `address#${CURRENT_MONTH}`,
      threshold: "limit",
    },
  ]);
});

test("warning threshold does not enqueue again after the warning email is already sent", async () => {
  const enqueued: QuotaEmailTask[] = [];
  __setQuotaEmailEnqueuerForTesting(async (task) => {
    enqueued.push(task);
  });

  const rawKey = "pq_test_warning_already_sent_key_123";
  const record = await seedKey(rawKey, { quotaPerProduct: 5, rateLimit: 10, tier: "starter" });
  await seedUsage({
    apiKeyHash: record.apiKeyHash,
    scope: `address#${CURRENT_MONTH}`,
    requestCount: 3,
    ttl: NOW_SECONDS + 90 * 24 * 60 * 60,
    warningEmailSent: true,
    lastUsedAt: "2026-04-01T00:00:00.000Z",
    lastPushedCumulativeCount: 3,
  });

  const response = await request("/v1/address/autocomplete", rawKey);
  assert.equal(response.status, 200);
  assert.deepEqual(enqueued, []);
});

test("fresh pending warning lease suppresses duplicate quota worker enqueue", async () => {
  const enqueued: QuotaEmailTask[] = [];
  __setQuotaEmailEnqueuerForTesting(async (task) => {
    enqueued.push(task);
  });

  const rawKey = "pq_test_warning_pending_key_123";
  const record = await seedKey(rawKey, { quotaPerProduct: 5, rateLimit: 10, tier: "starter" });
  await seedUsage({
    apiKeyHash: record.apiKeyHash,
    scope: `address#${CURRENT_MONTH}`,
    requestCount: 3,
    ttl: NOW_SECONDS + 90 * 24 * 60 * 60,
    warningEmailPendingAt: new Date().toISOString(),
    lastUsedAt: "2026-04-01T00:00:00.000Z",
    lastPushedCumulativeCount: 3,
  });

  const response = await request("/v1/address/autocomplete", rawKey);
  assert.equal(response.status, 200);
  assert.deepEqual(enqueued, []);
});

test("threshold crossing response does not await quota worker enqueue", async () => {
  let resolveEnqueue: (() => void) | undefined;
  const enqueued: QuotaEmailTask[] = [];
  __setQuotaEmailEnqueuerForTesting(
    (task) =>
      new Promise<void>((resolve) => {
        enqueued.push(task);
        resolveEnqueue = resolve;
      }),
  );

  const backgroundPromises: Promise<unknown>[] = [];
  const executionCtx: ExecutionContext = {
    passThroughOnException() {},
    props: undefined,
    waitUntil(promise: Promise<unknown>) {
      backgroundPromises.push(promise);
    },
  };

  const rawKey = "pq_test_background_enqueue_key_123";
  const record = await seedKey(rawKey, { quotaPerProduct: 5, rateLimit: 10, tier: "starter" });
  await seedUsage({
    apiKeyHash: record.apiKeyHash,
    scope: `address#${CURRENT_MONTH}`,
    requestCount: 3,
    ttl: NOW_SECONDS + 90 * 24 * 60 * 60,
    lastUsedAt: "2026-04-01T00:00:00.000Z",
    lastPushedCumulativeCount: 3,
  });

  const response = await requestWithExecutionContext("/v1/address/autocomplete", executionCtx, rawKey);
  assert.equal(response.status, 200);
  assert.equal(enqueued.length, 1);
  assert.equal(backgroundPromises.length, 1);

  resolveEnqueue?.();
  await Promise.all(backgroundPromises);
});
