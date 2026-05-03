import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type {
  BillingActionInput,
  BillingActionRecord,
  BillingActionStore,
  BillingPlanChangeResult,
  LagoBillingSubscription,
  LagoPlanChangeClient,
} from "./billing-plan-change.js";
import {
  BILLING_PLAN_CHANGE_PRODUCT_POOL,
  buildBillingActionId,
  buildBillingActionRequestHash,
  createBillingPlanChangeService,
  DynamoBillingActionStore,
  HttpLagoPlanChangeClient,
  LagoPlanChangeError,
} from "./billing-plan-change.js";
import { deriveLagoExternalSubscriptionIdForOrg } from "@prontiq/shared";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeAction(input: BillingActionInput, status: BillingActionRecord["status"]) {
  const now = "2026-04-30T00:00:00.000Z";
  return {
    actionId: buildBillingActionId(input),
    actorUserId: input.actorUserId,
    attemptToken: "attempt_1",
    createdAt: now,
    externalSubscriptionId: input.externalSubscriptionId,
    idempotencyKeyHash: "hash",
    leaseExpiresAt: Date.parse(now) + 120_000,
    orgId: input.orgId,
    productPool: input.productPool,
    requestHash: buildBillingActionRequestHash(input),
    route: "billing.plan-change",
    status,
    targetPlanCode: input.targetPlanCode,
    ttl: 1_798_675_200,
    updatedAt: now,
  } satisfies BillingActionRecord;
}

function makeStore(overrides: Partial<BillingActionStore> = {}): BillingActionStore {
  return {
    async claim(input) {
      return { action: makeAction(input, "processing"), kind: "claimed" };
    },
    async finalizeFailure() {},
    async finalizeSuccess() {},
    async inspectOrgLock() {
      return { kind: "none" };
    },
    async inspect() {
      return { kind: "none" };
    },
    async markProviderMutationStarted(input) {
      return { ...input.action, status: "provider_in_flight" };
    },
    ...overrides,
  };
}

function makeSubscription(input: Partial<LagoBillingSubscription> = {}): LagoBillingSubscription {
  return {
    downgradePlanDate: null,
    externalCustomerId: "org_test",
    externalId: deriveLagoExternalSubscriptionIdForOrg("org_test"),
    nextPlanCode: null,
    planCode: "payg_aud",
    planName: "Pay As You Go",
    previousPlanCode: null,
    status: "active",
    ...input,
  };
}

function makeClient(overrides: Partial<LagoPlanChangeClient> = {}): LagoPlanChangeClient {
  return {
    async changeSubscriptionPlan(input) {
      return makeSubscription({ planCode: input.targetPlanCode });
    },
    async getSubscription() {
      return makeSubscription();
    },
    async listVisiblePlanCodes() {
      return ["free", "payg_aud", "starter"];
    },
    ...overrides,
  };
}

test("createBillingPlanChangeService submits visible Lago plan changes with ledger replay evidence", async () => {
  const finalized: BillingPlanChangeResult[] = [];
  const claimedProductPools: string[] = [];
  const inspectedLockProductPools: string[] = [];
  const service = createBillingPlanChangeService({
    client: makeClient(),
    store: makeStore({
      async claim(input) {
        claimedProductPools.push(input.productPool);
        return { action: makeAction(input, "processing"), kind: "claimed" };
      },
      async finalizeSuccess(input) {
        finalized.push(input.responseBody);
      },
      async inspectOrgLock(input) {
        inspectedLockProductPools.push(input.productPool);
        return { kind: "none" };
      },
    }),
  });

  const result = await service.changePlan({
    actorUserId: "user_test",
    idempotencyKey: "idem_1",
    orgId: "org_test",
    targetPlanCode: "starter",
  });

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.responseBody.status, "accepted");
  assert.equal(result.responseBody.targetPlanCode, "starter");
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0]?.targetPlanCode, "starter");
  assert.deepEqual(claimedProductPools, [BILLING_PLAN_CHANGE_PRODUCT_POOL]);
  assert.deepEqual(inspectedLockProductPools, [BILLING_PLAN_CHANGE_PRODUCT_POOL]);
});

