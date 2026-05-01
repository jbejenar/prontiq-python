import test from "node:test";
import assert from "node:assert/strict";
import type {
  BillingActionInput,
  BillingActionRecord,
  BillingActionStore,
  BillingPlanChangeResult,
  LagoBillingSubscription,
  LagoPlanChangeClient,
} from "./billing-plan-change.js";
import {
  buildBillingActionId,
  buildBillingActionRequestHash,
  createBillingPlanChangeService,
  DynamoBillingActionStore,
  HttpLagoPlanChangeClient,
  LagoPlanChangeError,
} from "./billing-plan-change.js";
import { deriveLagoExternalSubscriptionIdForOrg } from "@prontiq/shared";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

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
  const service = createBillingPlanChangeService({
    client: makeClient(),
    store: makeStore({
      async finalizeSuccess(input) {
        finalized.push(input.responseBody);
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

test("DynamoBillingActionStore keeps the org lock when finalizing outcome_unknown", async () => {
  const action = makeAction({
    actorUserId: "user_test",
    externalSubscriptionId: deriveLagoExternalSubscriptionIdForOrg("org_test"),
    idempotencyKey: "idem_unknown",
    orgId: "org_test",
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
