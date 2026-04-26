import test from "node:test";
import assert from "node:assert/strict";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  AccountBillingError,
  DynamoBillingActionLedger,
  HttpLagoAccountBillingClient,
  createAccountBillingService,
  type BillingActionRecord,
  type BillingActionLedger,
  type LagoAccountBillingClient,
  type LagoSubscriptionState,
} from "./account-billing.js";
import type { CustomerRecord, OrgEnvelopeRecord } from "@prontiq/shared";

const ORG_ID = "org_billing_test";
const USER_ID = "user_billing_test";
const CUSTOMER_ID = "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A";
const SUBSCRIPTION_ID = "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A";
const API_KEY_HASH = "hash_account_billing_test";

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

function makeEnvelope(overrides: Partial<OrgEnvelopeRecord> = {}): OrgEnvelopeRecord {
  return {
    apiKeyHash: `ORG#${ORG_ID}`,
    completedAt: "2026-04-26T00:00:00.000Z",
    customerId: CUSTOMER_ID,
    hasFirstKey: true,
    ownerEmail: "owner@example.com",
    paymentOverdue: false,
    products: ["address"],
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
    subscriptionItems: {},
    tier: "payg",
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<CustomerRecord> = {}): CustomerRecord {
  return {
    createdAt: "2026-04-26T00:00:00.000Z",
    customerId: CUSTOMER_ID,
    lagoCustomerId: null,
    lagoExternalCustomerId: CUSTOMER_ID,
    orgId: ORG_ID,
    ownerEmail: "owner@example.com",
    status: "active",
    stripeCustomerId: "cus_test",
    updatedAt: "2026-04-26T00:00:00.000Z",
    ...overrides,
  };
}

function makeLedger(): BillingActionLedger & { starts: number; completes: number } {
  return {
    completes: 0,
    starts: 0,
    async complete() {
      this.completes += 1;
    },
    async fail() {},
    async lookup() {
      return { kind: "not_found" };
    },
    async start() {
      this.starts += 1;
      return { actionId: "bact_test", kind: "started" };
    },
  };
}

function makeLagoClient(
  subscription: LagoSubscriptionState | null,
): LagoAccountBillingClient & { upsertSubscriptionCalls: number } {
  return {
    upsertSubscriptionCalls: 0,
    async getCustomerPortalUrl() {
      return { expiresAt: null, url: "https://portal.example.test/session" };
    },
    async getSubscription() {
      return subscription;
    },
    async upsertCustomer() {},
    async upsertSubscription() {
      this.upsertSubscriptionCalls += 1;
      return {
        downgradePlanDate: "2026-05-25",
        externalCustomerId: CUSTOMER_ID,
        externalSubscriptionId: SUBSCRIPTION_ID,
        nextPlanCode: "free",
        planCode: "payg",
        previousPlanCode: "payg",
        status: "active",
      };
    },
  };
}

function makeUnavailableLagoClient(): LagoAccountBillingClient & { upsertSubscriptionCalls: number } {
  return {
    upsertSubscriptionCalls: 0,
    async getCustomerPortalUrl() {
      throw new AccountBillingError("LAGO_UNAVAILABLE", "Lago unavailable", 503);
    },
    async getSubscription() {
      throw new AccountBillingError("LAGO_UNAVAILABLE", "Lago unavailable", 503);
    },
    async upsertCustomer() {
      throw new AccountBillingError("LAGO_UNAVAILABLE", "Lago unavailable", 503);
    },
    async upsertSubscription() {
      this.upsertSubscriptionCalls += 1;
      throw new AccountBillingError("LAGO_UNAVAILABLE", "Lago unavailable", 503);
    },
  };
}

function makeDdb(input: {
  envelope: OrgEnvelopeRecord;
  customer?: CustomerRecord;
  updates?: Array<Record<string, unknown>>;
}): DynamoDBDocumentClient {
  return {
    send: async (command: unknown): Promise<unknown> => {
      if (command instanceof GetCommand) {
        return { Item: input.envelope };
      }
      if (command instanceof QueryCommand) {
        if (command.input.IndexName === "customerId-index") {
          return { Items: [input.customer ?? makeCustomer()] };
        }
        if (command.input.IndexName === "orgId-index") {
          return {
            Items: [
              {
                active: true,
                apiKeyHash: API_KEY_HASH,
                keyPrefix: "pq_live_test",
                orgId: ORG_ID,
                ownerEmail: "owner@example.com",
              },
            ],
          };
        }
      }
      if (command instanceof UpdateCommand) {
        input.updates?.push(command.input as Record<string, unknown>);
        return {};
      }
      throw new Error("unexpected command");
    },
  } as DynamoDBDocumentClient;
}

function conditionalCheckFailed(): Error {
  const error = new Error("conditional check failed");
  error.name = "ConditionalCheckFailedException";
  return error;
}

function makeBillingActionLedgerDdb(): DynamoDBDocumentClient & {
  getRecord: (actionId: string) => BillingActionRecord | undefined;
} {
  const records = new Map<string, BillingActionRecord>();
  return {
    getRecord(actionId: string) {
      return records.get(actionId);
    },
    send: async (command: unknown): Promise<unknown> => {
      if (command instanceof PutCommand) {
        const item = command.input.Item as BillingActionRecord;
        if (records.has(item.actionId)) throw conditionalCheckFailed();
        records.set(item.actionId, { ...item });
        return {};
      }
      if (command instanceof GetCommand) {
        const key = command.input.Key as { actionId?: unknown };
        const actionId = typeof key.actionId === "string" ? key.actionId : "";
        return { Item: records.get(actionId) };
      }
      if (command instanceof UpdateCommand) {
        const key = command.input.Key as { actionId?: unknown };
        const actionId = typeof key.actionId === "string" ? key.actionId : "";
        const record = records.get(actionId);
        if (!record) throw new Error("missing ledger record");
        const values = (command.input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
        if (command.input.ConditionExpression) {
          const requestHashMatches = record.requestHash === values[":requestHash"];
          const statusMatches = record.status === values[":expectedStatus"];
          const staleBefore = values[":staleBefore"];
          const staleMatches =
            typeof staleBefore !== "string" || record.updatedAt <= staleBefore;
          if (!requestHashMatches || !statusMatches || !staleMatches) {
            throw conditionalCheckFailed();
          }
        }
        const status = values[":status"] ?? values[":processing"];
        if (
          status === "processing" ||
          status === "succeeded" ||
          status === "failed_retryable" ||
          status === "failed_permanent"
        ) {
          record.status = status;
        }
        if (typeof values[":updatedAt"] === "string") record.updatedAt = values[":updatedAt"];
        if (typeof values[":lastError"] === "string") record.lastError = values[":lastError"];
        if (":providerStatus" in values) record.providerStatus = values[":providerStatus"] as string | null;
        if (":providerRequestId" in values) {
          record.providerRequestId = values[":providerRequestId"] as string | null;
        }
        if (":providerSubscriptionState" in values) {
          record.providerSubscriptionState = values[
            ":providerSubscriptionState"
          ] as BillingActionRecord["providerSubscriptionState"];
        }
        if (":responseBody" in values) {
          record.responseBody = values[":responseBody"] as BillingActionRecord["responseBody"];
        }
        if (command.input.UpdateExpression?.includes("REMOVE #lastError")) {
          delete record.lastError;
        }
        records.set(actionId, { ...record });
        return {};
      }
      throw new Error("unexpected command");
    },
  } as DynamoDBDocumentClient & {
    getRecord: (actionId: string) => BillingActionRecord | undefined;
  };
}

test("Lago account billing client uses portal URL endpoint", async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const client = new HttpLagoAccountBillingClient({
    apiKey: "lago_test",
    baseUrl: "https://billing.example.test/api/v1",
    fetchImpl: async (url, init) => {
      requests.push({ method: init?.method ?? "GET", url: String(url) });
      return response({ customer: { portal_url: "https://portal.example.test/session" } });
    },
  });

  const portal = await client.getCustomerPortalUrl("pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A");

  assert.equal(portal.url, "https://portal.example.test/session");
  assert.deepEqual(requests, [
    {
      method: "GET",
      url: "https://billing.example.test/api/v1/customers/pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A/portal_url",
    },
  ]);
});

test("Lago account billing client upserts AUD customer with payment provider config", async () => {
  let body: unknown;
  const client = new HttpLagoAccountBillingClient({
    apiKey: "lago_test",
    baseUrl: "https://billing.example.test",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body)) as unknown;
      return response({ customer: { external_id: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A" } });
    },
  });

  await client.upsertCustomer({
    billingConfiguration: {
      paymentProvider: "stripe",
      paymentProviderCode: "stripe_default",
    },
    currency: "AUD",
    customerId: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
    email: "owner@example.com",
    name: "owner@example.com",
  });

  assert.deepEqual(body, {
    customer: {
      billing_configuration: {
        invoice_grace_period: 0,
        payment_provider: "stripe",
        payment_provider_code: "stripe_default",
      },
      currency: "AUD",
      email: "owner@example.com",
      external_id: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
      name: "owner@example.com",
    },
  });
});

test("Lago account billing client submits subscription plan change with stable external IDs", async () => {
  let body: unknown;
  const client = new HttpLagoAccountBillingClient({
    apiKey: "lago_test",
    baseUrl: "https://billing.example.test",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body)) as unknown;
      return response({
        subscription: {
          external_customer_id: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
          external_id: "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
          next_plan: { code: "free" },
          plan_code: "payg",
          status: "active",
        },
      });
    },
  });

  const subscription = await client.upsertSubscription({
    externalCustomerId: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
    externalSubscriptionId: "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
    planCode: "free",
  });

  assert.deepEqual(body, {
    subscription: {
      external_customer_id: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
      external_id: "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
      plan_code: "free",
    },
  });
  assert.equal(subscription.nextPlanCode, "free");
});

