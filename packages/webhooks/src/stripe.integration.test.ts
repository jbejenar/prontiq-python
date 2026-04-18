import test, { before, after } from "node:test";
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
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { createStripeBillingService, type BillingEmailSender } from "@prontiq/control-plane";
import type { ApiKeyRecord, ApiKeySubscriptionItems, Tier, UsageCounterRecord } from "@prontiq/shared";
import Stripe from "stripe";
import { createStripeHandler } from "./stripe.js";

const DDB_URL = process.env.DYNAMODB_TEST_URL ?? "http://localhost:8000";
const SUFFIX = Date.now().toString();
const KEYS_TABLE = `prontiq-keys-test-${SUFFIX}`;
const USAGE_TABLE = `prontiq-usage-test-${SUFFIX}`;
const AUDIT_TABLE = `prontiq-audit-test-${SUFFIX}`;
const SUPPRESSIONS_TABLE = `prontiq-suppressions-test-${SUFFIX}`;
const TEST_SECRET = "whsec_test_stripe_secret";

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
      TableName: SUPPRESSIONS_TABLE,
      AttributeDefinitions: [{ AttributeName: "email", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  for (const tableName of [KEYS_TABLE, USAGE_TABLE, AUDIT_TABLE, SUPPRESSIONS_TABLE]) {
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
  await ddbRaw.send(new DeleteTableCommand({ TableName: AUDIT_TABLE }));
  await ddbRaw.send(new DeleteTableCommand({ TableName: SUPPRESSIONS_TABLE }));
});

interface FakeStripeState {
  customerEmail: string;
  meteredStripeProducts?: Array<{
    prontiqProduct?: string | null;
    stripeProductId?: string;
    subscriptionItemId?: string;
  }>;
  meteredProducts?: string[];
  orgId: string;
  subscriptionId: string;
  tier: Tier;
  subscriptionStatus: "active" | "past_due" | "canceled";
}

function makeStripeClient(): Stripe {
  return new Stripe("sk_test_123");
}

function makeFakeStripe(state: FakeStripeState): Stripe {
  const meteredItems = (state.meteredStripeProducts ??
    (state.meteredProducts ?? ["address"]).map((product) => ({
      prontiqProduct: product,
      stripeProductId: `prod_${product}_test`,
      subscriptionItemId: `si_${product}_1`,
    }))).map((item, index) => ({
    id: item.subscriptionItemId ?? `si_metered_${index + 1}`,
    price: {
      id: `price_metered_${item.prontiqProduct ?? index}`,
      metadata: {},
      product: {
        id: item.stripeProductId ?? `prod_metered_${index + 1}`,
        metadata: item.prontiqProduct == null ? {} : { prontiqProduct: item.prontiqProduct },
      },
    },
  }));
  return {
    customers: {
      async retrieve(customerId: string) {
        return {
          deleted: false,
          email: state.customerEmail,
          id: customerId,
          metadata: { orgId: state.orgId },
        };
      },
    },
    subscriptions: {
      async retrieve(subscriptionId: string) {
        return {
          customer: "cus_test_1",
          id: subscriptionId,
          items: {
            data: [
              {
                id: "si_plan_1",
                price: {
                  id: `price_${state.tier}_test`,
                  metadata: { prontiqTier: state.tier },
                  product: {
                    id: "prod_plan_test",
                    metadata: {},
                  },
                },
              },
              ...meteredItems,
            ],
          },
          status: state.subscriptionStatus,
        };
      },
    },
  } as unknown as Stripe;
}

function signedEvent(payload: object): APIGatewayProxyEventV2 {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({
    cryptoProvider: Stripe.createNodeCryptoProvider(),
    payload: body,
    scheme: "v1",
    secret: TEST_SECRET,
    signature: "",
    timestamp: Math.floor(Date.now() / 1000),
  });
  return {
    version: "2.0",
    routeKey: "POST /webhooks/stripe",
    rawPath: "/webhooks/stripe",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "stripe-signature": header,
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "POST",
        path: "/webhooks/stripe",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "stripe/test",
      },
      requestId: "test",
      routeKey: "POST /webhooks/stripe",
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

async function seedKey(record: ApiKeyRecord): Promise<void> {
  await ddb.send(new PutCommand({ TableName: KEYS_TABLE, Item: record }));
}

async function seedUsage(record: UsageCounterRecord): Promise<void> {
  await ddb.send(new PutCommand({ TableName: USAGE_TABLE, Item: record }));
}

async function seedEnvelope(input: {
  orgId: string;
  ownerEmail: string;
  stripeCustomerId: string;
  tier?: Tier;
  paymentOverdue?: boolean;
  products?: string[];
  stripeSubscriptionId?: string | null;
  subscriptionItems?: ApiKeySubscriptionItems;
  hasFirstKey?: boolean;
}): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: KEYS_TABLE,
    Item: {
      apiKeyHash: `ORG#${input.orgId}`,
      stripeCustomerId: input.stripeCustomerId,
      ownerEmail: input.ownerEmail,
      tier: input.tier ?? "free",
      products: input.products ?? ["address"],
      paymentOverdue: input.paymentOverdue ?? false,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      subscriptionItems: input.subscriptionItems ?? {},
      hasFirstKey: input.hasFirstKey ?? false,
      completedAt: "2026-04-01T00:00:00.000Z",
    },
  }));
}

