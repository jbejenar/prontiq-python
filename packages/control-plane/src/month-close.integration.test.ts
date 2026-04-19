import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ApiKeyRecord, UsageCounterRecord } from "@prontiq/shared";
import type Stripe from "stripe";
import { createMonthCloseService } from "./month-close.js";

const DDB_URL = process.env.DYNAMODB_TEST_URL ?? "http://localhost:8000";
const SUFFIX = `${Date.now()}-month-close`;
const KEYS_TABLE = `prontiq-month-close-keys-test-${SUFFIX}`;
const USAGE_TABLE = `prontiq-month-close-usage-test-${SUFFIX}`;

const ddbRaw = new DynamoDBClient({
  endpoint: DDB_URL,
  region: "ap-southeast-2",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});
const ddb = DynamoDBDocumentClient.from(ddbRaw);

before(async () => {
  await ddbRaw.send(
    new CreateTableCommand({
      TableName: KEYS_TABLE,
      AttributeDefinitions: [
        { AttributeName: "apiKeyHash", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "apiKeyHash", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  await ddbRaw.send(
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
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  for (const tableName of [KEYS_TABLE, USAGE_TABLE]) {
    for (let i = 0; i < 20; i += 1) {
      const described = await ddbRaw.send(new DescribeTableCommand({ TableName: tableName }));
      if (described.Table?.TableStatus === "ACTIVE") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
});

after(async () => {
  await ddbRaw.send(new DeleteTableCommand({ TableName: KEYS_TABLE }));
  await ddbRaw.send(new DeleteTableCommand({ TableName: USAGE_TABLE }));
});

function makeKey(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    active: true,
    apiKeyHash: "n".repeat(64),
    createdAt: "2026-04-18T00:00:00.000Z",
    keyPrefix: "pq_test_x",
    lastUsedAt: null,
    orgId: "org_test",
    ownerEmail: "ops@prontiq.dev",
    paymentOverdue: false,
    products: ["address"],
    quotaPerProduct: 10_000,
    rateLimit: 50,
    stripeCustomerId: "cus_test_123",
    stripeSubscriptionId: "sub_test_123",
    subscriptionItems: { address: "si_address_123" },
    tier: "starter",
    ...overrides,
  };
}

function makeUsage(overrides: Partial<UsageCounterRecord> = {}): UsageCounterRecord {
  return {
    apiKeyHash: "n".repeat(64),
    scope: "address#2026-04",
    lastPushedCumulativeCount: 0,
    requestCount: 0,
    ttl: 1_800_000_000,
    ...overrides,
  };
}

async function seedKey(record: ApiKeyRecord): Promise<void> {
  await ddb.send(new PutCommand({ TableName: KEYS_TABLE, Item: record }));
}

async function seedUsage(record: UsageCounterRecord | Record<string, unknown>): Promise<void> {
  await ddb.send(new PutCommand({ TableName: USAGE_TABLE, Item: record }));
}

async function seedRegistry(activeHashes: string[]): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: KEYS_TABLE,
      Item: {
        apiKeyHash: "REGISTRY#active-keys",
        activeHashes: new Set(activeHashes),
      },
    }),
  );
}

async function seedRetiredRegistry(activeHashes: string[]): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: KEYS_TABLE,
      Item: {
        apiKeyHash: "REGISTRY#retired-billing-keys",
        activeHashes: new Set(activeHashes),
      },
    }),
  );
}

function makeStripeRecorder(): {
  calls: Array<{
    event_name: string;
    identifier: string;
    payload: {
      request_count: string;
      stripe_customer_id: string;
    };
    timestamp: number;
  }>;
  stripe: Stripe;
} {
  const calls: Array<{
    event_name: string;
    identifier: string;
    payload: {
      request_count: string;
      stripe_customer_id: string;
    };
    timestamp: number;
  }> = [];
  return {
    calls,
    stripe: {
      billing: {
        meterEvents: {
          async create(input: {
            event_name: string;
            identifier: string;
            payload: {
              request_count: string;
              stripe_customer_id: string;
            };
            timestamp: number;
          }) {
            calls.push(input);
            return { id: `me_${calls.length}` };
          },
        },
      },
    } as unknown as Stripe,
  };
}

