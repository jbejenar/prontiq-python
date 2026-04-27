import assert from "node:assert/strict";
import test from "node:test";
import {
  billingUsageEventV1Schema,
  deriveBillingUsageEventId,
  type ApiKeyRecord,
  type CustomerRecord,
} from "@prontiq/shared";
import {
  buildLagoLiveSmokeEvent,
  buildLagoLiveSmokeEvidence,
  parseLagoLiveSmokeEnv,
  runLagoLiveSmoke,
} from "./lago-live-smoke.js";

const occurredAt = new Date("2026-04-26T01:00:00.000Z");

function makeKey(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    active: true,
    apiKeyHash: "hash_0123456789abcdef0123456789abcdef",
    createdAt: "2026-04-26T00:00:00.000Z",
    customerId: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7D",
    keyPrefix: "pq_live_abcdef",
    lastUsedAt: null,
    orgId: "org_smoke",
    ownerEmail: "owner@example.com",
    paymentOverdue: false,
    products: ["address"],
    quotaPerProduct: 100,
    rateLimit: 10,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    tier: "free",
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<CustomerRecord> = {}): CustomerRecord {
  return {
    createdAt: "2026-04-26T00:00:00.000Z",
    customerId: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7D",
    lagoCustomerId: null,
    lagoExternalCustomerId: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7D",
    orgId: "org_smoke",
    ownerEmail: "owner@example.com",
    status: "active",
    stripeCustomerId: null,
    updatedAt: "2026-04-26T00:00:00.000Z",
    ...overrides,
  };
}

test("parseLagoLiveSmokeEnv requires live-table and smoke inputs", () => {
  assert.throws(() => parseLagoLiveSmokeEnv({ STAGE: "dev" }), /CUSTOMERS_TABLE_NAME is required/);
});

test("parseLagoLiveSmokeEnv derives safe defaults", () => {
  const config = parseLagoLiveSmokeEnv({
    CUSTOMERS_TABLE_NAME: "prontiq-customers-dev",
    KEYS_TABLE_NAME: "prontiq-keys-dev",
    OCCURRED_AT: occurredAt.toISOString(),
    REQUEST_COUNT_AFTER_INCREMENT: "42",
    SMOKE_API_KEY_HASH: "hash_0123456789abcdef0123456789abcdef",
    STAGE: "dev",
  });

  assert.equal(config.billingEndpointKey, "address.smoke");
  assert.equal(config.creditDelta, 1);
  assert.equal(config.product, "address");
  assert.equal(config.sendToSqs, false);
  assert.equal(config.usageScope, "address#2026-04");
});

test("parseLagoLiveSmokeEnv parses SEND_TO_SQS deliberately", () => {
  const config = parseLagoLiveSmokeEnv({
    CUSTOMERS_TABLE_NAME: "prontiq-customers-dev",
    KEYS_TABLE_NAME: "prontiq-keys-dev",
    REQUEST_COUNT_AFTER_INCREMENT: "42",
    SEND_TO_SQS: " true ",
    SMOKE_API_KEY_HASH: "hash_0123456789abcdef0123456789abcdef",
    STAGE: "dev",
  });

  assert.equal(config.sendToSqs, true);
  assert.throws(
    () =>
      parseLagoLiveSmokeEnv({
        CUSTOMERS_TABLE_NAME: "prontiq-customers-dev",
        KEYS_TABLE_NAME: "prontiq-keys-dev",
        REQUEST_COUNT_AFTER_INCREMENT: "42",
        SEND_TO_SQS: "yes",
        SMOKE_API_KEY_HASH: "hash_0123456789abcdef0123456789abcdef",
        STAGE: "dev",
      }),
    /SEND_TO_SQS must be true or false/,
  );
});

test("buildLagoLiveSmokeEvent derives deterministic event id", () => {
  const key = makeKey();
  const customer = makeCustomer();
  const event = buildLagoLiveSmokeEvent({
    apiKeyHash: key.apiKeyHash,
    customer,
    key,
    occurredAt,
    requestCountAfterIncrement: 42,
    stage: "dev",
  });

  const parsed = billingUsageEventV1Schema.parse(event);
  assert.deepEqual(parsed, event);
  assert.equal(
    event.eventId,
    deriveBillingUsageEventId({
      apiKeyHash: key.apiKeyHash,
      billingEndpointKey: "address.smoke",
      creditDelta: 1,
      customerId: customer.customerId,
      requestCountAfterIncrement: 42,
      usageScope: "address#2026-04",
    }),
  );
  assert.equal(event.meterEventName, "prontiq_address_requests");
  assert.equal(event.source.path, "/internal/lago-live-smoke");
});

