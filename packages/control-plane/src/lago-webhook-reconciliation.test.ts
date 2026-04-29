import test from "node:test";
import assert from "node:assert/strict";
import {
  createLagoWebhookReconciliationService,
  normalizeLagoWebhookPayload,
  type LagoSubscriptionClient,
  type LagoSubscriptionSnapshot,
  type LagoWebhookClaimResult,
  type LagoWebhookLedger,
} from "./lago-webhook-reconciliation.js";
import type { LagoWebhookLedgerRecord, LagoWebhookProcessingStatus } from "@prontiq/shared";

class FakeLedger implements LagoWebhookLedger {
  finalizations: Array<{
    customerId?: string;
    error?: string;
    eventType: string;
    orgId?: string;
    status: LagoWebhookProcessingStatus;
    uniqueKey: string;
  }> = [];
  claimResult: LagoWebhookClaimResult = { kind: "claimed" };

  async claim(): Promise<LagoWebhookClaimResult> {
    return this.claimResult;
  }

  async finalize(input: Parameters<LagoWebhookLedger["finalize"]>[0]): Promise<void> {
    this.finalizations.push({
      customerId: input.customerId,
      error: input.error,
      eventType: input.eventType,
      orgId: input.orgId,
      status: input.status,
      uniqueKey: input.uniqueKey,
    });
  }

  async get(uniqueKey: string): Promise<LagoWebhookLedgerRecord | undefined> {
    return {
      eventType: "subscription.started",
      firstSeenAt: "2026-04-25T00:00:00.000Z",
      lastSeenAt: "2026-04-25T00:00:00.000Z",
      payloadHash: "hash",
      status: "completed",
      ttl: 1_800_000_000,
      uniqueKey,
    };
  }
}

class FakeLagoClient implements LagoSubscriptionClient {
  snapshot: LagoSubscriptionSnapshot | null = {
    billingPeriodEndingAt: "2026-05-25T00:00:00Z",
    billingPeriodStartedAt: "2026-04-25T00:00:00Z",
    externalCustomerId: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
    externalSubscriptionId: "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
    planCode: "payg",
    status: "active",
  };

  async getSubscription(): Promise<LagoSubscriptionSnapshot | null> {
    return this.snapshot;
  }

  async getSubscriptionCharges() {
    return [
      {
        billableMetricCode: "prontiq_address_requests",
        chargeModel: "standard",
        properties: {},
      },
    ];
  }

  async getSubscriptionEntitlements() {
    return [
      { featureCode: "api_keys", privileges: { max: 3 } },
      {
        featureCode: "address_api",
        privileges: {
          enabled: true,
          rate_limit_per_second: 25,
          enforcement_mode: "uncapped_tracked",
        },
      },
    ];
  }
}

test("normalizes Lago webhook payloads with invoice subscription arrays", () => {
  const normalized = normalizeLagoWebhookPayload({
    webhook_type: "invoice.created",
    invoice: {
      customer: { external_id: "pq_cust_123" },
      subscriptions: [{ external_id: "pq_sub_123" }],
    },
  });

  assert.equal(normalized.eventType, "invoice.created");
  assert.equal(normalized.customerId, "pq_cust_123");
  assert.equal(normalized.invoiceSubscriptionExternalId, "pq_sub_123");
});

test("disabled reconciliation returns retryable 503 before claiming the event", async () => {
  const ledger = new FakeLedger();
  let claimed = false;
  ledger.claim = async () => {
    claimed = true;
    return { kind: "claimed" };
  };
  const service = createLagoWebhookReconciliationService({
    auditTableName: "audit",
    ddb: {} as never,
    enabled: false,
    keysTableName: "keys",
    lagoClient: new FakeLagoClient(),
    ledger,
    logger: console,
    now: () => new Date("2026-04-25T00:00:00.000Z"),
    usageTableName: "usage",
  });

  const result = await service.handleWebhook({
    uniqueKey: "lago_evt_disabled",
    payload: { webhook_type: "subscription.started" },
  });

  assert.equal(result.status, "disabled");
  assert.equal(result.httpStatus, 503);
  assert.equal(claimed, false);
});

