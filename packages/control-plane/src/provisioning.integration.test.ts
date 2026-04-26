/**
 * Provisioning service integration test (P1B.05 DoD).
 *
 * Exercises createProvisioningService() against a real DDB Local with a
 * stubbed Lago client. Validates:
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
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { createProvisioningService, type EmailSender } from "./provisioning.js";

const DDB_URL = process.env.DYNAMODB_TEST_URL ?? "http://localhost:8000";
const SUFFIX = Date.now().toString();
const KEYS_TABLE = `prontiq-keys-test-${SUFFIX}`;
const AUDIT_TABLE = `prontiq-audit-test-${SUFFIX}`;
const SUPPRESSIONS_TABLE = `prontiq-suppressions-test-${SUFFIX}`;
const CUSTOMERS_TABLE = `prontiq-customers-test-${SUFFIX}`;

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
  await ddbRaw.send(
    new CreateTableCommand({
      TableName: CUSTOMERS_TABLE,
      AttributeDefinitions: [
        { AttributeName: "orgId", AttributeType: "S" },
        { AttributeName: "customerId", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "orgId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "customerId-index",
          KeySchema: [{ AttributeName: "customerId", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
        },
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
  process.env.SUPPRESSIONS_TABLE_NAME = SUPPRESSIONS_TABLE;
  for (const tableName of [KEYS_TABLE, AUDIT_TABLE, SUPPRESSIONS_TABLE, CUSTOMERS_TABLE]) {
    for (let i = 0; i < 20; i++) {
      const { Table } = await ddbRaw.send(new DescribeTableCommand({ TableName: tableName }));
      if (Table?.TableStatus === "ACTIVE") break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

after(async () => {
  delete process.env.SUPPRESSIONS_TABLE_NAME;
  await ddbRaw.send(new DeleteTableCommand({ TableName: KEYS_TABLE }));
  await ddbRaw.send(new DeleteTableCommand({ TableName: AUDIT_TABLE }));
  await ddbRaw.send(new DeleteTableCommand({ TableName: SUPPRESSIONS_TABLE }));
  await ddbRaw.send(new DeleteTableCommand({ TableName: CUSTOMERS_TABLE }));
});

function makeLagoProvisioningClient(customerId: string) {
  const calls: { method: string; args: unknown }[] = [];
  return {
    calls,
    client: {
      async upsertCustomer(args: unknown) {
        calls.push({ method: "upsertCustomer", args });
      },
      async upsertSubscription(args: unknown) {
        calls.push({ method: "upsertSubscription", args });
      },
      async getSubscription(args: unknown) {
        calls.push({ method: "getSubscription", args });
        return {
          billingPeriodEndingAt: "2026-05-26T00:00:00.000Z",
          billingPeriodStartedAt: "2026-04-26T00:00:00.000Z",
          externalCustomerId: customerId,
          externalSubscriptionId: customerId.replace("pq_cust_", "pq_sub_"),
          planCode: "free",
          status: "active",
        };
      },
    },
  };
}

const noopEmail: EmailSender = async () => true;
const noopLogger = { error: () => {}, info: () => {}, warn: () => {} };

test("happy path: provisions envelope + audit row, then replay is no-op", async () => {
  const orgId = `org_int_${SUFFIX}_a`;
  const customerId = "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7B";
  const lago = makeLagoProvisioningClient(customerId);
  const service = createProvisioningService({
    ddb,
    keysTableName: KEYS_TABLE,
    customersTableName: CUSTOMERS_TABLE,
    auditTableName: AUDIT_TABLE,
    lagoClient: lago.client,
    lagoPaymentProviderCode: "stripe-main",
    sendWelcomeEmail: noopEmail,
    generateCustomerId: () => customerId,
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
  assert.equal(first.stripeCustomerId, null);
  assert.ok(first.orgEnvelope);
  assert.equal(first.orgEnvelope?.apiKeyHash, `ORG#${orgId}`);

  const envelopeRow = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.ok(envelopeRow.Item);
  assert.equal(envelopeRow.Item?.tier, "free");
  assert.equal(envelopeRow.Item?.hasFirstKey, false);
  assert.equal(envelopeRow.Item?.customerId, customerId);
  assert.equal(envelopeRow.Item?.lagoPlanCode, "free");
  assert.equal(
    envelopeRow.Item?.lagoSubscriptionExternalId,
    customerId.replace("pq_cust_", "pq_sub_"),
  );

  const customerRow = await ddb.send(
    new GetCommand({ TableName: CUSTOMERS_TABLE, Key: { orgId } }),
  );
  assert.equal(customerRow.Item?.customerId, customerId);
  assert.equal(customerRow.Item?.lagoExternalCustomerId, customerId);
  assert.equal(customerRow.Item?.stripeCustomerId, null);
  assert.equal(customerRow.Item?.status, "active");

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
  assert.equal(replay.stripeCustomerId, null);
  assert.deepEqual(
    lago.calls.map((call) => call.method),
    ["upsertCustomer", "getSubscription"],
    "replay should not call Lago again after bootstrap is complete",
  );

  const auditAfterReplay = await ddb.send(
    new QueryCommand({
      TableName: AUDIT_TABLE,
      KeyConditionExpression: "orgId = :o",
      ExpressionAttributeValues: { ":o": orgId },
    }),
  );
  assert.equal(auditAfterReplay.Count, 1, "no new audit rows on replay");
});

test("suppressed owner email skips the welcome email without blocking provisioning", async () => {
  const orgId = `org_int_${SUFFIX}_suppressed`;
  const customerId = "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7C";
  const lago = makeLagoProvisioningClient(customerId);
  let senderCalled = false;
  const service = createProvisioningService({
    ddb,
    keysTableName: KEYS_TABLE,
    customersTableName: CUSTOMERS_TABLE,
    auditTableName: AUDIT_TABLE,
    lagoClient: lago.client,
    lagoPaymentProviderCode: "stripe-main",
    sendWelcomeEmail: async () => {
      senderCalled = true;
      return true;
    },
    generateCustomerId: () => customerId,
    logger: noopLogger,
    sleep: async () => {},
  });

  await ddb.send(
    new PutCommand({
      TableName: SUPPRESSIONS_TABLE,
      Item: {
        email: "suppressed@example.com",
        reason: "complaint",
        lastEventAt: "2026-04-19T00:00:00.000Z",
      },
    }),
  );

  const result = await service.provisionOrg({
    orgId,
    ownerEmail: "suppressed@example.com",
    actorId: "user_test",
    source: "integration-test",
  });

  assert.equal(result.status, "created");
  assert.equal(result.emailSent, false);
  assert.equal(senderCalled, false);
});
