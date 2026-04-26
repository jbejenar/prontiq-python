/**
 * Clerk webhook handler — end-to-end integration test (P1B.05 PR 2 DoD).
 *
 * Wires the REAL provisioning service (with stubbed Lago/SES via DI)
 * against a REAL DDB Local. Confirms the handler boundary, the
 * provisioning state machine, and the DDB schema all agree.
 *
 * Run locally:
 *   docker run -p 8000:8000 amazon/dynamodb-local:2.5.2
 *   pnpm --filter @prontiq/webhooks test:integration
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
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import type { ClerkClient } from "@clerk/backend";
import { Webhook } from "svix";
import {
  createProvisioningService,
  type EmailSender,
  type LagoProvisioningClient,
} from "@prontiq/control-plane";
import { createClerkHandler } from "./clerk.js";

const DDB_URL = process.env.DYNAMODB_TEST_URL ?? "http://localhost:8000";
const SUFFIX = Date.now().toString();
const KEYS_TABLE = `prontiq-keys-test-${SUFFIX}`;
const AUDIT_TABLE = `prontiq-audit-test-${SUFFIX}`;
const CUSTOMERS_TABLE = `prontiq-customers-test-${SUFFIX}`;
const TEST_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

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
  for (const tableName of [KEYS_TABLE, AUDIT_TABLE, CUSTOMERS_TABLE]) {
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
  await ddbRaw.send(new DeleteTableCommand({ TableName: CUSTOMERS_TABLE }));
});

function makeLagoStub(callCounter: { value: number }): LagoProvisioningClient {
  const subscriptions = new Set<string>();
  return {
    async getSubscription(externalSubscriptionId) {
      if (!subscriptions.has(externalSubscriptionId)) {
        return null;
      }
      return {
        billingPeriodEndingAt: "2026-05-01T00:00:00Z",
        billingPeriodStartedAt: "2026-04-01T00:00:00Z",
        externalCustomerId: externalSubscriptionId.replace("pq_sub_", "pq_cust_"),
        externalSubscriptionId,
        planCode: "free",
        status: "active",
      };
    },
    async upsertCustomer() {
      callCounter.value += 1;
    },
    async upsertSubscription(input) {
      callCounter.value += 1;
      subscriptions.add(input.externalSubscriptionId);
    },
  };
}

const noopEmail: EmailSender = async () => true;

function makeClerkStub(email: string): ClerkClient {
  return {
    users: {
      async getUser(_userId: string) {
        return {
          primaryEmailAddressId: "idn_primary",
          emailAddresses: [
            {
              id: "idn_primary",
              emailAddress: email,
              verification: { status: "verified" },
            },
          ],
        };
      },
    },
  } as unknown as ClerkClient;
}

function signedEvent(payload: object): APIGatewayProxyEventV2 {
  const body = JSON.stringify(payload);
  const wh = new Webhook(TEST_SECRET);
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = new Date();
  const signature = wh.sign(msgId, timestamp, body);
  return {
    version: "2.0",
    routeKey: "POST /webhooks/clerk",
    rawPath: "/webhooks/clerk",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "svix-id": msgId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signature,
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "POST",
        path: "/webhooks/clerk",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "svix-webhooks/test",
      },
      requestId: "test",
      routeKey: "POST /webhooks/clerk",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body,
    isBase64Encoded: false,
  };
}

function decodeBody(result: APIGatewayProxyResultV2): {
  statusCode: number;
  body: Record<string, unknown>;
} {
  if (typeof result === "string") {
    return { statusCode: 200, body: JSON.parse(result) as Record<string, unknown> };
  }
  const sc = result.statusCode ?? 200;
  const raw = typeof result.body === "string" ? result.body : "{}";
  return { statusCode: sc, body: JSON.parse(raw) as Record<string, unknown> };
}

function adminEvent(orgId: string): APIGatewayProxyEventV2 {
  return signedEvent({
    type: "organizationMembership.created",
    data: {
      organization: { id: orgId, name: "Acme" },
      public_user_data: {
        user_id: "user_admin",
        // Identifier is deliberately a phone — handler must resolve
        // the real email via Clerk Backend API (Bug 2 contract).
        identifier: "+15551234567",
      },
      role: "org:admin",
      created_at: Date.now(),
    },
  });
}

test("end-to-end: signed admin membership writes envelope + audit row, replay is no-op", async () => {
  const orgId = `org_int_e2e_${SUFFIX}`;
  const counter = { value: 0 };
  const service = createProvisioningService({
    ddb,
    keysTableName: KEYS_TABLE,
    auditTableName: AUDIT_TABLE,
    customersTableName: CUSTOMERS_TABLE,
    lagoClient: makeLagoStub(counter),
    lagoPaymentProviderCode: "stripe-main",
    sendWelcomeEmail: noopEmail,
    logger: { error: () => {}, info: () => {}, warn: () => {} },
    sleep: async () => {},
  });
  const clerkClient = makeClerkStub("admin@example.com");
  const handler = createClerkHandler({
    service,
    webhookSecret: TEST_SECRET,
    clerkClient,
  });

  const first = await handler(adminEvent(orgId));
  const decoded1 = decodeBody(first);
  assert.equal(decoded1.statusCode, 200);
  assert.equal(decoded1.body.status, "created");

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.ok(envelope.Item, "envelope must be persisted");
  assert.equal(envelope.Item?.tier, "free");
  assert.equal(envelope.Item?.hasFirstKey, false);
  assert.equal(envelope.Item?.stripeCustomerId, null);
  assert.equal(envelope.Item?.ownerEmail, "admin@example.com");
  assert.match(envelope.Item?.customerId as string, /^pq_cust_[0-9A-HJKMNP-TV-Z]{26}$/);

  const customer = await ddb.send(new GetCommand({ TableName: CUSTOMERS_TABLE, Key: { orgId } }));
  assert.ok(customer.Item, "customer mapping must be persisted");
  assert.equal(customer.Item?.customerId, envelope.Item?.customerId);
  assert.equal(customer.Item?.lagoExternalCustomerId, envelope.Item?.customerId);
  assert.equal(customer.Item?.stripeCustomerId, null);
  assert.equal(customer.Item?.ownerEmail, "admin@example.com");
  assert.equal(customer.Item?.status, "active");

  const auditRows = await ddb.send(
    new QueryCommand({
      TableName: AUDIT_TABLE,
      KeyConditionExpression: "orgId = :o",
      ExpressionAttributeValues: { ":o": orgId },
    }),
  );
  assert.equal(auditRows.Count, 1, "exactly one audit row written");
  assert.equal(auditRows.Items?.[0]?.action, "ORG_PROVISIONED");
  assert.equal(auditRows.Items?.[0]?.actorId, "user_admin");

  // Svix redelivery: replay the same event. Must NOT bootstrap a second
  // Lago subscription or create a second audit row.
  const second = await handler(adminEvent(orgId));
  const decoded2 = decodeBody(second);
  assert.equal(decoded2.statusCode, 200);
  assert.equal(decoded2.body.status, "already_exists");
  assert.equal(counter.value, 2, "Lago bootstrap must not repeat on replay");

  const auditAfterReplay = await ddb.send(
    new QueryCommand({
      TableName: AUDIT_TABLE,
      KeyConditionExpression: "orgId = :o",
      ExpressionAttributeValues: { ":o": orgId },
    }),
  );
  assert.equal(auditAfterReplay.Count, 1, "no new audit rows on replay");
});

test("end-to-end: invalid signature → 401, no DDB writes, no Lago call", async () => {
  const orgId = `org_int_invalid_${SUFFIX}`;
  const counter = { value: 0 };
  const service = createProvisioningService({
    ddb,
    keysTableName: KEYS_TABLE,
    auditTableName: AUDIT_TABLE,
    customersTableName: CUSTOMERS_TABLE,
    lagoClient: makeLagoStub(counter),
    lagoPaymentProviderCode: "stripe-main",
    sendWelcomeEmail: noopEmail,
    logger: { error: () => {}, info: () => {}, warn: () => {} },
    sleep: async () => {},
  });
  const handler = createClerkHandler({
    service,
    webhookSecret: TEST_SECRET,
    clerkClient: makeClerkStub("admin@example.com"),
  });
  const event = adminEvent(orgId);
  event.body = (event.body as string) + " "; // tamper after signing
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 401);
  assert.equal(body.error, "invalid_signature");
  assert.equal(counter.value, 0);

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.equal(envelope.Item, undefined);
});

test("end-to-end: non-admin membership (org:member) → 200 zero side-effects", async () => {
  const orgId = `org_int_invitee_${SUFFIX}`;
  const counter = { value: 0 };
  const service = createProvisioningService({
    ddb,
    keysTableName: KEYS_TABLE,
    auditTableName: AUDIT_TABLE,
    customersTableName: CUSTOMERS_TABLE,
    lagoClient: makeLagoStub(counter),
    lagoPaymentProviderCode: "stripe-main",
    sendWelcomeEmail: noopEmail,
    logger: { error: () => {}, info: () => {}, warn: () => {} },
    sleep: async () => {},
  });
  const handler = createClerkHandler({
    service,
    webhookSecret: TEST_SECRET,
    clerkClient: makeClerkStub("admin@example.com"),
  });
  const event = signedEvent({
    type: "organizationMembership.created",
    data: {
      organization: { id: orgId },
      public_user_data: { user_id: "user_invitee", identifier: "invitee@example.com" },
      role: "org:member",
      created_at: Date.now(),
    },
  });
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.skipped, true);
  assert.equal(body.reason, "non_admin_membership");
  assert.equal(counter.value, 0);

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.equal(envelope.Item, undefined);
});