test("Lago account billing client maps rejected fetch to retryable Lago unavailable", async () => {
  const client = new HttpLagoAccountBillingClient({
    apiKey: "lago_test",
    baseUrl: "https://billing.example.test",
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    client.getCustomerPortalUrl(CUSTOMER_ID),
    (error: unknown) => {
      assert.ok(error instanceof AccountBillingError);
      assert.equal(error.code, "LAGO_UNAVAILABLE");
      assert.equal(error.httpStatus, 503);
      return true;
    },
  );
});

test("Lago account billing client maps aborts and malformed JSON to retryable Lago unavailable", async () => {
  const abortingClient = new HttpLagoAccountBillingClient({
    apiKey: "lago_test",
    baseUrl: "https://billing.example.test",
    fetchImpl: async () => {
      throw new DOMException("timed out", "AbortError");
    },
  });
  await assert.rejects(abortingClient.getCustomerPortalUrl(CUSTOMER_ID), {
    code: "LAGO_UNAVAILABLE",
    httpStatus: 503,
  });

  const malformedClient = new HttpLagoAccountBillingClient({
    apiKey: "lago_test",
    baseUrl: "https://billing.example.test",
    fetchImpl: async () => new Response("{", { status: 200 }),
  });
  await assert.rejects(
    malformedClient.upsertSubscription({
      externalCustomerId: CUSTOMER_ID,
      externalSubscriptionId: SUBSCRIPTION_ID,
      planCode: "free",
    }),
    { code: "LAGO_UNAVAILABLE", httpStatus: 503 },
  );
});

test("Lago account billing client keeps provider status semantics distinct", async () => {
  const rateLimitedClient = new HttpLagoAccountBillingClient({
    apiKey: "lago_test",
    baseUrl: "https://billing.example.test",
    fetchImpl: async () => response({ error: "rate_limited" }, { status: 429 }),
  });
  await assert.rejects(rateLimitedClient.getCustomerPortalUrl(CUSTOMER_ID), {
    code: "LAGO_UNAVAILABLE",
    httpStatus: 503,
  });

  const failingClient = new HttpLagoAccountBillingClient({
    apiKey: "lago_test",
    baseUrl: "https://billing.example.test",
    fetchImpl: async () => response({ error: "server_error" }, { status: 500 }),
  });
  await assert.rejects(failingClient.getCustomerPortalUrl(CUSTOMER_ID), {
    code: "LAGO_UNAVAILABLE",
    httpStatus: 503,
  });

  const missingClient = new HttpLagoAccountBillingClient({
    apiKey: "lago_test",
    baseUrl: "https://billing.example.test",
    fetchImpl: async () => response({ error: "not_found" }, { status: 404 }),
  });
  assert.equal(await missingClient.getSubscription(SUBSCRIPTION_ID), null);
});

test("billing action ledger reclaims failed retryable rows for same request", async () => {
  const ddb = makeBillingActionLedgerDdb();
  const ledger = new DynamoBillingActionLedger({ ddb, tableName: "actions" });
  const started = await ledger.start({
    actorId: USER_ID,
    customerId: CUSTOMER_ID,
    idempotencyKey: "idem_retryable",
    now: new Date("2026-04-26T00:00:00.000Z"),
    orgId: ORG_ID,
    requestBody: { targetPlanCode: "free" },
    route: "POST /v1/account/billing/plan-change",
    targetPlanCode: "free",
  });
  assert.equal(started.kind, "started");
  assert.equal("actionId" in started, true);
  if (started.kind !== "started") throw new Error("expected ledger start");
  await ledger.fail({
    actionId: started.actionId,
    error: "Lago request failed before receiving a valid response",
    now: new Date("2026-04-26T00:00:01.000Z"),
    status: "failed_retryable",
  });

  const retry = await ledger.start({
    actorId: USER_ID,
    customerId: CUSTOMER_ID,
    idempotencyKey: "idem_retryable",
    now: new Date("2026-04-26T00:00:02.000Z"),
    orgId: ORG_ID,
    requestBody: { targetPlanCode: "free" },
    route: "POST /v1/account/billing/plan-change",
    targetPlanCode: "free",
  });

  assert.deepEqual(retry, { actionId: started.actionId, kind: "started" });
  assert.equal(ddb.getRecord(started.actionId)?.status, "processing");
  assert.equal(ddb.getRecord(started.actionId)?.lastError, undefined);
});

test("billing action ledger returns stored failure instead of replaying absent response body", async () => {
  const ddb = makeBillingActionLedgerDdb();
  const ledger = new DynamoBillingActionLedger({ ddb, tableName: "actions" });
  const first = await ledger.start({
    actorId: USER_ID,
    customerId: CUSTOMER_ID,
    idempotencyKey: "idem_permanent",
    now: new Date("2026-04-26T00:00:00.000Z"),
    orgId: ORG_ID,
    requestBody: {},
    route: "POST /v1/account/billing/portal-session",
  });
  if (first.kind !== "started") throw new Error("expected ledger start");
  await ledger.fail({
    actionId: first.actionId,
    error: "Lago rejected billing request with HTTP 422",
    now: new Date("2026-04-26T00:00:01.000Z"),
    status: "failed_permanent",
  });

  const retry = await ledger.start({
    actorId: USER_ID,
    customerId: CUSTOMER_ID,
    idempotencyKey: "idem_permanent",
    now: new Date("2026-04-26T00:00:02.000Z"),
    orgId: ORG_ID,
    requestBody: {},
    route: "POST /v1/account/billing/portal-session",
  });

  assert.equal(retry.kind, "failed_replay");
  if (retry.kind !== "failed_replay") throw new Error("expected failed replay");
  assert.equal(retry.record.lastError, "Lago rejected billing request with HTTP 422");
  assert.equal(retry.record.responseBody, undefined);
});

test("billing action ledger reclaims stale processing rows but rejects fresh in-flight rows", async () => {
  const ddb = makeBillingActionLedgerDdb();
  const ledger = new DynamoBillingActionLedger({ ddb, tableName: "actions" });
  const first = await ledger.start({
    actorId: USER_ID,
    customerId: CUSTOMER_ID,
    idempotencyKey: "idem_stale",
    now: new Date("2026-04-26T00:00:00.000Z"),
    orgId: ORG_ID,
    requestBody: { targetPlanCode: "free" },
    route: "POST /v1/account/billing/plan-change",
    targetPlanCode: "free",
  });
  if (first.kind !== "started") throw new Error("expected ledger start");

  const freshRetry = await ledger.start({
    actorId: USER_ID,
    customerId: CUSTOMER_ID,
    idempotencyKey: "idem_stale",
    now: new Date("2026-04-26T00:01:00.000Z"),
    orgId: ORG_ID,
    requestBody: { targetPlanCode: "free" },
    route: "POST /v1/account/billing/plan-change",
    targetPlanCode: "free",
  });
  assert.deepEqual(freshRetry, { kind: "conflict" });

  const staleRetry = await ledger.start({
    actorId: USER_ID,
    customerId: CUSTOMER_ID,
    idempotencyKey: "idem_stale",
    now: new Date("2026-04-26T00:03:00.000Z"),
    orgId: ORG_ID,
    requestBody: { targetPlanCode: "free" },
    route: "POST /v1/account/billing/plan-change",
    targetPlanCode: "free",
  });
  assert.deepEqual(staleRetry, { actionId: first.actionId, kind: "started" });
});

test("account billing service replays portal session while Lago is unavailable", async () => {
  const responseBody: BillingActionRecord["responseBody"] = {
    expiresAt: null,
    portalUrl: "https://portal.example.test/session",
    status: "created",
  };
  const ledger: BillingActionLedger = {
    async complete() {
      throw new Error("portal replay path should not complete");
    },
    async fail() {
      throw new Error("portal replay path should not fail");
    },
    async lookup() {
      return {
        kind: "replay",
        record: {
          actionId: "bact_portal_replay",
          actorId: USER_ID,
          createdAt: "2026-04-26T00:00:00.000Z",
          customerId: CUSTOMER_ID,
          idempotencyKeyHash: "hash",
          orgId: ORG_ID,
          requestHash: "hash",
          responseBody,
          route: "POST /v1/account/billing/portal-session",
          status: "succeeded",
          subscriptionExternalId: SUBSCRIPTION_ID,
          ttl: 1_798_156_800,
          updatedAt: "2026-04-26T00:00:01.000Z",
        },
      };
    },
    async start() {
      throw new Error("portal replay path should not start a fresh action");
    },
  };
  const service = createAccountBillingService({
    actionLedger: ledger,
    customersTableName: "customers",
    ddb: makeDdb({ envelope: makeEnvelope() }),
    enabled: true,
    keysTableName: "keys",
    lagoClient: makeUnavailableLagoClient(),
    lagoPaymentProviderCode: undefined,
    logger: console,
    now: () => new Date("2026-04-26T00:03:00.000Z"),
    planChangeAllowedOrgIds: new Set([ORG_ID]),
  });

  assert.deepEqual(
    await service.createPortalSession({
      idempotencyKey: "idem_portal_replay",
      principal: { orgId: ORG_ID, userId: USER_ID },
    }),
    responseBody,
  );
});

test("account billing service blocks plan changes when local envelope has pending transition metadata", async () => {
  const ledger = makeLedger();
  const lagoClient = makeLagoClient(null);
  const service = createAccountBillingService({
    actionLedger: ledger,
    customersTableName: "customers",
    ddb: makeDdb({ envelope: makeEnvelope({ lagoNextPlanCode: "free" }) }),
    enabled: true,
    keysTableName: "keys",
    lagoClient,
    lagoPaymentProviderCode: undefined,
    logger: console,
    now: () => new Date("2026-04-26T00:00:00.000Z"),
    planChangeAllowedOrgIds: new Set([ORG_ID]),
  });

  await assert.rejects(
    service.requestPlanChange({
      idempotencyKey: "idem_1",
      principal: { orgId: ORG_ID, userId: USER_ID },
      targetPlanCode: "free",
    }),
    (error: unknown) => {
      assert.ok(error instanceof AccountBillingError);
      assert.equal(error.code, "PLAN_CHANGE_ALREADY_PENDING");
      assert.deepEqual(error.details, { nextPlanCode: "free" });
      return true;
    },
  );
  assert.equal(ledger.starts, 1);
  assert.equal(lagoClient.upsertSubscriptionCalls, 0);
});

test("account billing service blocks plan changes when Lago subscription status is pending without next plan", async () => {
  const ledger = makeLedger();
  const lagoClient = makeLagoClient({
    downgradePlanDate: null,
    externalCustomerId: CUSTOMER_ID,
    externalSubscriptionId: SUBSCRIPTION_ID,
    nextPlanCode: null,
    planCode: "payg",
    previousPlanCode: null,
    status: "pending",
  });
  const service = createAccountBillingService({
    actionLedger: ledger,
    customersTableName: "customers",
    ddb: makeDdb({ envelope: makeEnvelope() }),
    enabled: true,
    keysTableName: "keys",
    lagoClient,
    lagoPaymentProviderCode: undefined,
    logger: console,
    now: () => new Date("2026-04-26T00:00:00.000Z"),
    planChangeAllowedOrgIds: new Set([ORG_ID]),
  });

  await assert.rejects(
    service.requestPlanChange({
      idempotencyKey: "idem_pending_status",
      principal: { orgId: ORG_ID, userId: USER_ID },
      targetPlanCode: "free",
    }),
    (error: unknown) => {
      assert.ok(error instanceof AccountBillingError);
      assert.equal(error.code, "PLAN_CHANGE_ALREADY_PENDING");
      assert.deepEqual(error.details, { nextPlanCode: null });
      return true;
    },
  );
  assert.equal(ledger.starts, 1);
  assert.equal(lagoClient.upsertSubscriptionCalls, 0);
});

test("account billing summary surfaces pending status from Lago when local metadata is absent", async () => {
  const service = createAccountBillingService({
    actionLedger: makeLedger(),
    customersTableName: "customers",
    ddb: makeDdb({ envelope: makeEnvelope() }),
    enabled: true,
    keysTableName: "keys",
    lagoClient: makeLagoClient({
      downgradePlanDate: null,
      externalCustomerId: CUSTOMER_ID,
      externalSubscriptionId: SUBSCRIPTION_ID,
      nextPlanCode: null,
      planCode: "payg",
      previousPlanCode: null,
      status: "pending",
    }),
    lagoPaymentProviderCode: undefined,
    logger: console,
    now: () => new Date("2026-04-26T00:00:00.000Z"),
    planChangeAllowedOrgIds: new Set([ORG_ID]),
  });

  const summary = await service.getBillingSummary({ orgId: ORG_ID });

  assert.equal(summary.plan.pending.status, "pending");
});

test("account billing service records submitted pending transition metadata on envelope and API keys", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const ledger = makeLedger();
  const lagoClient = makeLagoClient({
    downgradePlanDate: null,
    externalCustomerId: CUSTOMER_ID,
    externalSubscriptionId: SUBSCRIPTION_ID,
    nextPlanCode: null,
    planCode: "payg",
    previousPlanCode: null,
    status: "active",
  });
  const service = createAccountBillingService({
    actionLedger: ledger,
    customersTableName: "customers",
    ddb: makeDdb({ envelope: makeEnvelope(), updates }),
    enabled: true,
    keysTableName: "keys",
    lagoClient,
    lagoPaymentProviderCode: "stripe_default",
    logger: console,
    now: () => new Date("2026-04-26T00:00:00.000Z"),
    planChangeAllowedOrgIds: new Set([ORG_ID]),
  });

  const result = await service.requestPlanChange({
    idempotencyKey: "idem_2",
    principal: { orgId: ORG_ID, userId: USER_ID },
    targetPlanCode: "free",
  });

  assert.equal(result.status, "scheduled");
  assert.equal(ledger.starts, 1);
  assert.equal(ledger.completes, 2);
  assert.equal(lagoClient.upsertSubscriptionCalls, 1);
  assert.deepEqual(
    updates.map((update) => update.Key),
    [{ apiKeyHash: `ORG#${ORG_ID}` }, { apiKeyHash: API_KEY_HASH }],
  );
  for (const update of updates) {
    assert.deepEqual(update.ExpressionAttributeValues, {
      ":downgradePlanDate": "2026-05-25",
      ":externalSubscriptionId": SUBSCRIPTION_ID,
      ":nextPlanCode": "free",
      ":previousPlanCode": "payg",
      ":transitionStatus": "pending",
    });
  }
});