test("month close pushes remaining previous-month delta and closes the current-hash scope", async () => {
  const now = new Date("2026-05-01T00:30:00.000Z");
  const hash = "n".repeat(64);
  await seedKey(makeKey({ apiKeyHash: hash }));
  await seedRegistry([hash]);
  await seedUsage(makeUsage({
    apiKeyHash: hash,
    lastPushedCumulativeCount: 12,
    requestCount: 20,
    scope: "address#2026-04",
  }));

  const { calls, stripe } = makeStripeRecorder();
  const summary = await createMonthCloseService({
    ddb,
    keysTableName: KEYS_TABLE,
    logger: console,
    stripe,
    usageTableName: USAGE_TABLE,
  }).handleTick(now);

  assert.equal(summary.meterEventsSent, 1);
  assert.equal(summary.closedScopes, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    event_name: "prontiq_address_requests",
    identifier: `meter-${hash}-address-2026-04-20`,
    payload: {
      request_count: "8",
      stripe_customer_id: "cus_test_123",
    },
    timestamp: Math.floor(now.getTime() / 1000),
  });

  const usage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: hash, scope: "address#2026-04" },
    }),
  );
  assert.equal(usage.Item?.lastPushedCumulativeCount, 20);
  assert.equal(usage.Item?.closed, true);
});

test("month close closes a fully pushed previous-month scope without sending another Stripe event", async () => {
  const now = new Date("2026-05-01T00:30:00.000Z");
  const hash = "o".repeat(64);
  await seedKey(makeKey({ apiKeyHash: hash, stripeCustomerId: "cus_test_456" }));
  await seedRegistry([hash]);
  await seedUsage(makeUsage({
    apiKeyHash: hash,
    lastPushedCumulativeCount: 9,
    requestCount: 9,
    scope: "address#2026-04",
  }));

  const { calls, stripe } = makeStripeRecorder();
  const summary = await createMonthCloseService({
    ddb,
    keysTableName: KEYS_TABLE,
    logger: console,
    stripe,
    usageTableName: USAGE_TABLE,
  }).handleTick(now);

  assert.equal(summary.meterEventsSent, 0);
  assert.equal(summary.closedScopes, 1);
  assert.equal(calls.length, 0);

  const usage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: hash, scope: "address#2026-04" },
    }),
  );
  assert.equal(usage.Item?.closed, true);
  assert.equal(usage.Item?.lastPushedCumulativeCount, 9);
});

test("month close drains retired predecessor-only previous-month usage and closes the materialized current-hash scope", async () => {
  const now = new Date("2026-05-01T00:30:00.000Z");
  const predecessorHash = "p".repeat(64);
  const currentHash = "q".repeat(64);
  await seedKey(makeKey({
    apiKeyHash: currentHash,
    products: ["address"],
    subscriptionItems: {},
    tier: "free",
  }));
  await seedRetiredRegistry([currentHash]);
  await seedUsage(makeUsage({
    apiKeyHash: predecessorHash,
    lastPushedCumulativeCount: 0,
    requestCount: 14,
    scope: "address#2026-04",
  }));
  await seedUsage({
    apiKeyHash: predecessorHash,
    authValidUntil: 1_900_000_000,
    newHash: currentHash,
    scope: "REDIRECT",
    ttl: 1_900_000_000,
  });

  const { calls, stripe } = makeStripeRecorder();
  const summary = await createMonthCloseService({
    ddb,
    keysTableName: KEYS_TABLE,
    logger: console,
    stripe,
    usageTableName: USAGE_TABLE,
  }).handleTick(now);

  assert.equal(summary.meterEventsSent, 1);
  assert.equal(summary.closedScopes, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.payload.request_count, "14");

  const usage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: currentHash, scope: "address#2026-04" },
    }),
  );
  assert.equal(usage.Item?.lastPushedCumulativeCount, 14);
  assert.equal(usage.Item?.closed, true);
});