test("buildLagoLiveSmokeEvent fails closed on unsafe smoke state", () => {
  const key = makeKey({ customerId: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7D" });
  const customer = makeCustomer({ lagoExternalCustomerId: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7E" });

  assert.throws(
    () =>
      buildLagoLiveSmokeEvent({
        apiKeyHash: key.apiKeyHash,
        customer,
        key,
        occurredAt,
        requestCountAfterIncrement: 42,
        stage: "dev",
      }),
    /lagoExternalCustomerId must equal customerId/,
  );
});

test("buildLagoLiveSmokeEvidence prints only non-secret identifiers", () => {
  const key = makeKey();
  const customer = makeCustomer();
  const event = buildLagoLiveSmokeEvent({
    apiKeyHash: key.apiKeyHash,
    customer,
    key,
    occurredAt,
    requestCountAfterIncrement: 42,
    stage: "prod",
  });

  const evidence = buildLagoLiveSmokeEvidence({ event, sentToSqs: true });
  assert.equal(evidence.customerId, customer.customerId);
  assert.equal(evidence.externalSubscriptionId, "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7D");
  assert.equal(evidence.keyPrefix, key.keyPrefix);
  assert.equal(evidence.sentToSqs, true);
  assert.equal(JSON.stringify(evidence).includes("pq_live_"), true);
  assert.equal(JSON.stringify(evidence).includes("raw"), false);
});

test("runLagoLiveSmoke does not send to SQS unless explicitly enabled", async () => {
  let sendCount = 0;
  const result = await runLagoLiveSmoke(
    {
      CUSTOMERS_TABLE_NAME: "prontiq-customers-dev",
      KEYS_TABLE_NAME: "prontiq-keys-dev",
      OCCURRED_AT: occurredAt.toISOString(),
      REQUEST_COUNT_AFTER_INCREMENT: "42",
      SMOKE_API_KEY_HASH: "hash_0123456789abcdef0123456789abcdef",
      STAGE: "dev",
    },
    {
      loadSmokeState: async () => ({ customer: makeCustomer(), key: makeKey() }),
      sendSmokeEventToSqs: async () => {
        sendCount += 1;
      },
    },
  );

  assert.equal(result.evidence.sentToSqs, false);
  assert.equal(sendCount, 0);
});

test("runLagoLiveSmoke requires a queue URL before loading state when SEND_TO_SQS=true", async () => {
  let loadCount = 0;

  await assert.rejects(
    () =>
      runLagoLiveSmoke(
        {
          CUSTOMERS_TABLE_NAME: "prontiq-customers-dev",
          KEYS_TABLE_NAME: "prontiq-keys-dev",
          REQUEST_COUNT_AFTER_INCREMENT: "42",
          SEND_TO_SQS: "true",
          SMOKE_API_KEY_HASH: "hash_0123456789abcdef0123456789abcdef",
          STAGE: "dev",
        },
        {
          loadSmokeState: async () => {
            loadCount += 1;
            return { customer: makeCustomer(), key: makeKey() };
          },
        },
      ),
    /BILLING_EVENTS_QUEUE_URL is required when SEND_TO_SQS=true/,
  );
  assert.equal(loadCount, 0);
});

test("runLagoLiveSmoke sends the validated event when SEND_TO_SQS=true", async () => {
  const sentBodies: Array<{ queueUrl: string; eventId: string }> = [];
  const result = await runLagoLiveSmoke(
    {
      BILLING_EVENTS_QUEUE_URL:
        "https://sqs.ap-southeast-2.amazonaws.com/123/prontiq-billing-events-dev",
      CUSTOMERS_TABLE_NAME: "prontiq-customers-dev",
      KEYS_TABLE_NAME: "prontiq-keys-dev",
      OCCURRED_AT: occurredAt.toISOString(),
      REQUEST_COUNT_AFTER_INCREMENT: "42",
      SEND_TO_SQS: "true",
      SMOKE_API_KEY_HASH: "hash_0123456789abcdef0123456789abcdef",
      STAGE: "dev",
    },
    {
      loadSmokeState: async () => ({ customer: makeCustomer(), key: makeKey() }),
      sendSmokeEventToSqs: async (queueUrl, event) => {
        sentBodies.push({ queueUrl, eventId: event.eventId });
      },
    },
  );

  assert.equal(result.evidence.sentToSqs, true);
  assert.deepEqual(sentBodies, [
    {
      queueUrl: "https://sqs.ap-southeast-2.amazonaws.com/123/prontiq-billing-events-dev",
      eventId: result.event.eventId,
    },
  ]);
});
