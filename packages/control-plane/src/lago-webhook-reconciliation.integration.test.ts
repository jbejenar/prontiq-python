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
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  DynamoLagoWebhookLedger,
  createLagoWebhookReconciliationService,
  type LagoSubscriptionClient,
  type LagoSubscriptionSnapshot,
} from "./lago-webhook-reconciliation.js";
import {
  deriveLagoExternalSubscriptionIdForOrg,
  hashLagoWebhookPayload,
  type ApiKeyRecord,
  type CustomerRecord,
  type OrgEnvelopeRecord,
} from "@prontiq/shared";

const DDB_URL = process.env.DYNAMODB_TEST_URL ?? "http://localhost:8000";
const SUFFIX = Date.now().toString();
const KEYS_TABLE = `prontiq-lago-webhook-keys-test-${SUFFIX}`;
const USAGE_TABLE = `prontiq-lago-webhook-usage-test-${SUFFIX}`;
const CUSTOMERS_TABLE = `prontiq-lago-webhook-customers-test-${SUFFIX}`;
const AUDIT_TABLE = `prontiq-lago-webhook-audit-test-${SUFFIX}`;
const LEDGER_TABLE = `prontiq-lago-webhook-ledger-test-${SUFFIX}`;
const CUSTOMER_ID = "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A";
const ORG_ID = "org_lagoReconcile";
const LAGO_SUBSCRIPTION_ID = deriveLagoExternalSubscriptionIdForOrg(ORG_ID);
const API_KEY_HASH = "d".repeat(64);

const ddbRaw = new DynamoDBClient({
  endpoint: DDB_URL,
  region: "ap-southeast-2",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});
const ddb = DynamoDBDocumentClient.from(ddbRaw);

class FakeLagoClient implements LagoSubscriptionClient {
  snapshot: LagoSubscriptionSnapshot | null = {
    billingPeriodEndingAt: "2026-05-25T00:00:00Z",
    billingPeriodStartedAt: "2026-04-25T00:00:00Z",
    externalCustomerId: ORG_ID,
    externalSubscriptionId: LAGO_SUBSCRIPTION_ID,
    planCode: "payg",
    status: "active",
  };

  async getSubscription(): Promise<LagoSubscriptionSnapshot | null> {
    return this.snapshot;
  }
}

async function waitForTable(tableName: string): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    const described = await ddbRaw.send(new DescribeTableCommand({ TableName: tableName }));
    if (described.Table?.TableStatus === "ACTIVE") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`table ${tableName} did not become ACTIVE`);
}