async function listAuditRows(orgId: string): Promise<Record<string, unknown>[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: AUDIT_TABLE,
      KeyConditionExpression: "orgId = :orgId",
      ExpressionAttributeValues: { ":orgId": orgId },
    }),
  );
  return result.Items ?? [];
}

function buildHandler(state: FakeStripeState, paymentEmailSender: BillingEmailSender = async () => true) {
  const service = createStripeBillingService({
    auditTableName: AUDIT_TABLE,
    ddb,
    keysTableName: KEYS_TABLE,
    logger: { error: () => {}, info: () => {}, warn: () => {} },
    sendPaymentFailureEmail: paymentEmailSender,
    stripe: makeFakeStripe(state),
    suppressionsTableName: SUPPRESSIONS_TABLE,
    usageTableName: USAGE_TABLE,
  });
  return createStripeHandler({
    webhookSecret: TEST_SECRET,
    stripeClient: makeStripeClient(),
    service,
  });
}

test("checkout.session.completed upgrades all org keys, resets existing usage flags, and duplicate replay is no-op", async () => {
  const orgId = `org_stripe_checkout_${SUFFIX}`;
  const apiKeyHash = `hash_checkout_${SUFFIX}`;
  await seedEnvelope({
    orgId,
    ownerEmail: "owner@example.com",
    stripeCustomerId: "cus_test_1",
    hasFirstKey: true,
  });
  await seedKey({
    apiKeyHash,
    keyPrefix: "pq_live_checkout",
    ownerEmail: "owner@example.com",
    orgId,
    tier: "free",
    products: ["address"],
    quotaPerProduct: 5_000,
    rateLimit: 10,
    active: true,
    paymentOverdue: false,
    stripeCustomerId: "cus_test_1",
    stripeSubscriptionId: null,
    subscriptionItems: {},
    createdAt: "2026-04-01T00:00:00.000Z",
    lastUsedAt: null,
  });
  await seedUsage({
    apiKeyHash,
    scope: `address#${new Date().toISOString().slice(0, 7)}`,
    requestCount: 42,
    warningEmailSent: true,
    limitEmailSent: true,
    lastPushedCumulativeCount: 0,
    ttl: Math.floor(Date.now() / 1000) + 3600,
  });

  const handler = buildHandler({
    customerEmail: "owner@example.com",
    orgId,
    subscriptionId: "sub_checkout_1",
    tier: "starter",
    subscriptionStatus: "active",
  });

  const event = signedEvent({
    id: "evt_checkout_upgrade_1",
    object: "event",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        customer: "cus_test_1",
        subscription: "sub_checkout_1",
      },
    },
  });

  const first = decodeBody(await handler(event));
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.status, "processed");

  const upgraded = await ddb.send(new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash } }));
  assert.equal(upgraded.Item?.tier, "starter");
  assert.equal(upgraded.Item?.stripeSubscriptionId, "sub_checkout_1");
  assert.equal(upgraded.Item?.paymentOverdue, false);

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.equal(envelope.Item?.tier, "starter");
  assert.equal(envelope.Item?.stripeSubscriptionId, "sub_checkout_1");

  const usage = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash, scope: `address#${new Date().toISOString().slice(0, 7)}` },
    }),
  );
  assert.equal(usage.Item?.warningEmailSent, false);
  assert.equal(usage.Item?.limitEmailSent, false);

  const registry = await ddb.send(new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: "REGISTRY#active-keys" } }));
  assert.deepEqual(Array.from((registry.Item?.activeHashes as Set<string>) ?? []), [apiKeyHash]);

  const marker = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: "WEBHOOK#stripe#evt_checkout_upgrade_1" } }),
  );
  assert.equal(marker.Item?.eventType, "checkout.session.completed");

  const replay = decodeBody(await handler(event));
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.status, "duplicate");

  const auditRows = await listAuditRows(orgId);
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0]?.action, "UPGRADE");
});

