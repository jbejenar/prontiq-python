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
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createBillingCronService } from "./billing-cron.js";
import type { ApiKeyRecord, UsageCounterRecord } from "@prontiq/shared";
import Stripe from "stripe";

const DDB_URL = process.env.DYNAMODB_TEST_URL ?? "http://localhost:8000";
const SUFFIX = Date.now().toString();
const KEYS_TABLE = `prontiq-billing-keys-test-${SUFFIX}`;
const USAGE_TABLE = `prontiq-billing-usage-test-${SUFFIX}`;

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
    apiKeyHash: "b".repeat(64),
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
    apiKeyHash: "b".repeat(64),
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

test("billing cron pushes address delta and advances lastPushedCumulativeCount", async () => {
  const now = new Date("2026-04-18T03:00:00.000Z");
  const hash = "b".repeat(64);
  await seedKey(makeKey({ apiKeyHash: hash }));
  await seedRegistry([hash]);
  await seedUsage(makeUsage({
    apiKeyHash: hash,
    lastPushedCumulativeCount: 10,
    requestCount: 25,
    scope: "address#2026-04",
  }));

  const { calls, stripe } = makeStripeRecorder();
  const summary = await createBillingCronService({
    ddb,
    keysTableName: KEYS_TABLE,
    logger: console,
    stripe,
    usageTableName: USAGE_TABLE,
  }).handleTick(now);

  assert.equal(summary.meterEventsSent, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    event_name: "prontiq_address_requests",
    identifier: `meter-${hash}-address-2026-04-25`,
    payload: {
      request_count: "15",
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
  assert.equal(usage.Item?.lastPushedCumulativeCount, 25);
  assert.equal(usage.Item?.pendingMeterEventIdentifier, undefined);
});

test("billing cron sums rotated hashes while gating on the current hash only", async () => {
  const now = new Date("2026-04-18T04:00:00.000Z");
  const oldHash = "a".repeat(64);
  const currentHash = "c".repeat(64);
  await seedKey(makeKey({ apiKeyHash: currentHash }));
  await seedRegistry([currentHash]);
  await seedUsage(makeUsage({
    apiKeyHash: oldHash,
    lastPushedCumulativeCount: 100,
    requestCount: 100,
    scope: "address#2026-04",
  }));
  await seedUsage({
    apiKeyHash: oldHash,
    authValidUntil: 1_900_000_000,
    newHash: currentHash,
    scope: "REDIRECT",
    ttl: 1_900_000_000,
  });
  await seedUsage(makeUsage({
    apiKeyHash: currentHash,
    lastPushedCumulativeCount: 0,
    requestCount: 50,
    scope: "address#2026-04",
  }));

  const { calls, stripe } = makeStripeRecorder();
  const service = createBillingCronService({
    ddb,
    keysTableName: KEYS_TABLE,
    logger: console,
    stripe,
    usageTableName: USAGE_TABLE,
  });

  await service.handleTick(now);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.payload?.request_count, "150");

  await ddb.send(
    new UpdateCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: currentHash, scope: "address#2026-04" },
      UpdateExpression: "SET #requestCount = :requestCount",
      ExpressionAttributeNames: {
        "#requestCount": "requestCount",
      },
      ExpressionAttributeValues: {
        ":requestCount": 75,
      },
    }),
  );

  await service.handleTick(new Date("2026-04-18T05:00:00.000Z"));
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.payload?.request_count, "25");

  const usage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: currentHash, scope: "address#2026-04" },
    }),
  );
  assert.equal(usage.Item?.lastPushedCumulativeCount, 175);
});

test("billing cron reuses the same pending meter event identifier after finalize failure", async () => {
  const now = new Date("2026-04-18T06:00:00.000Z");
  const hash = "d".repeat(64);
  await seedKey(makeKey({ apiKeyHash: hash, stripeCustomerId: "cus_retry_123" }));
  await seedRegistry([hash]);
  await seedUsage(makeUsage({
    apiKeyHash: hash,
    lastPushedCumulativeCount: 10,
    requestCount: 40,
    scope: "address#2026-04",
  }));

  const { calls, stripe } = makeStripeRecorder();
  let failFinalizeOnce = true;
  const flakyDdb = {
    async send(command: unknown) {
      if (
        failFinalizeOnce &&
        typeof command === "object" &&
        command !== null &&
        "input" in command &&
        typeof command.input === "object" &&
        command.input !== null &&
        "UpdateExpression" in command.input &&
        command.input.UpdateExpression === "SET #lastPushed = :target REMOVE #pendingId, #pendingTarget"
      ) {
        failFinalizeOnce = false;
        throw new Error("simulated finalize failure");
      }
      return ddb.send(command as never);
    },
  } as unknown as DynamoDBDocumentClient;

  const service = createBillingCronService({
    ddb: flakyDdb,
    keysTableName: KEYS_TABLE,
    logger: console,
    stripe,
    usageTableName: USAGE_TABLE,
  });

  await assert.rejects(() => service.handleTick(now), /simulated finalize failure/);
  assert.equal(calls.length, 1);

  const pending = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: hash, scope: "address#2026-04" },
    }),
  );
  assert.equal(pending.Item?.pendingMeterTargetCumulativeCount, 40);
  const pendingIdentifier = pending.Item?.pendingMeterEventIdentifier;
  assert.equal(typeof pendingIdentifier, "string");

  const retrySummary = await createBillingCronService({
    ddb,
    keysTableName: KEYS_TABLE,
    logger: console,
    stripe,
    usageTableName: USAGE_TABLE,
  }).handleTick(new Date("2026-04-18T06:10:00.000Z"));

  assert.equal(retrySummary.meterEventsSent, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.identifier, pendingIdentifier);
  assert.equal(calls[1]?.identifier, pendingIdentifier);
  assert.equal(calls[0]?.payload?.request_count, "30");
  assert.equal(calls[1]?.payload?.request_count, "30");

  const usage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: hash, scope: "address#2026-04" },
    }),
  );
  assert.equal(usage.Item?.lastPushedCumulativeCount, 40);
  assert.equal(usage.Item?.pendingMeterEventIdentifier, undefined);
});
