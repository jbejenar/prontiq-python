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
import { createQuotaEmailService } from "./quota-email.js";
import type {
  OrgEnvelopeRecord,
  QuotaEmailTask,
  SesSuppressionRecord,
  UsageCounterRecord,
} from "@prontiq/shared";
import { PLANS, QUOTA_WARNING_THRESHOLD_FRACTION } from "@prontiq/shared";

const DDB_URL = process.env.DYNAMODB_TEST_URL ?? "http://localhost:8000";
const SUFFIX = Date.now().toString();
const KEYS_TABLE = `prontiq-quota-email-keys-test-${SUFFIX}`;
const USAGE_TABLE = `prontiq-quota-email-usage-test-${SUFFIX}`;
const SUPPRESSIONS_TABLE = `prontiq-quota-email-suppressions-test-${SUFFIX}`;

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
      AttributeDefinitions: [{ AttributeName: "apiKeyHash", AttributeType: "S" }],
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
      ],
      KeySchema: [
        { AttributeName: "apiKeyHash", KeyType: "HASH" },
        { AttributeName: "scope", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  await ddbRaw.send(
    new CreateTableCommand({
      TableName: SUPPRESSIONS_TABLE,
      AttributeDefinitions: [{ AttributeName: "email", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  for (const tableName of [KEYS_TABLE, USAGE_TABLE, SUPPRESSIONS_TABLE]) {
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
  await ddbRaw.send(new DeleteTableCommand({ TableName: SUPPRESSIONS_TABLE }));
});

function makeEnvelope(overrides: Partial<OrgEnvelopeRecord> = {}): OrgEnvelopeRecord {
  return {
    apiKeyHash: "ORG#org_test",
    completedAt: "2026-04-19T00:00:00.000Z",
    hasFirstKey: true,
    ownerEmail: "owner@example.com",
    paymentOverdue: false,
    products: ["address"],
    stripeCustomerId: "cus_test_123",
    stripeSubscriptionId: "sub_test_123",
    subscriptionItems: { address: "si_test_123" },
    tier: "starter",
    ...overrides,
  };
}

function makeUsage(overrides: Partial<UsageCounterRecord> = {}): UsageCounterRecord {
  const starterQuota = PLANS.starter.quotaPerProduct ?? 0;
  const warningRequestCount = Math.ceil(starterQuota * QUOTA_WARNING_THRESHOLD_FRACTION);

  return {
    apiKeyHash: "hash_test_123",
    lastPushedCumulativeCount: 0,
    requestCount: warningRequestCount,
    scope: "address#2026-04",
    ttl: 1_800_000_000,
    ...overrides,
  };
}

async function seedEnvelope(record: OrgEnvelopeRecord): Promise<void> {
  await ddb.send(new PutCommand({ TableName: KEYS_TABLE, Item: record }));
}

async function seedUsage(record: UsageCounterRecord): Promise<void> {
  await ddb.send(new PutCommand({ TableName: USAGE_TABLE, Item: record }));
}

async function seedSuppression(record: SesSuppressionRecord): Promise<void> {
  await ddb.send(new PutCommand({ TableName: SUPPRESSIONS_TABLE, Item: record }));
}

const warningTask: QuotaEmailTask = {
  apiKeyHash: "hash_test_123",
  orgId: "org_test",
  product: "address",
  scope: "address#2026-04",
  threshold: "warning",
};

test("quota email worker sends warning email once and marks the scope sent", async () => {
  const sent: QuotaEmailTask[] = [];
  await seedEnvelope(makeEnvelope());
  await seedUsage(makeUsage());

  const service = createQuotaEmailService({
    ddb,
    keysTableName: KEYS_TABLE,
    logger: console,
    sendQuotaEmail: async ({ task }) => {
      sent.push(task);
      return true;
    },
    suppressionsTableName: SUPPRESSIONS_TABLE,
    usageTableName: USAGE_TABLE,
  });

  await service.processTask(warningTask);
  await service.processTask(warningTask);

  const usage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: warningTask.apiKeyHash, scope: warningTask.scope },
    }),
  );

  assert.equal(sent.length, 1);
  assert.equal(usage.Item?.warningEmailSent, true);
  assert.equal(usage.Item?.warningEmailPendingAt, undefined);
});

test("quota email worker finalizes suppressed warning emails without retry loops", async () => {
  await seedEnvelope(makeEnvelope({ apiKeyHash: "ORG#org_suppressed", ownerEmail: "suppressed@example.com" }));
  await seedUsage(makeUsage({ apiKeyHash: "hash_suppressed", scope: "address#2026-04" }));
  await seedSuppression({
    email: "suppressed@example.com",
    lastEventAt: "2026-04-19T00:00:00.000Z",
    reason: "complaint",
  });

  const service = createQuotaEmailService({
    ddb,
    keysTableName: KEYS_TABLE,
    logger: console,
    sendQuotaEmail: async () => {
      throw new Error("should not attempt send for suppressed email");
    },
    suppressionsTableName: SUPPRESSIONS_TABLE,
    usageTableName: USAGE_TABLE,
  });

  await service.processTask({
    ...warningTask,
    apiKeyHash: "hash_suppressed",
    orgId: "org_suppressed",
  });

  const usage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: "hash_suppressed", scope: "address#2026-04" },
    }),
  );

  assert.equal(usage.Item?.warningEmailSent, true);
  assert.equal(usage.Item?.warningEmailPendingAt, undefined);
});

