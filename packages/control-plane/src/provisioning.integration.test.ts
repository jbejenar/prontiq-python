/**
 * Provisioning service integration test (P1B.05 DoD).
 *
 * Exercises createProvisioningService() against a real DDB Local with a
 * stubbed Stripe client. Validates:
 *   - Happy path writes the ORG envelope and audit row atomically
 *   - Replay against the existing envelope returns already_exists with
 *     zero side effects
 *   - The ORG envelope is keyed `ORG#{orgId}` per ARCH §5.5.1
 *   - The audit row matches the schema (orgId PK, timestamp#eventId SK)
 *
 * Run locally:
 *   docker run -p 8000:8000 amazon/dynamodb-local:2.5.2
 *   pnpm --filter @prontiq/control-plane test:integration
 *
 * In CI: runs as a service container (see .github/workflows/ci.yml).
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type Stripe from "stripe";
import { createProvisioningService, type EmailSender } from "./provisioning.js";

const DDB_URL = process.env.DYNAMODB_TEST_URL ?? "http://localhost:8000";
const SUFFIX = Date.now().toString();
const KEYS_TABLE = `prontiq-keys-test-${SUFFIX}`;
const AUDIT_TABLE = `prontiq-audit-test-${SUFFIX}`;

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
  await ddbRaw.send(
    new CreateTableCommand({
      TableName: AUDIT_TABLE,
      AttributeDefinitions: [
        { AttributeName: "orgId", AttributeType: "S" },
        { AttributeName: "timestamp#eventId", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "orgId", KeyType: "HASH" },
        { AttributeName: "timestamp#eventId", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  for (const tableName of [KEYS_TABLE, AUDIT_TABLE]) {
    for (let i = 0; i < 20; i++) {
      const { Table } = await ddbRaw.send(new DescribeTableCommand({ TableName: tableName }));
      if (Table?.TableStatus === "ACTIVE") break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

after(async () => {
  await ddbRaw.send(new DeleteTableCommand({ TableName: KEYS_TABLE }));
  await ddbRaw.send(new DeleteTableCommand({ TableName: AUDIT_TABLE }));
});

function makeStripeStub(idCounter: { value: number }): {
  stripe: Stripe;
  calls: number;
} {
  let calls = 0;
  const stripe = {
    customers: {
      async create() {
        calls += 1;
        idCounter.value += 1;
        return { id: `cus_int_${idCounter.value}` };
      },
    },
  } as unknown as Stripe;
  return {
    stripe,
    get calls() {
      return calls;
    },
  } as { stripe: Stripe; calls: number };
}

const noopEmail: EmailSender = async () => true;
const noopLogger = { error: () => {}, warn: () => {} };

test("happy path: provisions envelope + audit row, then replay is no-op", async () => {
  const orgId = `org_int_${SUFFIX}_a`;
  const counter = { value: 0 };
  const { stripe } = makeStripeStub(counter);
  const service = createProvisioningService({
    ddb,
    keysTableName: KEYS_TABLE,
    auditTableName: AUDIT_TABLE,
    stripe,
    sendWelcomeEmail: noopEmail,
    logger: noopLogger,
    sleep: async () => {},
  });

  const first = await service.provisionOrg({
    orgId,
    ownerEmail: "owner@example.com",
    actorId: "user_test",
    source: "integration-test",
  });
  assert.equal(first.status, "created");
  assert.equal(first.stripeCustomerId, "cus_int_1");
  assert.ok(first.orgEnvelope);
  assert.equal(first.orgEnvelope?.apiKeyHash, `ORG#${orgId}`);

  const envelopeRow = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.ok(envelopeRow.Item);
  assert.equal(envelopeRow.Item?.tier, "free");
  assert.equal(envelopeRow.Item?.hasFirstKey, false);

  const auditRows = await ddb.send(
    new QueryCommand({
      TableName: AUDIT_TABLE,
      KeyConditionExpression: "orgId = :o",
      ExpressionAttributeValues: { ":o": orgId },
    }),
  );
  assert.equal(auditRows.Count, 1);
  assert.equal(auditRows.Items?.[0]?.action, "ORG_PROVISIONED");
  assert.equal(auditRows.Items?.[0]?.actorId, "user_test");

  const replay = await service.provisionOrg({
    orgId,
    ownerEmail: "owner@example.com",
    actorId: "user_test",
    source: "integration-test",
  });
  assert.equal(replay.status, "already_exists");
  assert.equal(replay.stripeCustomerId, "cus_int_1");
  assert.equal(counter.value, 1, "Stripe must not be called on replay");

  const auditAfterReplay = await ddb.send(
    new QueryCommand({
      TableName: AUDIT_TABLE,
      KeyConditionExpression: "orgId = :o",
      ExpressionAttributeValues: { ":o": orgId },
    }),
  );
  assert.equal(auditAfterReplay.Count, 1, "no new audit rows on replay");
});