test("account billing service records no-op plan changes in the action ledger", async () => {
  const ledger = makeLedger();
  const lagoClient = makeLagoClient(null);
  const service = createAccountBillingService({
    actionLedger: ledger,
    customersTableName: "customers",
    ddb: makeDdb({ envelope: makeEnvelope() }),
    enabled: true,
    keysTableName: "keys",
    lagoClient,
    lagoPaymentProviderCode: undefined,
    logger: console,
    now: () => new Date("2026-04-26T00:00:00.000Z"),
    planChangeAllowedOrgIds: new Set([ORG_ID]),
  });

  const result = await service.requestPlanChange({
    idempotencyKey: "idem_noop",
    principal: { orgId: ORG_ID, userId: USER_ID },
    targetPlanCode: "payg",
  });

  assert.deepEqual(result, {
    currentPlanCode: "payg",
    status: "noop",
    targetPlanCode: "payg",
  });
  assert.equal(ledger.starts, 1);
  assert.equal(ledger.completes, 1);
  assert.equal(lagoClient.upsertSubscriptionCalls, 0);
});

test("account billing service does not return noop when a different plan transition is pending", async () => {
  const ledger = makeLedger();
  const lagoClient = makeLagoClient(null);
  const service = createAccountBillingService({
    actionLedger: ledger,
    customersTableName: "customers",
    ddb: makeDdb({
      envelope: makeEnvelope({
        lagoDowngradePlanDate: "2026-05-25",
        lagoNextPlanCode: "free",
        lagoPlanTransitionStatus: "pending",
        lagoPreviousPlanCode: "payg",
      }),
    }),
    enabled: true,
    keysTableName: "keys",
    lagoClient,
    lagoPaymentProviderCode: undefined,
    logger: console,
    now: () => new Date("2026-04-26T00:00:00.000Z"),
    planChangeAllowedOrgIds: new Set([ORG_ID]),
  });

  await assert.rejects(
    service.requestPlanChange({
      idempotencyKey: "idem_noop_pending",
      principal: { orgId: ORG_ID, userId: USER_ID },
      targetPlanCode: "payg",
    }),
    (error: unknown) => {
      assert.ok(error instanceof AccountBillingError);
      assert.equal(error.code, "PLAN_CHANGE_ALREADY_PENDING");
      assert.deepEqual(error.details, { nextPlanCode: "free" });
      return true;
    },
  );
  assert.equal(ledger.starts, 1);
  assert.equal(ledger.completes, 0);
  assert.equal(lagoClient.upsertSubscriptionCalls, 0);
});