test("expired bounce suppressions do not block quota emails before DynamoDB TTL cleanup", async () => {
  const sent: QuotaEmailTask[] = [];
  await seedEnvelope(makeEnvelope({ apiKeyHash: "ORG#org_expired_bounce", ownerEmail: "expired-bounce@example.com" }));
  await seedUsage(makeUsage({ apiKeyHash: "hash_expired_bounce", scope: "address#2026-04" }));
  await seedSuppression({
    bounceCount: 3,
    email: "expired-bounce@example.com",
    lastEventAt: "2026-01-01T00:00:00.000Z",
    reason: "hard_bounce",
    ttl: Math.floor(Date.now() / 1000) - 60,
  });

  const service = createQuotaEmailService({
    ddb,
    keysTableName: KEYS_TABLE,
    logger: console,
    sendQuotaEmail: async ({ task }) => {
      sent.push(task);
      return true;
    },
    suppressionsTableName: SUPPRESSIONS_TABLE,
    usageTableName: USAGE_TABLE,
  });

  await service.processTask({
    ...warningTask,
    apiKeyHash: "hash_expired_bounce",
    orgId: "org_expired_bounce",
  });

  const usage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: "hash_expired_bounce", scope: "address#2026-04" },
    }),
  );

  assert.equal(sent.length, 1);
  assert.equal(usage.Item?.warningEmailSent, true);
  assert.equal(usage.Item?.warningEmailPendingAt, undefined);
});

test("quota email worker releases pending lease when the sender fails", async () => {
  await seedEnvelope(makeEnvelope({ apiKeyHash: "ORG#org_retry" }));
  await seedUsage(makeUsage({ apiKeyHash: "hash_retry", scope: "address#2026-04" }));

  const service = createQuotaEmailService({
    ddb,
    keysTableName: KEYS_TABLE,
    logger: console,
    sendQuotaEmail: async () => false,
    suppressionsTableName: SUPPRESSIONS_TABLE,
    usageTableName: USAGE_TABLE,
  });

  await service.processTask({
    ...warningTask,
    apiKeyHash: "hash_retry",
    orgId: "org_retry",
  });

  const usage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: "hash_retry", scope: "address#2026-04" },
    }),
  );

  assert.equal(usage.Item?.warningEmailSent, undefined);
  assert.equal(usage.Item?.warningEmailPendingAt, undefined);
});

test("quota email worker reclaims a stale pending lease and sends the email", async () => {
  const sent: QuotaEmailTask[] = [];
  await seedEnvelope(makeEnvelope({ apiKeyHash: "ORG#org_stale" }));
  await seedUsage(
    makeUsage({
      apiKeyHash: "hash_stale",
      scope: "address#2026-04",
      warningEmailPendingAt: "2026-01-01T00:00:00.000Z",
    }),
  );

  const service = createQuotaEmailService({
    ddb,
    keysTableName: KEYS_TABLE,
    logger: console,
    sendQuotaEmail: async ({ task }) => {
      sent.push(task);
      return true;
    },
    suppressionsTableName: SUPPRESSIONS_TABLE,
    usageTableName: USAGE_TABLE,
  });

  await service.processTask({
    ...warningTask,
    apiKeyHash: "hash_stale",
    orgId: "org_stale",
  });

  const usage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: "hash_stale", scope: "address#2026-04" },
    }),
  );

  assert.equal(sent.length, 1);
  assert.equal(usage.Item?.warningEmailSent, true);
  assert.equal(usage.Item?.warningEmailPendingAt, undefined);
});