test("completed ledger rows are acknowledged as duplicates", async () => {
  const ledger = new FakeLedger();
  ledger.claimResult = {
    kind: "completed",
    record: {
      eventType: "subscription.started",
      firstSeenAt: "2026-04-25T00:00:00.000Z",
      lastSeenAt: "2026-04-25T00:00:00.000Z",
      payloadHash: "hash",
      status: "completed",
      ttl: 1_800_000_000,
      uniqueKey: "lago_evt_duplicate",
    },
  };
  const service = createLagoWebhookReconciliationService({
    auditTableName: "audit",
    ddb: {} as never,
    enabled: true,
    keysTableName: "keys",
    lagoClient: new FakeLagoClient(),
    ledger,
    logger: console,
    now: () => new Date("2026-04-25T00:00:00.000Z"),
    usageTableName: "usage",
  });

  const result = await service.handleWebhook({
    uniqueKey: "lago_evt_duplicate",
    payload: { webhook_type: "subscription.started" },
  });

  assert.equal(result.status, "duplicate");
  assert.equal(result.httpStatus, 200);
  assert.equal(ledger.finalizations.length, 0);
});

test("unsupported Lago webhook types are claimed then ignored", async () => {
  const ledger = new FakeLedger();
  const service = createLagoWebhookReconciliationService({
    auditTableName: "audit",
    ddb: {} as never,
    enabled: true,
    keysTableName: "keys",
    lagoClient: new FakeLagoClient(),
    ledger,
    logger: console,
    now: () => new Date("2026-04-25T00:00:00.000Z"),
    usageTableName: "usage",
  });

  const result = await service.handleWebhook({
    uniqueKey: "lago_evt_ignored",
    payload: { webhook_type: "customer.created" },
  });

  assert.equal(result.status, "ignored");
  assert.equal(result.httpStatus, 200);
  assert.equal(ledger.finalizations[0]?.status, "ignored");
});

test("payload hash conflicts mark the existing ledger row as drift", async () => {
  const ledger = new FakeLedger();
  ledger.claimResult = {
    kind: "hash_conflict",
    record: {
      customerId: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
      eventType: "subscription.started",
      firstSeenAt: "2026-04-25T00:00:00.000Z",
      lastSeenAt: "2026-04-25T00:00:00.000Z",
      orgId: "org_123",
      payloadHash: "existing_hash",
      status: "processing",
      ttl: 1_800_000_000,
      uniqueKey: "lago_evt_hash_conflict",
    },
  };
  const service = createLagoWebhookReconciliationService({
    auditTableName: "audit",
    ddb: {} as never,
    enabled: true,
    keysTableName: "keys",
    lagoClient: new FakeLagoClient(),
    ledger,
    logger: console,
    now: () => new Date("2026-04-25T00:00:00.000Z"),
    usageTableName: "usage",
  });

  const result = await service.handleWebhook({
    uniqueKey: "lago_evt_hash_conflict",
    payload: {
      webhook_type: "subscription.started",
      customer: { external_id: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A" },
    },
  });

  assert.equal(result.status, "drift");
  assert.equal(result.httpStatus, 500);
  assert.equal(ledger.finalizations[0]?.status, "drift");
  assert.equal(ledger.finalizations[0]?.eventType, "subscription.started");
  assert.equal(ledger.finalizations[0]?.orgId, "org_123");
});

test("consumed event missing Lago customer id becomes drift and is retried", async () => {
  const ledger = new FakeLedger();
  const service = createLagoWebhookReconciliationService({
    auditTableName: "audit",
    ddb: {} as never,
    enabled: true,
    keysTableName: "keys",
    lagoClient: new FakeLagoClient(),
    ledger,
    logger: console,
    now: () => new Date("2026-04-25T00:00:00.000Z"),
    usageTableName: "usage",
  });

  const result = await service.handleWebhook({
    uniqueKey: "lago_evt_drift",
    payload: { webhook_type: "subscription.started" },
  });

  assert.equal(result.status, "drift");
  assert.equal(result.httpStatus, 500);
  assert.equal(ledger.finalizations[0]?.status, "drift");
  assert.match(ledger.finalizations[0]?.error ?? "", /missing customer external_id/);
});