test("account billing service replays scheduled plan change even after pending metadata exists", async () => {
  const responseBody: BillingActionRecord["responseBody"] = {
    currentPlanCode: "payg",
    effectiveAt: "2026-05-25",
    status: "scheduled",
    subscriptionExternalId: SUBSCRIPTION_ID,
    targetPlanCode: "free",
  };
  const ledger: BillingActionLedger = {
    async complete() {
      throw new Error("replay path should not complete");
    },
    async fail() {
      throw new Error("replay path should not fail");
    },
    async lookup() {
      return {
        kind: "replay",
        record: {
          actionId: "bact_replay",
          actorId: USER_ID,
          createdAt: "2026-04-26T00:00:00.000Z",
          customerId: CUSTOMER_ID,
          idempotencyKeyHash: "hash",
          orgId: ORG_ID,
          previousPlanCode: "payg",
          requestHash: "hash",
          responseBody,
          route: "POST /v1/account/billing/plan-change",
          status: "succeeded",
          subscriptionExternalId: SUBSCRIPTION_ID,
          targetPlanCode: "free",
          ttl: 1_798_156_800,
          updatedAt: "2026-04-26T00:00:01.000Z",
        },
      };
    },
    async start() {
      throw new Error("replay path should not start a fresh action");
    },
  };
  const lagoClient = makeUnavailableLagoClient();
  const service = createAccountBillingService({
    actionLedger: ledger,
    customersTableName: "customers",
    ddb: makeDdb({
      envelope: makeEnvelope({
        lagoDowngradePlanDate: "2026-05-25",
        lagoNextPlanCode: "free",
        lagoPlanTransitionStatus: "pending",
        lagoPreviousPlanCode: "payg",
      }),
    }),
    enabled: true,
    keysTableName: "keys",
    lagoClient,
    lagoPaymentProviderCode: undefined,
    logger: console,
    now: () => new Date("2026-04-26T00:03:00.000Z"),
    planChangeAllowedOrgIds: new Set([ORG_ID]),
  });

  assert.deepEqual(
    await service.requestPlanChange({
      idempotencyKey: "idem_replay",
      principal: { orgId: ORG_ID, userId: USER_ID },
      targetPlanCode: "free",
    }),
    responseBody,
  );
  assert.equal(lagoClient.upsertSubscriptionCalls, 0);
});