test("checkout.session.completed with zero keys still updates the org envelope tier state", async () => {
  const orgId = `org_stripe_zero_keys_${SUFFIX}`;
  await seedEnvelope({
    orgId,
    ownerEmail: "owner-zero@example.com",
    stripeCustomerId: "cus_zero_keys_1",
  });

  const handler = buildHandler({
    customerEmail: "owner-zero@example.com",
    orgId,
    subscriptionId: "sub_zero_keys_1",
    tier: "growth",
    subscriptionStatus: "active",
  });

  const result = decodeBody(await handler(signedEvent({
    id: "evt_zero_keys_upgrade_1",
    object: "event",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_zero_keys_1",
        object: "checkout.session",
        customer: "cus_zero_keys_1",
        subscription: "sub_zero_keys_1",
      },
    },
  })));
  assert.equal(result.statusCode, 200);

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.equal(envelope.Item?.tier, "growth");
  assert.equal(envelope.Item?.stripeSubscriptionId, "sub_zero_keys_1");
  assert.deepEqual(envelope.Item?.subscriptionItems, { address: "si_address_1" });
});

test("checkout.session.completed rejects Stripe-enabled products that have no billing endpoint weights yet", async () => {
  const orgId = `org_stripe_unrated_${SUFFIX}`;
  await seedEnvelope({
    orgId,
    ownerEmail: "owner-unrated@example.com",
    stripeCustomerId: "cus_unrated_1",
  });

  const handler = buildHandler({
    customerEmail: "owner-unrated@example.com",
    meteredProducts: ["abn"],
    orgId,
    subscriptionId: "sub_unrated_1",
    tier: "starter",
    subscriptionStatus: "active",
  });

  const result = decodeBody(await handler(signedEvent({
    id: "evt_unrated_product_1",
    object: "event",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_unrated_1",
        object: "checkout.session",
        customer: "cus_unrated_1",
        subscription: "sub_unrated_1",
      },
    },
  })));
  assert.equal(result.statusCode, 500);
  assert.equal(result.body.error, "retryable_failure");

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.equal(envelope.Item?.tier, "free");
  assert.equal(envelope.Item?.stripeSubscriptionId, null);
  assert.deepEqual(envelope.Item?.products, ["address"]);
});

test("checkout.session.completed rejects malformed metered Stripe items missing prontiqProduct metadata", async () => {
  const orgId = `org_stripe_missing_meter_metadata_${SUFFIX}`;
  await seedEnvelope({
    orgId,
    ownerEmail: "owner-metadata@example.com",
    stripeCustomerId: "cus_missing_meter_metadata_1",
  });

  const handler = buildHandler({
    customerEmail: "owner-metadata@example.com",
    meteredStripeProducts: [{ stripeProductId: "prod_missing_metadata_1", subscriptionItemId: "si_missing_metadata_1" }],
    orgId,
    subscriptionId: "sub_missing_metadata_1",
    tier: "starter",
    subscriptionStatus: "active",
  });

  const result = decodeBody(await handler(signedEvent({
    id: "evt_missing_meter_metadata_1",
    object: "event",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_missing_metadata_1",
        object: "checkout.session",
        customer: "cus_missing_meter_metadata_1",
        subscription: "sub_missing_metadata_1",
      },
    },
  })));
  assert.equal(result.statusCode, 500);
  assert.equal(result.body.error, "retryable_failure");

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.equal(envelope.Item?.tier, "free");
  assert.equal(envelope.Item?.stripeSubscriptionId, null);
  assert.deepEqual(envelope.Item?.products, ["address"]);
});