async function createTables(): Promise<void> {
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
      TableName: LEDGER_TABLE,
      AttributeDefinitions: [{ AttributeName: "uniqueKey", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "uniqueKey", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  await Promise.all(
    [KEYS_TABLE, USAGE_TABLE, CUSTOMERS_TABLE, AUDIT_TABLE, LEDGER_TABLE].map(waitForTable),
  );
}

async function seedCustomer(): Promise<void> {
  const now = "2026-04-25T00:00:00.000Z";
  const customer: CustomerRecord = {
    customerId: CUSTOMER_ID,
    createdAt: now,
    lagoCustomerId: null,
    lagoExternalCustomerId: CUSTOMER_ID,
    orgId: ORG_ID,
    ownerEmail: "owner@example.com",
    status: "active",
    stripeCustomerId: null,
    updatedAt: now,
  };
  const envelope: OrgEnvelopeRecord = {
    apiKeyHash: `ORG#${ORG_ID}`,
    completedAt: now,
    customerId: CUSTOMER_ID,
    hasFirstKey: true,
    orgId: ORG_ID,
    ownerEmail: "owner@example.com",
    paymentOverdue: false,
    products: ["address"],
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    tier: "free",
  };
  const key: ApiKeyRecord = {
    active: true,
    apiKeyHash: API_KEY_HASH,
    keyId: "key_01TESTKEYIDLAGOWEBHOOK00001",
    createdAt: now,
    customerId: CUSTOMER_ID,
    keyPrefix: "pq_test_lago",
    lastUsedAt: null,
    orgId: ORG_ID,
    ownerEmail: "owner@example.com",
    paymentOverdue: false,
    products: ["address"],
    quotaPerProduct: 10_000,
    rateLimit: 10,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    tier: "free",
  };

  await ddb.send(new PutCommand({ TableName: CUSTOMERS_TABLE, Item: customer }));
  await ddb.send(new PutCommand({ TableName: KEYS_TABLE, Item: envelope }));
  await ddb.send(new PutCommand({ TableName: KEYS_TABLE, Item: key }));
  await ddb.send(
    new PutCommand({
      TableName: USAGE_TABLE,
      Item: {
        apiKeyHash: API_KEY_HASH,
        closed: false,
        lastPushedCumulativeCount: 0,
        requestCount: 5,
        scope: "address#period#2026-03-25_2026-04-25",
        ttl: 1_800_000_000,
      },
    }),
  );
}

before(async () => {
  await createTables();
  await seedCustomer();
});

after(async () => {
  await Promise.allSettled(
    [KEYS_TABLE, USAGE_TABLE, CUSTOMERS_TABLE, AUDIT_TABLE, LEDGER_TABLE].map((TableName) =>
      ddbRaw.send(new DeleteTableCommand({ TableName })),
    ),
  );
});

function makeService(lagoClient = new FakeLagoClient()) {
  return createLagoWebhookReconciliationService({
    auditTableName: AUDIT_TABLE,
    ddb,
    enabled: true,
    keysTableName: KEYS_TABLE,
    lagoClient,
    ledger: new DynamoLagoWebhookLedger({ ddb, tableName: LEDGER_TABLE }),
    logger: console,
    now: () => new Date("2026-04-25T00:00:00.000Z"),
    usageTableName: USAGE_TABLE,
  });
}

async function setPaidEntitlementForTerminationRegression(): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: KEYS_TABLE,
      Key: { apiKeyHash: `ORG#${ORG_ID}` },
      UpdateExpression: [
        "SET #tier = :tier",
        "#products = :products",
        "#paymentOverdue = :paymentOverdue",
        "#billingPeriodKey = :periodKey",
        "#lagoPaymentOverdueInvoiceId = :invoiceId",
      ].join(", "),
      ExpressionAttributeNames: {
        "#billingPeriodKey": "billingPeriodKey",
        "#lagoPaymentOverdueInvoiceId": "lagoPaymentOverdueInvoiceId",
        "#paymentOverdue": "paymentOverdue",
        "#products": "products",
        "#tier": "tier",
      },
      ExpressionAttributeValues: {
        ":invoiceId": "inv_existing_overdue",
        ":paymentOverdue": true,
        ":periodKey": "2026-04-25_2026-05-25",
        ":products": ["address"],
        ":tier": "payg",
      },
    }),
  );
  await ddb.send(
    new UpdateCommand({
      TableName: KEYS_TABLE,
      Key: { apiKeyHash: API_KEY_HASH },
      UpdateExpression: [
        "SET #tier = :tier",
        "#products = :products",
        "#quotaPerProduct = :quota",
        "#rateLimit = :rateLimit",
        "#paymentOverdue = :paymentOverdue",
        "#billingPeriodKey = :periodKey",
        "#lagoPaymentOverdueInvoiceId = :invoiceId",
      ].join(", "),
      ExpressionAttributeNames: {
        "#billingPeriodKey": "billingPeriodKey",
        "#lagoPaymentOverdueInvoiceId": "lagoPaymentOverdueInvoiceId",
        "#paymentOverdue": "paymentOverdue",
        "#products": "products",
        "#quotaPerProduct": "quotaPerProduct",
        "#rateLimit": "rateLimit",
        "#tier": "tier",
      },
      ExpressionAttributeValues: {
        ":invoiceId": "inv_existing_overdue",
        ":paymentOverdue": true,
        ":periodKey": "2026-04-25_2026-05-25",
        ":products": ["address"],
        ":quota": null,
        ":rateLimit": 100,
        ":tier": "payg",
      },
    }),
  );
  await ddb.send(
    new PutCommand({
      TableName: USAGE_TABLE,
      Item: {
        apiKeyHash: API_KEY_HASH,
        closed: false,
        lastPushedCumulativeCount: 0,
        requestCount: 8,
        scope: "address#period#2026-04-25_2026-05-25",
        ttl: 1_800_000_000,
      },
    }),
  );
}