test("account billing service replays stored failed plan change while Lago is unavailable", async () => {
  const ledger: BillingActionLedger = {
    async complete() {
      throw new Error("failed replay path should not complete");
    },
    async fail() {
      throw new Error("failed replay path should not fail again");
    },
    async lookup() {
      return {
        kind: "failed_replay",
        record: {
          actionId: "bact_failed_replay",
          actorId: USER_ID,
          createdAt: "2026-04-26T00:00:00.000Z",
          customerId: CUSTOMER_ID,
          idempotencyKeyHash: "hash",
          lastError: "Lago rejected billing request with HTTP 422",
          orgId: ORG_ID,
          previousPlanCode: "payg",
          requestHash: "hash",
          route: "POST /v1/account/billing/plan-change",
          status: "failed_permanent",
          subscriptionExternalId: SUBSCRIPTION_ID,
          targetPlanCode: "free",
          ttl: 1_798_156_800,
          updatedAt: "2026-04-26T00:00:01.000Z",
        },
      };
    },
    async start() {
      throw new Error("failed replay path should not start a fresh action");
    },
  };
  const service = createAccountBillingService({
    actionLedger: ledger,
    customersTableName: "customers",
    ddb: makeDdb({ envelope: makeEnvelope() }),
    enabled: true,
    keysTableName: "keys",
    lagoClient: makeUnavailableLagoClient(),
    lagoPaymentProviderCode: undefined,
    logger: console,
    now: () => new Date("2026-04-26T00:03:00.000Z"),
    planChangeAllowedOrgIds: new Set([ORG_ID]),
  });

  await assert.rejects(
    service.requestPlanChange({
      idempotencyKey: "idem_failed_replay",
      principal: { orgId: ORG_ID, userId: USER_ID },
      targetPlanCode: "free",
    }),
    { code: "BILLING_ACTION_FAILED", httpStatus: 500 },
  );
});