test("processing completion marker returns retryable failure until the current worker finishes", async () => {
  const orgId = `org_stripe_processing_${SUFFIX}`;
  await seedEnvelope({
    orgId,
    ownerEmail: "owner-processing@example.com",
    stripeCustomerId: "cus_processing_1",
  });
  await ddb.send(new PutCommand({
    TableName: KEYS_TABLE,
    Item: {
      apiKeyHash: "WEBHOOK#stripe#evt_processing_marker_1",
      claimedAt: new Date().toISOString(),
      eventType: "checkout.session.completed",
      status: "processing",
      webhookOrgId: orgId,
      ttl: Math.floor(Date.now() / 1000) + 3600,
    },
  }));

  const handler = buildHandler({
    customerEmail: "owner-processing@example.com",
    orgId,
    subscriptionId: "sub_processing_1",
    tier: "starter",
    subscriptionStatus: "active",
  });

  const result = decodeBody(await handler(signedEvent({
    id: "evt_processing_marker_1",
    object: "event",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_processing_1",
        object: "checkout.session",
        customer: "cus_processing_1",
        subscription: "sub_processing_1",
      },
    },
  })));
  assert.equal(result.statusCode, 500);
  assert.equal(result.body.error, "retryable_failure");
  assert.equal(result.body.reason, "event_already_processing");

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.equal(envelope.Item?.tier, "free");

  const auditRows = await listAuditRows(orgId);
  assert.equal(auditRows.length, 0);
});

test("customer.subscription.updated past_due then active toggles paymentOverdue once and sends best-effort email once", async () => {
  const orgId = `org_stripe_past_due_${SUFFIX}`;
  const apiKeyHash = `hash_past_due_${SUFFIX}`;
  await seedEnvelope({
    orgId,
    ownerEmail: "owner2@example.com",
    stripeCustomerId: "cus_test_1",
    tier: "starter",
    products: ["address"],
    paymentOverdue: false,
    stripeSubscriptionId: "sub_past_due_1",
    subscriptionItems: { address: "si_address_1" },
    hasFirstKey: true,
  });
  await seedKey({
    apiKeyHash,
    keyPrefix: "pq_live_past_due",
    ownerEmail: "owner2@example.com",
    orgId,
    tier: "starter",
    products: ["address"],
    quotaPerProduct: 10_000,
    rateLimit: 50,
    active: true,
    paymentOverdue: false,
    stripeCustomerId: "cus_test_1",
    stripeSubscriptionId: "sub_past_due_1",
    subscriptionItems: { address: "si_address_1" },
    createdAt: "2026-04-01T00:00:00.000Z",
    lastUsedAt: null,
  });

  let emailCalls = 0;
  const paymentSender: BillingEmailSender = async () => {
    emailCalls += 1;
    return true;
  };
  const previousWelcomeFrom = process.env.WELCOME_EMAIL_FROM;
  process.env.WELCOME_EMAIL_FROM = "noreply@prontiq.dev";

  try {
    const pastDueHandler = buildHandler({
      customerEmail: "owner2@example.com",
      orgId,
      subscriptionId: "sub_past_due_1",
      tier: "starter",
      subscriptionStatus: "past_due",
    }, paymentSender);

    const pastDueEvent = signedEvent({
      id: "evt_past_due_1",
      object: "event",
      created: Math.floor(Date.now() / 1000),
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_past_due_1",
          object: "subscription",
          customer: "cus_test_1",
          status: "past_due",
        },
      },
    });
    const first = decodeBody(await pastDueHandler(pastDueEvent));
    assert.equal(first.statusCode, 200);

    const pastDueKey = await ddb.send(new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash } }));
    assert.equal(pastDueKey.Item?.paymentOverdue, true);
    assert.equal(emailCalls, 1);

    const activeHandler = buildHandler({
      customerEmail: "owner2@example.com",
      orgId,
      subscriptionId: "sub_past_due_1",
      tier: "starter",
      subscriptionStatus: "active",
    }, paymentSender);
    const activeEvent = signedEvent({
      id: "evt_recovered_1",
      object: "event",
      created: Math.floor(Date.now() / 1000),
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_past_due_1",
          object: "subscription",
          customer: "cus_test_1",
          status: "active",
        },
      },
    });
    const second = decodeBody(await activeHandler(activeEvent));
    assert.equal(second.statusCode, 200);

    const recoveredKey = await ddb.send(new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash } }));
    assert.equal(recoveredKey.Item?.paymentOverdue, false);
    assert.equal(emailCalls, 1);
  } finally {
    if (previousWelcomeFrom === undefined) {
      delete process.env.WELCOME_EMAIL_FROM;
    } else {
      process.env.WELCOME_EMAIL_FROM = previousWelcomeFrom;
    }
  }
});