test("createBillingPlanChangeService rejects target plans not exposed by Lago catalog", async () => {
  const failures: Array<{ code: string; status: string }> = [];
  const service = createBillingPlanChangeService({
    client: makeClient({
      async listVisiblePlanCodes() {
        return ["free"];
      },
    }),
    store: makeStore({
      async finalizeFailure(input) {
        failures.push({ code: input.errorCode, status: input.status });
      },
    }),
  });

  const result = await service.changePlan({
    actorUserId: "user_test",
    idempotencyKey: "idem_2",
    orgId: "org_test",
    targetPlanCode: "starter",
  });

  assert.equal(result.kind, "provider_error");
  if (result.kind !== "provider_error") return;
  assert.equal(result.code, "TARGET_PLAN_NOT_AVAILABLE");
  assert.equal(result.status, 400);
  assert.deepEqual(failures, [{ code: "TARGET_PLAN_NOT_AVAILABLE", status: "failed_permanent" }]);
});

test("createBillingPlanChangeService maps Lago payment-method failures to retry-safe 409", async () => {
  const service = createBillingPlanChangeService({
    client: makeClient({
      async changeSubscriptionPlan() {
        throw new LagoPlanChangeError({
          details: { base: ["payment_method_required"] },
          message: "payment method required",
          status: 422,
        });
      },
    }),
    store: makeStore(),
  });

  const result = await service.changePlan({
    actorUserId: "user_test",
    idempotencyKey: "idem_3",
    orgId: "org_test",
    targetPlanCode: "starter",
  });

  assert.equal(result.kind, "provider_error");
  if (result.kind !== "provider_error") return;
  assert.equal(result.code, "PAYMENT_METHOD_REQUIRED");
  assert.equal(result.status, 409);
});

test("createBillingPlanChangeService fences ambiguous provider failures as outcome_unknown", async () => {
  const failures: Array<{ code: string; status: string }> = [];
  const service = createBillingPlanChangeService({
    client: makeClient({
      async changeSubscriptionPlan() {
        throw new LagoPlanChangeError({
          message: "Lago request failed with HTTP 500",
          status: 500,
        });
      },
    }),
    store: makeStore({
      async finalizeFailure(input) {
        failures.push({ code: input.errorCode, status: input.status });
      },
    }),
  });

  const result = await service.changePlan({
    actorUserId: "user_test",
    idempotencyKey: "idem_provider_500",
    orgId: "org_test",
    targetPlanCode: "starter",
  });

  assert.equal(result.kind, "provider_error");
  if (result.kind !== "provider_error") return;
  assert.equal(result.code, "LAGO_PLAN_CHANGE_OUTCOME_UNKNOWN");
  assert.equal(result.status, 409);
  assert.deepEqual(failures, [{ code: "LAGO_PLAN_CHANGE_FAILED", status: "outcome_unknown" }]);
});

test("createBillingPlanChangeService blocks a different idempotency key while org transition is fenced", async () => {
  let claimed = false;
  const service = createBillingPlanChangeService({
    client: makeClient(),
    store: makeStore({
      async claim(input) {
        claimed = true;
        return { action: makeAction(input, "processing"), kind: "claimed" };
      },
      async inspectOrgLock() {
        return {
          kind: "active",
          lock: {
            actionId: "LOCK#billing.plan-change#org_test",
            createdAt: "2026-04-30T00:00:00.000Z",
            leaseExpiresAt: Date.now() + 60_000,
            lockOwnerActionId: "different_action",
            lockOwnerAttemptToken: "attempt_other",
            orgId: "org_test",
            productPool: BILLING_PLAN_CHANGE_PRODUCT_POOL,
            route: "billing.plan-change",
            targetPlanCode: "starter",
            ttl: 1_798_675_200,
            updatedAt: "2026-04-30T00:00:00.000Z",
          },
        };
      },
    }),
  });

  const result = await service.changePlan({
    actorUserId: "user_test",
    idempotencyKey: "new_idempotency_key",
    orgId: "org_test",
    targetPlanCode: "payg_aud",
  });

  assert.equal(result.kind, "transition_in_progress");
  assert.equal(claimed, false);
});