test("account billing service resumes accepted Lago plan change without resubmitting provider mutation", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const completedStatuses: string[] = [];
  const providerSubscriptionState: LagoSubscriptionState = {
    downgradePlanDate: "2026-05-25",
    externalCustomerId: CUSTOMER_ID,
    externalSubscriptionId: SUBSCRIPTION_ID,
    nextPlanCode: "free",
    planCode: "payg",
    previousPlanCode: "payg",
    status: "active",
  };
  const record: BillingActionRecord = {
    actionId: "bact_resume",
    actorId: USER_ID,
    createdAt: "2026-04-26T00:00:00.000Z",
    customerId: CUSTOMER_ID,
    idempotencyKeyHash: "hash",
    orgId: ORG_ID,
    previousPlanCode: "payg",
    providerStatus: "active",
    providerSubscriptionState,
    requestHash: "hash",
    responseBody: {
      currentPlanCode: "payg",
      effectiveAt: "2026-05-25",
      status: "scheduled",
      subscriptionExternalId: SUBSCRIPTION_ID,
      targetPlanCode: "free",
    },
    route: "POST /v1/account/billing/plan-change",
    status: "failed_retryable",
    subscriptionExternalId: SUBSCRIPTION_ID,
    targetPlanCode: "free",
    ttl: 1_798_156_800,
    updatedAt: "2026-04-26T00:00:01.000Z",
  };
  const ledger: BillingActionLedger = {
    async complete(input) {
      completedStatuses.push(input.status);
    },
    async fail() {
      throw new Error("resume path should not fail");
    },
    async lookup() {
      return { actionId: "bact_resume", kind: "resume", record };
    },
    async start() {
      throw new Error("resume path should not start a fresh action");
    },
  };
  const lagoClient = makeUnavailableLagoClient();
  const service = createAccountBillingService({
    actionLedger: ledger,
    customersTableName: "customers",
    ddb: makeDdb({
      envelope: makeEnvelope({
        lagoDowngradePlanDate: "2026-05-25",
        lagoNextPlanCode: "free",
        lagoPlanTransitionStatus: "pending",
        lagoPreviousPlanCode: "payg",
      }),
      updates,
    }),
    enabled: true,
    keysTableName: "keys",
    lagoClient,
    lagoPaymentProviderCode: "stripe_default",
    logger: console,
    now: () => new Date("2026-04-26T00:03:00.000Z"),
    planChangeAllowedOrgIds: new Set([ORG_ID]),
  });

  const result = await service.requestPlanChange({
    idempotencyKey: "idem_resume",
    principal: { orgId: ORG_ID, userId: USER_ID },
    targetPlanCode: "free",
  });

  assert.equal(result.status, "scheduled");
  assert.equal(lagoClient.upsertSubscriptionCalls, 0);
  assert.deepEqual(completedStatuses, ["succeeded"]);
  assert.deepEqual(
    updates.map((update) => update.Key),
    [{ apiKeyHash: `ORG#${ORG_ID}` }, { apiKeyHash: API_KEY_HASH }],
  );
});