test("ledger reclaims stale processing rows once and blocks concurrent retry duplicates", async () => {
  const ledger = new DynamoLagoWebhookLedger({ ddb, tableName: LEDGER_TABLE });
  const uniqueKey = "lago_evt_stale_processing_reclaim";
  const payload = { webhook_type: "subscription.started", customer: { external_id: ORG_ID } };
  const payloadHash = hashLagoWebhookPayload(payload);
  await ddb.send(
    new PutCommand({
      TableName: LEDGER_TABLE,
      Item: {
        uniqueKey,
        eventType: "subscription.started",
        firstSeenAt: "2026-04-24T23:59:00.000Z",
        lastSeenAt: "2026-04-24T23:59:14.000Z",
        payloadHash,
        status: "processing",
        ttl: 1_800_000_000,
      },
    }),
  );

  const [first, second] = await Promise.all([
    ledger.claim({
      customerId: ORG_ID,
      eventType: "subscription.started",
      now: new Date("2026-04-25T00:00:00.000Z"),
      payloadHash,
      uniqueKey,
    }),
    ledger.claim({
      customerId: ORG_ID,
      eventType: "subscription.started",
      now: new Date("2026-04-25T00:00:00.000Z"),
      payloadHash,
      uniqueKey,
    }),
  ]);

  assert.deepEqual([first.kind, second.kind].sort(), ["claimed", "in_progress"]);
  const row = await ddb.send(new GetCommand({ TableName: LEDGER_TABLE, Key: { uniqueKey } }));
  assert.equal(row.Item?.status, "processing");
  assert.equal(row.Item?.lastSeenAt, "2026-04-25T00:00:00.000Z");
  assert.equal(row.Item?.customerId, ORG_ID);
});

test("ledger reopens retryable terminal rows without waiting for the processing lease", async () => {
  const ledger = new DynamoLagoWebhookLedger({ ddb, tableName: LEDGER_TABLE });
  const uniqueKey = "lago_evt_retryable_reopen";
  const payload = {
    webhook_type: "invoice.payment_overdue",
    customer: { external_id: ORG_ID },
  };
  const payloadHash = hashLagoWebhookPayload(payload);
  await ddb.send(
    new PutCommand({
      TableName: LEDGER_TABLE,
      Item: {
        uniqueKey,
        completedAt: "2026-04-25T00:00:00.000Z",
        eventType: "invoice.payment_overdue",
        firstSeenAt: "2026-04-25T00:00:00.000Z",
        lastError: "temporary dependency failure",
        lastSeenAt: "2026-04-25T00:00:00.000Z",
        payloadHash,
        status: "failed_retryable",
        ttl: 1_800_000_000,
      },
    }),
  );

  const result = await ledger.claim({
    customerId: ORG_ID,
    eventType: "invoice.payment_overdue",
    now: new Date("2026-04-25T00:00:01.000Z"),
    payloadHash,
    uniqueKey,
  });

  assert.equal(result.kind, "claimed");
  const row = await ddb.send(new GetCommand({ TableName: LEDGER_TABLE, Key: { uniqueKey } }));
  assert.equal(row.Item?.status, "processing");
  assert.equal(row.Item?.completedAt, undefined);
  assert.equal(row.Item?.lastError, undefined);
});

