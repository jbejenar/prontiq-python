import assert from "node:assert/strict";
import test from "node:test";
import {
  billingUsageEventV2Schema,
  deriveBillingUsageEventId,
  type ApiKeyRecord,
  type OrgEnvelopeRecord,
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
    keyId: "key_01TESTKEYIDLAGOSMOKE0000001",
    createdAt: "2026-04-26T00:00:00.000Z",
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

function makeOrg(overrides: Partial<OrgEnvelopeRecord> = {}): OrgEnvelopeRecord {
  const base: OrgEnvelopeRecord = {
    apiKeyHash: "ORG#org_smoke",
    completedAt: "2026-04-26T00:00:00.000Z",
    hasFirstKey: true,
    orgId: "org_smoke",
    ownerEmail: "owner@example.com",
    paymentOverdue: false,
    products: ["address"],
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    tier: "free",
  };
  return { ...base, ...overrides } as OrgEnvelopeRecord;
}

test("parseLagoLiveSmokeEnv requires live-table and smoke inputs", () => {
  assert.throws(() => parseLagoLiveSmokeEnv({ STAGE: "dev" }), /KEYS_TABLE_NAME is required/);
});

test("parseLagoLiveSmokeEnv derives safe defaults", () => {
  const config = parseLagoLiveSmokeEnv({
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
        KEYS_TABLE_NAME: "prontiq-keys-dev",
        REQUEST_COUNT_AFTER_INCREMENT: "42",
        SEND_TO_SQS: "yes",
        SMOKE_API_KEY_HASH: "hash_0123456789abcdef0123456789abcdef",
        STAGE: "dev",
      }),
    /SEND_TO_SQS must be true or false/,
  );
});

test("buildLagoLiveSmokeEvent derives deterministic V2 event id", () => {
  const key = makeKey();
  const org = makeOrg();
  const event = buildLagoLiveSmokeEvent({
    apiKeyHash: key.apiKeyHash,
    key,
    occurredAt,
    org,
    requestCountAfterIncrement: 42,
    stage: "dev",
  });

  const parsed = billingUsageEventV2Schema.parse(event);
  assert.deepEqual(parsed, event);
  assert.equal(event.version, 2);
  assert.equal(
    event.eventId,
    deriveBillingUsageEventId({
      apiKeyHash: key.apiKeyHash,
      billingEndpointKey: "address.smoke",
      creditDelta: 1,
      orgId: key.orgId,
      requestCountAfterIncrement: 42,
      usageScope: "address#2026-04",
    }),
  );
  assert.equal(event.meterEventName, "prontiq_address_requests");
  assert.equal(event.source.path, "/internal/lago-live-smoke");
});

test("buildLagoLiveSmokeEvent fails closed on unsafe smoke state", () => {
  const key = makeKey();
  const org = makeOrg({ apiKeyHash: "ORG#org_other" });

  assert.throws(
    () =>
      buildLagoLiveSmokeEvent({
        apiKeyHash: key.apiKeyHash,
        key,
        occurredAt,
        org,
        requestCountAfterIncrement: 42,
        stage: "dev",
      }),
    /org envelope does not match API key orgId/,
  );
});

test("buildLagoLiveSmokeEvidence prints only non-secret identifiers", () => {
  const key = makeKey();
  const org = makeOrg();
  const event = buildLagoLiveSmokeEvent({
    apiKeyHash: key.apiKeyHash,
    key,
    occurredAt,
    org,
    requestCountAfterIncrement: 42,
    stage: "prod",
  });

  const evidence = buildLagoLiveSmokeEvidence({ event, sentToSqs: true });
  assert.equal(evidence.externalSubscriptionId, "lago_sub_org_smoke");
  assert.equal(evidence.keyPrefix, key.keyPrefix);
  assert.equal(evidence.orgId, key.orgId);
  assert.equal(evidence.sentToSqs, true);
  assert.equal(JSON.stringify(evidence).includes("pq_live_"), true);
  assert.equal(JSON.stringify(evidence).includes("raw"), false);
});

test("runLagoLiveSmoke does not send to SQS unless explicitly enabled", async () => {
  let sendCount = 0;
  const result = await runLagoLiveSmoke(
    {
      KEYS_TABLE_NAME: "prontiq-keys-dev",
      OCCURRED_AT: occurredAt.toISOString(),
      REQUEST_COUNT_AFTER_INCREMENT: "42",
      SMOKE_API_KEY_HASH: "hash_0123456789abcdef0123456789abcdef",
      STAGE: "dev",
    },
    {
      loadSmokeState: async () => ({ key: makeKey(), org: makeOrg() }),
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
          KEYS_TABLE_NAME: "prontiq-keys-dev",
          REQUEST_COUNT_AFTER_INCREMENT: "42",
          SEND_TO_SQS: "true",
          SMOKE_API_KEY_HASH: "hash_0123456789abcdef0123456789abcdef",
          STAGE: "dev",
        },
        {
          loadSmokeState: async () => {
            loadCount += 1;
            return { key: makeKey(), org: makeOrg() };
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
      KEYS_TABLE_NAME: "prontiq-keys-dev",
      OCCURRED_AT: occurredAt.toISOString(),
      REQUEST_COUNT_AFTER_INCREMENT: "42",
      SEND_TO_SQS: "true",
      SMOKE_API_KEY_HASH: "hash_0123456789abcdef0123456789abcdef",
      STAGE: "dev",
    },
    {
      loadSmokeState: async () => ({ key: makeKey(), org: makeOrg() }),
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