test("customer.subscription.updated with zero keys still applies plan changes from the org envelope tier", async () => {
  const orgId = `org_stripe_zero_keys_plan_change_${SUFFIX}`;
  await seedEnvelope({
    orgId,
    ownerEmail: "owner-plan-change@example.com",
    stripeCustomerId: "cus_zero_keys_plan_change_1",
    tier: "starter",
    products: ["address"],
    stripeSubscriptionId: "sub_zero_keys_plan_change_1",
    subscriptionItems: { address: "si_address_old_1" },
  });

  const handler = buildHandler({
    customerEmail: "owner-plan-change@example.com",
    orgId,
    subscriptionId: "sub_zero_keys_plan_change_1",
    tier: "growth",
    subscriptionStatus: "active",
  });

  const result = decodeBody(await handler(signedEvent({
    id: "evt_zero_keys_plan_change_1",
    object: "event",
    created: Math.floor(Date.now() / 1000),
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_zero_keys_plan_change_1",
        object: "subscription",
        customer: "cus_zero_keys_plan_change_1",
        status: "active",
      },
    },
  })));
  assert.equal(result.statusCode, 200);

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.equal(envelope.Item?.tier, "growth");
  assert.equal(envelope.Item?.stripeSubscriptionId, "sub_zero_keys_plan_change_1");
  assert.deepEqual(envelope.Item?.subscriptionItems, { address: "si_address_1" });
});

test("customer.subscription.deleted downgrades keys and envelope to free and removes registry membership", async () => {
  const orgId = `org_stripe_deleted_${SUFFIX}`;
  const apiKeyHash = `hash_deleted_${SUFFIX}`;
  await ddb.send(new PutCommand({
    TableName: KEYS_TABLE,
    Item: {
      apiKeyHash: `ORG#${orgId}`,
      stripeCustomerId: "cus_deleted_1",
      ownerEmail: "owner-deleted@example.com",
      tier: "starter",
      products: ["address"],
      paymentOverdue: true,
      stripeSubscriptionId: "sub_deleted_1",
      subscriptionItems: { address: "si_address_1" },
      hasFirstKey: false,
      completedAt: "2026-04-01T00:00:00.000Z",
    },
  }));
  await seedKey({
    apiKeyHash,
    keyPrefix: "pq_live_deleted",
    ownerEmail: "owner-deleted@example.com",
    orgId,
    tier: "starter",
    products: ["address"],
    quotaPerProduct: 10_000,
    rateLimit: 50,
    active: true,
    paymentOverdue: true,
    stripeCustomerId: "cus_deleted_1",
    stripeSubscriptionId: "sub_deleted_1",
    subscriptionItems: { address: "si_address_1" },
    createdAt: "2026-04-01T00:00:00.000Z",
    lastUsedAt: null,
  });
  await ddb.send(new PutCommand({
    TableName: KEYS_TABLE,
    Item: { apiKeyHash: "REGISTRY#active-keys", activeHashes: new Set([apiKeyHash]) },
  }));

  const handler = buildHandler({
    customerEmail: "owner-deleted@example.com",
    orgId,
    subscriptionId: "sub_deleted_1",
    tier: "starter",
    subscriptionStatus: "canceled",
  });

  const result = decodeBody(await handler(signedEvent({
    id: "evt_subscription_deleted_1",
    object: "event",
    created: Math.floor(Date.now() / 1000),
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_deleted_1",
        object: "subscription",
        customer: "cus_deleted_1",
        status: "canceled",
      },
    },
  })));
  assert.equal(result.statusCode, 200);

  const key = await ddb.send(new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash } }));
  assert.equal(key.Item?.tier, "free");
  assert.equal(key.Item?.paymentOverdue, false);
  assert.equal(key.Item?.stripeSubscriptionId, null);
  assert.deepEqual(key.Item?.subscriptionItems, {});

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.equal(envelope.Item?.tier, "free");
  assert.equal(envelope.Item?.paymentOverdue, false);
  assert.equal(envelope.Item?.stripeSubscriptionId, null);
  assert.deepEqual(envelope.Item?.subscriptionItems, {});

  const registry = await ddb.send(new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: "REGISTRY#active-keys" } }));
  assert.deepEqual(Array.from((registry.Item?.activeHashes as Set<string>) ?? []), []);
});