test("subscription started updates local envelope, keys, ledger, audit, and prior period rows", async () => {
  await ddb.send(
    new UpdateCommand({
      TableName: KEYS_TABLE,
      Key: { apiKeyHash: API_KEY_HASH },
      UpdateExpression: "SET #billingPeriodKey = :previous",
      ExpressionAttributeNames: { "#billingPeriodKey": "billingPeriodKey" },
      ExpressionAttributeValues: { ":previous": "2026-03-25_2026-04-25" },
    }),
  );
  const payload = {
    webhook_type: "subscription.started",
    subscription: {
      external_customer_id: ORG_ID,
      external_id: LAGO_SUBSCRIPTION_ID,
    },
  };
  const uniqueKey = "lago_evt_subscription_started";
  const result = await makeService().handleWebhook({
    payload,
    payloadHash: hashLagoWebhookPayload(payload),
    uniqueKey,
  });

  assert.equal(result.status, "processed");
  const key = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: API_KEY_HASH } }),
  );
  assert.equal(key.Item?.tier, "payg");
  assert.equal(key.Item?.quotaPerProduct, null);
  assert.equal(key.Item?.billingPeriodKey, "2026-04-25_2026-05-25");
  assert.equal(key.Item?.lagoSubscriptionStatus, "active");

  const priorUsage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: API_KEY_HASH, scope: "address#period#2026-03-25_2026-04-25" },
    }),
  );
  assert.equal(priorUsage.Item?.closed, true);

  const duplicate = await makeService().handleWebhook({ payload, uniqueKey });
  assert.equal(duplicate.status, "duplicate");

  const audit = await ddb.send(
    new QueryCommand({
      TableName: AUDIT_TABLE,
      KeyConditionExpression: "orgId = :orgId",
      ExpressionAttributeValues: { ":orgId": ORG_ID },
    }),
  );
  assert.equal(
    audit.Items?.some((item) => item.action === "LAGO_WEBHOOK_RECONCILED"),
    true,
  );
});

test("invoice payment overdue and subsequent successful status update toggle local overdue state", async () => {
  const overduePayload = {
    webhook_type: "invoice.payment_overdue",
    invoice: {
      id: "inv_overdue_123",
      customer: { external_id: ORG_ID },
      subscription: { external_id: LAGO_SUBSCRIPTION_ID },
    },
  };
  const overdue = await makeService().handleWebhook({
    payload: overduePayload,
    uniqueKey: "lago_evt_payment_overdue",
  });
  assert.equal(overdue.status, "processed");
  const afterOverdue = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: API_KEY_HASH } }),
  );
  assert.equal(afterOverdue.Item?.paymentOverdue, true);
  assert.equal(afterOverdue.Item?.lagoPaymentOverdueInvoiceId, "inv_overdue_123");

  const paidPayload = {
    webhook_type: "invoice.payment_status_updated",
    invoice: {
      id: "inv_overdue_123",
      payment_overdue: false,
      payment_status: "succeeded",
      customer: { external_id: ORG_ID },
      subscription: { external_id: LAGO_SUBSCRIPTION_ID },
    },
  };
  const paid = await makeService().handleWebhook({
    payload: paidPayload,
    uniqueKey: "lago_evt_payment_recovered",
  });
  assert.equal(paid.status, "processed");
  const afterPaid = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: API_KEY_HASH } }),
  );
  assert.equal(afterPaid.Item?.paymentOverdue, false);
  assert.equal(afterPaid.Item?.lagoPaymentOverdueInvoiceId, null);
});