test("createBillingPlanChangeService allows same-key retry when a legacy unscoped lock owns the org fence", async () => {
  let claimed = false;
  const legacyActionId = sha256(["org_test", "billing.plan-change", "idem_legacy_retry"].join("\n"));
  const service = createBillingPlanChangeService({
    client: makeClient(),
    store: makeStore({
      async claim(input) {
        claimed = true;
        return { action: makeAction(input, "processing"), kind: "claimed" };
      },
      async inspectOrgLock() {
        return {
          kind: "active",
          lock: {
            actionId: "LOCK#billing.plan-change#org_test",
            createdAt: "2026-04-30T00:00:00.000Z",
            leaseExpiresAt: Date.now() + 60_000,
            lockOwnerActionId: legacyActionId,
            lockOwnerAttemptToken: "attempt_legacy",
            orgId: "org_test",
            productPool: BILLING_PLAN_CHANGE_PRODUCT_POOL,
            route: "billing.plan-change",
            targetPlanCode: "starter",
            ttl: 1_798_675_200,
            updatedAt: "2026-04-30T00:00:00.000Z",
          },
        };
      },
    }),
  });

  const result = await service.changePlan({
    actorUserId: "user_test",
    idempotencyKey: "idem_legacy_retry",
    orgId: "org_test",
    targetPlanCode: "starter",
  });

  assert.equal(claimed, true);
  assert.notEqual(result.kind, "transition_in_progress");
});

test("createBillingPlanChangeService blocks a different key while an unresolved legacy org fence is active", async () => {
  let claimed = false;
  const legacyActionId = sha256(["org_test", "billing.plan-change", "idem_legacy_unknown"].join("\n"));
  const service = createBillingPlanChangeService({
    client: makeClient(),
    store: makeStore({
      async claim(input) {
        claimed = true;
        return { action: makeAction(input, "processing"), kind: "claimed" };
      },
      async inspectOrgLock() {
        return {
          kind: "active",
          lock: {
            actionId: "LOCK#billing.plan-change#org_test",
            createdAt: "2026-04-30T00:00:00.000Z",
            leaseExpiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
            lockOwnerActionId: legacyActionId,
            lockOwnerAttemptToken: "attempt_legacy",
            orgId: "org_test",
            productPool: BILLING_PLAN_CHANGE_PRODUCT_POOL,
            route: "billing.plan-change",
            targetPlanCode: "starter",
            ttl: 1_798_675_200,
            updatedAt: "2026-04-30T00:00:00.000Z",
          },
        };
      },
    }),
  });

  const result = await service.changePlan({
    actorUserId: "user_test",
    idempotencyKey: "new_idempotency_key",
    orgId: "org_test",
    targetPlanCode: "payg_aud",
  });

  assert.equal(result.kind, "transition_in_progress");
  assert.equal(claimed, false);
});