test("month close ignores predecessor watermark state, pushes from the current-hash root, and closes the scope", async () => {
  const now = new Date("2026-05-01T00:30:00.000Z");
  const predecessorHash = "t".repeat(64);
  const currentHash = "u".repeat(64);
  await seedKey(makeKey({
    apiKeyHash: currentHash,
    products: ["address"],
    subscriptionItems: {},
    tier: "free",
  }));
  await seedRetiredRegistry([currentHash]);
  await seedUsage(makeUsage({
    apiKeyHash: predecessorHash,
    lastPushedCumulativeCount: 14,
    requestCount: 14,
    scope: "address#2026-04",
  }));
  await seedUsage({
    apiKeyHash: predecessorHash,
    authValidUntil: 1_900_000_000,
    newHash: currentHash,
    scope: "REDIRECT",
    ttl: 1_900_000_000,
  });

  const { calls, stripe } = makeStripeRecorder();
  const summary = await createMonthCloseService({
    ddb,
    keysTableName: KEYS_TABLE,
    logger: console,
    stripe,
    usageTableName: USAGE_TABLE,
  }).handleTick(now);

  assert.equal(summary.meterEventsSent, 1);
  assert.equal(summary.closedScopes, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.payload.request_count, "14");

  const currentUsage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: currentHash, scope: "address#2026-04" },
    }),
  );
  assert.equal(currentUsage.Item?.lastPushedCumulativeCount, 14);
  assert.equal(currentUsage.Item?.closed, true);
});

test("month close rerun is idempotent once the previous-month scope is closed", async () => {
  const now = new Date("2026-05-01T00:30:00.000Z");
  const hash = "r".repeat(64);
  await seedKey(makeKey({ apiKeyHash: hash, stripeCustomerId: "cus_test_789" }));
  await seedRegistry([hash]);
  await seedUsage(makeUsage({
    apiKeyHash: hash,
    lastPushedCumulativeCount: 1,
    requestCount: 4,
    scope: "address#2026-04",
  }));

  const { calls, stripe } = makeStripeRecorder();
  const service = createMonthCloseService({
    ddb,
    keysTableName: KEYS_TABLE,
    logger: console,
    stripe,
    usageTableName: USAGE_TABLE,
  });

  const firstSummary = await service.handleTick(now);
  assert.equal(firstSummary.meterEventsSent, 1);
  assert.equal(firstSummary.closedScopes, 1);

  const secondSummary = await service.handleTick(new Date("2026-05-01T00:35:00.000Z"));
  assert.equal(secondSummary.meterEventsSent, 0);
  assert.equal(secondSummary.closedScopes, 0);
  assert.equal(calls.length, 1);
});

test("month close only finalizes the previous month and leaves current-month delta untouched", async () => {
  const now = new Date("2026-05-01T00:30:00.000Z");
  const hash = "s".repeat(64);
  await seedKey(makeKey({ apiKeyHash: hash, stripeCustomerId: "cus_test_999" }));
  await seedRegistry([hash]);
  await seedUsage(makeUsage({
    apiKeyHash: hash,
    lastPushedCumulativeCount: 3,
    requestCount: 8,
    scope: "address#2026-05",
  }));

  const { calls, stripe } = makeStripeRecorder();
  const summary = await createMonthCloseService({
    ddb,
    keysTableName: KEYS_TABLE,
    logger: console,
    stripe,
    usageTableName: USAGE_TABLE,
  }).handleTick(now);

  assert.equal(summary.meterEventsSent, 0);
  assert.equal(summary.closedScopes, 0);
  assert.equal(calls.length, 0);

  const usage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: hash, scope: "address#2026-05" },
    }),
  );
  assert.equal(usage.Item?.closed, undefined);
  assert.equal(usage.Item?.lastPushedCumulativeCount, 3);
});