test("pending Lago transition records pending metadata without downgrading entitlements", async () => {
  await setPaidEntitlementForTerminationRegression();
  const lagoClient = new FakeLagoClient();
  lagoClient.snapshot = {
    billingPeriodEndingAt: "2026-05-25T00:00:00Z",
    billingPeriodStartedAt: "2026-04-25T00:00:00Z",
    downgradePlanDate: "2026-05-25",
    externalCustomerId: ORG_ID,
    externalSubscriptionId: LAGO_SUBSCRIPTION_ID,
    nextPlanCode: "free",
    planCode: "payg",
    previousPlanCode: "payg",
    status: "pending",
  };
  const payload = {
    webhook_type: "subscription.started",
    subscription: {
      external_customer_id: ORG_ID,
      external_id: LAGO_SUBSCRIPTION_ID,
    },
  };

  const result = await makeService(lagoClient).handleWebhook({
    payload,
    uniqueKey: "lago_evt_pending_transition_preserves_entitlements",
  });

  assert.equal(result.status, "processed");
  const key = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: API_KEY_HASH } }),
  );
  assert.equal(key.Item?.tier, "payg");
  assert.equal(key.Item?.quotaPerProduct, null);
  assert.equal(key.Item?.billingPeriodKey, "2026-04-25_2026-05-25");
  assert.equal(key.Item?.lagoSubscriptionStatus, "pending");
  assert.equal(key.Item?.lagoNextPlanCode, "free");

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${ORG_ID}` } }),
  );
  assert.equal(envelope.Item?.tier, "payg");
  assert.equal(envelope.Item?.lagoNextPlanCode, "free");
  assert.equal(envelope.Item?.lagoPlanTransitionStatus, "pending");
});

test("subscription terminated with active replacement snapshot preserves entitlements", async () => {
  await setPaidEntitlementForTerminationRegression();
  const lagoClient = new FakeLagoClient();
  lagoClient.snapshot = {
    billingPeriodEndingAt: "2026-06-25T00:00:00Z",
    billingPeriodStartedAt: "2026-05-25T00:00:00Z",
    externalCustomerId: ORG_ID,
    externalSubscriptionId: LAGO_SUBSCRIPTION_ID,
    planCode: "payg",
    status: "active",
  };
  const payload = {
    webhook_type: "subscription.terminated",
    subscription: {
      external_customer_id: ORG_ID,
      external_id: LAGO_SUBSCRIPTION_ID,
    },
  };

  const result = await makeService(lagoClient).handleWebhook({
    payload,
    uniqueKey: "lago_evt_terminated_active_replacement",
  });

  assert.equal(result.status, "processed");
  const key = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: API_KEY_HASH } }),
  );
  assert.equal(key.Item?.tier, "payg");
  assert.equal(key.Item?.quotaPerProduct, null);
  assert.equal(key.Item?.lagoSubscriptionStatus, "active");
  assert.equal(key.Item?.billingPeriodKey, "2026-05-25_2026-06-25");
});

test("subscription terminated with a returned terminated snapshot downgrades entitlements", async () => {
  await setPaidEntitlementForTerminationRegression();
  const lagoClient = new FakeLagoClient();
  lagoClient.snapshot = {
    billingPeriodEndingAt: "2026-05-25T00:00:00Z",
    billingPeriodStartedAt: "2026-04-25T00:00:00Z",
    externalCustomerId: ORG_ID,
    externalSubscriptionId: LAGO_SUBSCRIPTION_ID,
    planCode: "payg",
    status: "terminated",
  };
  const payload = {
    webhook_type: "subscription.terminated",
    subscription: {
      external_customer_id: ORG_ID,
      external_id: LAGO_SUBSCRIPTION_ID,
    },
  };

  const result = await makeService(lagoClient).handleWebhook({
    payload,
    uniqueKey: "lago_evt_subscription_terminated_returned_snapshot",
  });

  assert.equal(result.status, "processed");
  const key = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: API_KEY_HASH } }),
  );
  assert.equal(key.Item?.tier, "free");
  assert.equal(key.Item?.quotaPerProduct, 10_000);
  assert.equal(key.Item?.paymentOverdue, false);
  assert.equal(key.Item?.lagoPaymentOverdueInvoiceId, null);
  assert.equal(key.Item?.lagoPlanCode, "payg");
  assert.equal(key.Item?.lagoSubscriptionStatus, "terminated");
  assert.equal(key.Item?.billingPeriodKey, null);
  assert.equal(key.Item?.billingPeriodStartedAt, null);
  assert.equal(key.Item?.billingPeriodEndingAt, null);

  const priorUsage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: API_KEY_HASH, scope: "address#period#2026-04-25_2026-05-25" },
    }),
  );
  assert.equal(priorUsage.Item?.closed, true);
});

test("subscription terminated without a Lago snapshot downgrades entitlements", async () => {
  await setPaidEntitlementForTerminationRegression();
  const lagoClient = new FakeLagoClient();
  lagoClient.snapshot = null;
  const payload = {
    webhook_type: "subscription.terminated",
    subscription: {
      external_customer_id: ORG_ID,
      external_id: LAGO_SUBSCRIPTION_ID,
    },
  };

  const result = await makeService(lagoClient).handleWebhook({
    payload,
    uniqueKey: "lago_evt_subscription_terminated_missing_snapshot",
  });

  assert.equal(result.status, "processed");
  const key = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: API_KEY_HASH } }),
  );
  assert.equal(key.Item?.tier, "free");
  assert.equal(key.Item?.quotaPerProduct, 10_000);
  assert.equal(key.Item?.paymentOverdue, false);
  assert.equal(key.Item?.lagoPaymentOverdueInvoiceId, null);
  assert.equal(key.Item?.lagoPlanCode, "free");
  assert.equal(key.Item?.lagoSubscriptionStatus, "terminated");
  assert.equal(key.Item?.billingPeriodKey, null);
});