test("DynamoBillingActionStore keeps the org lock when finalizing outcome_unknown", async () => {
  const action = makeAction({
    actorUserId: "user_test",
    externalSubscriptionId: deriveLagoExternalSubscriptionIdForOrg("org_test"),
    idempotencyKey: "idem_unknown",
    orgId: "org_test",
    productPool: BILLING_PLAN_CHANGE_PRODUCT_POOL,
    targetPlanCode: "starter",
  }, "provider_in_flight");
  let transactItems: unknown[] | undefined;
  const ddb = {
    async send(command: unknown) {
      const input = (command as { input?: { TransactItems?: unknown[] } }).input;
      transactItems = input?.TransactItems;
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  const store = new DynamoBillingActionStore({
    ddb,
    now: () => new Date("2026-04-30T00:00:00.000Z"),
    tableName: "billing-actions-test",
  });

  await store.finalizeFailure({
    action,
    errorCode: "LAGO_PLAN_CHANGE_FAILED",
    errorMessage: "Lago request failed with HTTP 500",
    errorStatus: 502,
    status: "outcome_unknown",
  });

  assert.equal(transactItems?.length, 2);
  assert.ok((transactItems?.[1] as { Update?: unknown }).Update);
  assert.equal((transactItems?.[1] as { Delete?: unknown }).Delete, undefined);
});

test("DynamoBillingActionStore migrates a retryable legacy action fence to the scoped lock during claim", async () => {
  const input: BillingActionInput = {
    actorUserId: "user_test",
    externalSubscriptionId: deriveLagoExternalSubscriptionIdForOrg("org_test"),
    idempotencyKey: "idem_legacy_retryable",
    orgId: "org_test",
    productPool: BILLING_PLAN_CHANGE_PRODUCT_POOL,
    targetPlanCode: "starter",
  };
  const now = "2026-04-30T00:00:00.000Z";
  const legacyActionId = sha256([input.orgId, "billing.plan-change", input.idempotencyKey].join("\n"));
  const legacyLockId = `LOCK#billing.plan-change#${input.orgId}`;
  const scopedLockId = `LOCK#billing.plan-change#ADDRESS#${input.orgId}`;
  const legacyRequestHash = sha256(
    [
      "POST",
      "/v1/account/billing/plan-change",
      input.orgId,
      input.externalSubscriptionId,
      input.targetPlanCode,
    ].join("\n"),
  );
  let transactItems: unknown[] | undefined;
  const ddb = {
    async send(command: unknown) {
      const commandInput = (command as {
        input?: {
          Key?: { actionId?: string };
          TransactItems?: unknown[];
        };
      }).input;
      if (commandInput?.TransactItems) {
        transactItems = commandInput.TransactItems;
        return {};
      }
      if (commandInput?.Key?.actionId !== legacyActionId) return {};
      return {
        Item: {
          actionId: legacyActionId,
          actorUserId: input.actorUserId,
          attemptToken: "attempt_legacy_old",
          createdAt: now,
          externalSubscriptionId: input.externalSubscriptionId,
          idempotencyKeyHash: "hash",
          leaseExpiresAt: Date.parse(now) - 1,
          orgId: input.orgId,
          requestHash: legacyRequestHash,
          route: "billing.plan-change",
          status: "failed_retryable",
          targetPlanCode: input.targetPlanCode,
          ttl: 1_798_675_200,
          updatedAt: now,
        },
      };
    },
  } as unknown as DynamoDBDocumentClient;
  const store = new DynamoBillingActionStore({
    ddb,
    now: () => new Date(now),
    tableName: "billing-actions-test",
  });

  const claim = await store.claim(input);

  assert.equal(claim.kind, "claimed");
  if (claim.kind !== "claimed") return;
  assert.equal(claim.action.actionId, legacyActionId);
  assert.equal(transactItems?.length, 3);
  assert.equal((transactItems?.[1] as { Put?: { Item?: { actionId?: string } } }).Put?.Item?.actionId, scopedLockId);
  assert.equal((transactItems?.[2] as { Delete?: { Key?: { actionId?: string } } }).Delete?.Key?.actionId, legacyLockId);
});

test("DynamoBillingActionStore can replay legacy unscoped action rows", async () => {
  const input: BillingActionInput = {
    actorUserId: "user_test",
    externalSubscriptionId: deriveLagoExternalSubscriptionIdForOrg("org_test"),
    idempotencyKey: "idem_legacy",
    orgId: "org_test",
    productPool: BILLING_PLAN_CHANGE_PRODUCT_POOL,
    targetPlanCode: "starter",
  };
  const now = "2026-04-30T00:00:00.000Z";
  const legacyActionId = sha256([input.orgId, "billing.plan-change", input.idempotencyKey].join("\n"));
  const legacyRequestHash = sha256(
    [
      "POST",
      "/v1/account/billing/plan-change",
      input.orgId,
      input.externalSubscriptionId,
      input.targetPlanCode,
    ].join("\n"),
  );
  const seenKeys: string[] = [];
  const ddb = {
    async send(command: unknown) {
      const key = (command as { input?: { Key?: { actionId?: string } } }).input?.Key?.actionId ?? "";
      seenKeys.push(key);
      if (key !== legacyActionId) return {};
      return {
        Item: {
          actionId: legacyActionId,
          actorUserId: input.actorUserId,
          attemptToken: "attempt_legacy",
          createdAt: now,
          externalSubscriptionId: input.externalSubscriptionId,
          idempotencyKeyHash: "hash",
          leaseExpiresAt: Date.parse(now) + 120_000,
          orgId: input.orgId,
          requestHash: legacyRequestHash,
          route: "billing.plan-change",
          status: "provider_accepted",
          targetPlanCode: input.targetPlanCode,
          ttl: 1_798_675_200,
          updatedAt: now,
        },
      };
    },
  } as unknown as DynamoDBDocumentClient;
  const store = new DynamoBillingActionStore({
    ddb,
    now: () => new Date(now),
    tableName: "billing-actions-test",
  });

  const inspected = await store.inspect(input);

  assert.equal(inspected.kind, "replay");
  if (inspected.kind !== "replay") return;
  assert.equal(inspected.action.actionId, legacyActionId);
  assert.equal(inspected.action.productPool, BILLING_PLAN_CHANGE_PRODUCT_POOL);
  assert.deepEqual(seenKeys, [buildBillingActionId(input), legacyActionId]);
});

test("DynamoBillingActionStore can inspect legacy unscoped org locks", async () => {
  const orgId = "org_test";
  const legacyLockId = `LOCK#billing.plan-change#${orgId}`;
  const seenKeys: string[] = [];
  const ddb = {
    async send(command: unknown) {
      const key = (command as { input?: { Key?: { actionId?: string } } }).input?.Key?.actionId ?? "";
      seenKeys.push(key);
      if (key !== legacyLockId) return {};
      return {
        Item: {
          actionId: legacyLockId,
          createdAt: "2026-04-30T00:00:00.000Z",
          leaseExpiresAt: Date.parse("2026-04-30T00:01:00.000Z"),
          lockOwnerActionId: "legacy_action_id",
          lockOwnerAttemptToken: "attempt_legacy",
          orgId,
          route: "billing.plan-change",
          targetPlanCode: "starter",
          ttl: 1_798_675_200,
          updatedAt: "2026-04-30T00:00:00.000Z",
        },
      };
    },
  } as unknown as DynamoDBDocumentClient;
  const store = new DynamoBillingActionStore({
    ddb,
    now: () => new Date("2026-04-30T00:00:30.000Z"),
    tableName: "billing-actions-test",
  });

  const inspected = await store.inspectOrgLock({
    orgId,
    productPool: BILLING_PLAN_CHANGE_PRODUCT_POOL,
  });

  assert.equal(inspected.kind, "active");
  if (inspected.kind !== "active") return;
  assert.equal(inspected.lock.actionId, legacyLockId);
  assert.equal(inspected.lock.productPool, BILLING_PLAN_CHANGE_PRODUCT_POOL);
  assert.deepEqual(seenKeys, [`LOCK#billing.plan-change#ADDRESS#${orgId}`, legacyLockId]);
});

test("DynamoBillingActionStore falls back to an active legacy lock when the scoped lock is expired", async () => {
  const orgId = "org_test";
  const scopedLockId = `LOCK#billing.plan-change#ADDRESS#${orgId}`;
  const legacyLockId = `LOCK#billing.plan-change#${orgId}`;
  const seenKeys: string[] = [];
  const ddb = {
    async send(command: unknown) {
      const key = (command as { input?: { Key?: { actionId?: string } } }).input?.Key?.actionId ?? "";
      seenKeys.push(key);
      if (key === scopedLockId) {
        return {
          Item: {
            actionId: scopedLockId,
            createdAt: "2026-04-30T00:00:00.000Z",
            leaseExpiresAt: Date.parse("2026-04-30T00:00:10.000Z"),
            lockOwnerActionId: "expired_scoped_action",
            lockOwnerAttemptToken: "attempt_scoped",
            orgId,
            productPool: BILLING_PLAN_CHANGE_PRODUCT_POOL,
            route: "billing.plan-change",
            targetPlanCode: "starter",
            ttl: 1_798_675_200,
            updatedAt: "2026-04-30T00:00:00.000Z",
          },
        };
      }
      if (key === legacyLockId) {
        return {
          Item: {
            actionId: legacyLockId,
            createdAt: "2026-04-30T00:00:00.000Z",
            leaseExpiresAt: Date.parse("2026-04-30T00:01:00.000Z"),
            lockOwnerActionId: "active_legacy_action",
            lockOwnerAttemptToken: "attempt_legacy",
            orgId,
            route: "billing.plan-change",
            targetPlanCode: "payg_aud",
            ttl: 1_798_675_200,
            updatedAt: "2026-04-30T00:00:00.000Z",
          },
        };
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  const store = new DynamoBillingActionStore({
    ddb,
    now: () => new Date("2026-04-30T00:00:30.000Z"),
    tableName: "billing-actions-test",
  });

  const inspected = await store.inspectOrgLock({
    orgId,
    productPool: BILLING_PLAN_CHANGE_PRODUCT_POOL,
  });

  assert.equal(inspected.kind, "active");
  if (inspected.kind !== "active") return;
  assert.equal(inspected.lock.actionId, legacyLockId);
  assert.equal(inspected.lock.lockOwnerActionId, "active_legacy_action");
  assert.deepEqual(seenKeys, [scopedLockId, legacyLockId]);
});

test("createBillingPlanChangeService keeps pre-mutation Lago read failures retryable", async () => {
  const failures: Array<{ code: string; status: string }> = [];
  let mutationCalled = false;
  const service = createBillingPlanChangeService({
    client: makeClient({
      async changeSubscriptionPlan() {
        mutationCalled = true;
        return makeSubscription({ planCode: "starter" });
      },
      async getSubscription() {
        throw new Error("Lago read unavailable");
      },
    }),
    store: makeStore({
      async finalizeFailure(input) {
        failures.push({ code: input.errorCode, status: input.status });
      },
    }),
  });

  const result = await service.changePlan({
    actorUserId: "user_test",
    idempotencyKey: "idem_5",
    orgId: "org_test",
    targetPlanCode: "starter",
  });

  assert.equal(result.kind, "provider_error");
  assert.equal(mutationCalled, false);
  assert.deepEqual(failures, [{ code: "LAGO_PLAN_CHANGE_FAILED", status: "failed_retryable" }]);
});

test("createBillingPlanChangeService returns pending without mutating Lago when Lago has next plan", async () => {
  let changed = false;
  const service = createBillingPlanChangeService({
    client: makeClient({
      async changeSubscriptionPlan() {
        changed = true;
        return makeSubscription({ planCode: "starter" });
      },
      async getSubscription() {
        return makeSubscription({ nextPlanCode: "starter" });
      },
    }),
    store: makeStore(),
  });

  const result = await service.changePlan({
    actorUserId: "user_test",
    idempotencyKey: "idem_4",
    orgId: "org_test",
    targetPlanCode: "starter",
  });

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.responseBody.status, "pending");
  assert.equal(changed, false);
});

test("HttpLagoPlanChangeClient reads all Lago plan pages before exposing visible codes", async () => {
  const fetchMock = test.mock.fn<typeof fetch>(async (url) => {
    const page = new URL(String(url)).searchParams.get("page");
    if (page === "1") {
      return new Response(
        JSON.stringify({
          plans: [
            {
              code: "free",
              metadata: { prontiq_console_visible: true, prontiq_environment: "dev" },
            },
          ],
          meta: { current_page: 1, total_pages: 2 },
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        plans: [
          {
            code: "starter",
            metadata: { prontiq_console_visible: true, prontiq_environment: "dev" },
          },
        ],
        meta: { current_page: 2, total_pages: 2 },
      }),
      { status: 200 },
    );
  });
  const client = new HttpLagoPlanChangeClient({
    apiKey: "test-key",
    baseUrl: "https://billing-dev.prontiq.dev",
    catalogEnv: "dev",
    fetchImpl: fetchMock,
  });

  assert.deepEqual(await client.listVisiblePlanCodes(), ["free", "starter"]);
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(
    String(fetchMock.mock.calls[0]?.arguments[0]),
    "https://billing-dev.prontiq.dev/api/v1/plans?page=1&per_page=100",
  );
  assert.equal(
    String(fetchMock.mock.calls[1]?.arguments[0]),
    "https://billing-dev.prontiq.dev/api/v1/plans?page=2&per_page=100",
  );
});
