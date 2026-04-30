import { describe, expect, test, vi, beforeEach } from "vitest";

const authMocks = vi.hoisted(() => ({
  getBillingPrincipal: vi.fn(),
  requireBillingAdmin: vi.fn(),
  requireBillingReverification: vi.fn(),
  requireSameOrigin: vi.fn(),
}));

const actionStore = vi.hoisted(() => ({
  claim: vi.fn(),
  finalizeFailure: vi.fn(),
  finalizeSuccess: vi.fn(),
  inspect: vi.fn(),
  markProviderMutationStarted: vi.fn(),
}));

const actionMocks = vi.hoisted(() => ({
  createBillingActionStore: vi.fn(() => actionStore),
}));

const serviceMocks = vi.hoisted(() => ({
  changeBillingPlan: vi.fn(),
  externalSubscriptionIdForOrg: vi.fn((orgId: string) => `lago_sub_${orgId}`),
}));

const envMocks = vi.hoisted(() => ({
  getBillingActionsServerEnv: vi.fn(),
}));

vi.mock("../../../../lib/billing-auth.js", () => authMocks);
vi.mock("../../../../lib/billing-actions.js", () => actionMocks);
vi.mock("../../../../lib/billing-service.js", () => serviceMocks);
vi.mock("../../../../lib/server-env.js", () => envMocks);

import { POST } from "./route.js";

function request(input: { body?: unknown; idempotencyKey?: string } = {}) {
  return new Request("https://console.prontiq.dev/api/billing/plan-change", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
    },
    body: JSON.stringify(input.body ?? { targetPlanCode: "starter" }),
  });
}

function actionRecord() {
  return {
    actionId: "action_123",
    actorUserId: "user_123",
    attemptToken: "attempt_123",
    createdAt: "2026-04-30T00:00:00.000Z",
    externalSubscriptionId: "lago_sub_org_123",
    idempotencyKeyHash: "hash",
    leaseExpiresAt: Date.now() + 60_000,
    orgId: "org_123",
    requestHash: "request_hash",
    route: "billing.plan-change",
    status: "processing",
    targetPlanCode: "starter",
    ttl: 1_809_000_000,
    updatedAt: "2026-04-30T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.requireSameOrigin.mockReturnValue(null);
  authMocks.getBillingPrincipal.mockResolvedValue({
    canManageBilling: true,
    fva: [0, 1],
    orgId: "org_123",
    orgRole: "org:admin",
    userId: "user_123",
  });
  authMocks.requireBillingAdmin.mockReturnValue(null);
  authMocks.requireBillingReverification.mockReturnValue(null);
  envMocks.getBillingActionsServerEnv.mockReturnValue({
    accessKeyId: "key",
    allowedOrgIds: null,
    enabled: true,
    region: "ap-southeast-2",
    secretAccessKey: "secret",
    tableName: "prontiq-billing-actions-dev",
  });
  actionStore.inspect.mockResolvedValue({ kind: "none" });
  actionStore.claim.mockResolvedValue({ action: actionRecord(), kind: "claimed" });
  actionStore.finalizeFailure.mockResolvedValue(undefined);
  actionStore.finalizeSuccess.mockResolvedValue(undefined);
  actionStore.markProviderMutationStarted.mockResolvedValue({
    ...actionRecord(),
    status: "provider_in_flight",
  });
  serviceMocks.changeBillingPlan.mockResolvedValue({
    currentPlanCode: "starter",
    downgradePlanDate: null,
    nextPlanCode: null,
    reconciliationState: "pending_lago_webhook",
    status: "accepted",
    targetPlanCode: "starter",
  });
});

describe("POST /api/billing/plan-change", () => {
  test("requires an Idempotency-Key header", async () => {
    const res = await POST(request());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "MISSING_IDEMPOTENCY_KEY" },
    });
    expect(actionStore.claim).not.toHaveBeenCalled();
  });

  test("rejects invalid Idempotency-Key headers before touching the ledger", async () => {
    const res = await POST(request({ idempotencyKey: "not valid" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "INVALID_IDEMPOTENCY_KEY" },
    });
    expect(actionStore.inspect).not.toHaveBeenCalled();
    expect(actionStore.claim).not.toHaveBeenCalled();
  });

  test("returns feature-disabled before touching the billing action store", async () => {
    envMocks.getBillingActionsServerEnv.mockReturnValueOnce({
      accessKeyId: "",
      allowedOrgIds: null,
      enabled: false,
      region: "ap-southeast-2",
      secretAccessKey: "",
      tableName: "",
    });

    const res = await POST(request({ idempotencyKey: "idem_123" }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "FEATURE_DISABLED" },
    });
    expect(actionMocks.createBillingActionStore).not.toHaveBeenCalled();
  });

  test("returns controlled JSON when the billing ledger cannot be inspected", async () => {
    actionStore.inspect.mockRejectedValueOnce(new Error("ddb unavailable"));

    const res = await POST(request({ idempotencyKey: "idem_123" }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "BILLING_ACTION_LEDGER_UNAVAILABLE" },
    });
    expect(actionStore.claim).not.toHaveBeenCalled();
    expect(serviceMocks.changeBillingPlan).not.toHaveBeenCalled();
  });

  test("returns controlled JSON when the billing ledger store cannot be constructed", async () => {
    actionMocks.createBillingActionStore.mockImplementationOnce(() => {
      throw new Error("invalid aws config");
    });

    const res = await POST(request({ idempotencyKey: "idem_123" }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "BILLING_ACTION_LEDGER_UNAVAILABLE" },
    });
    expect(actionStore.inspect).not.toHaveBeenCalled();
    expect(actionStore.claim).not.toHaveBeenCalled();
    expect(serviceMocks.changeBillingPlan).not.toHaveBeenCalled();
  });

  test("returns controlled JSON when the billing ledger cannot claim", async () => {
    actionStore.claim.mockRejectedValueOnce(new Error("ddb unavailable"));

    const res = await POST(request({ idempotencyKey: "idem_123" }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "BILLING_ACTION_LEDGER_UNAVAILABLE" },
    });
    expect(serviceMocks.changeBillingPlan).not.toHaveBeenCalled();
  });

  test("changes the Lago plan once after claiming a billing action", async () => {
    const res = await POST(request({ idempotencyKey: "idem_123" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "accepted",
      targetPlanCode: "starter",
    });
    expect(actionStore.claim).toHaveBeenCalledWith({
      actorUserId: "user_123",
      externalSubscriptionId: "lago_sub_org_123",
      idempotencyKey: "idem_123",
      orgId: "org_123",
      targetPlanCode: "starter",
    });
    expect(serviceMocks.changeBillingPlan).toHaveBeenCalledWith({
      orgId: "org_123",
      targetPlanCode: "starter",
    });
    expect(actionStore.markProviderMutationStarted).toHaveBeenCalledWith({
      action: expect.objectContaining({ actionId: "action_123", status: "processing" }),
    });
    expect(actionStore.finalizeSuccess).toHaveBeenCalledOnce();
  });

  test("replays stored provider-accepted responses without calling Lago", async () => {
    actionStore.inspect.mockResolvedValueOnce({
      action: {
        ...actionRecord(),
        responseBody: {
          currentPlanCode: "starter",
          downgradePlanDate: null,
          nextPlanCode: null,
          reconciliationState: "pending_lago_webhook",
          status: "accepted",
          targetPlanCode: "starter",
        },
        status: "provider_accepted",
      },
      kind: "replay",
    });

    const res = await POST(request({ idempotencyKey: "idem_123" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "accepted" });
    expect(actionStore.claim).not.toHaveBeenCalled();
    expect(serviceMocks.changeBillingPlan).not.toHaveBeenCalled();
  });

  test("replays stored permanent failures with their original status", async () => {
    actionStore.inspect.mockResolvedValueOnce({
      action: {
        ...actionRecord(),
        errorCode: "TARGET_PLAN_NOT_AVAILABLE",
        errorMessage: "Selected plan is not available.",
        errorStatus: 400,
        status: "failed_permanent",
      },
      kind: "replay",
    });

    const res = await POST(request({ idempotencyKey: "idem_123" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "TARGET_PLAN_NOT_AVAILABLE" },
    });
    expect(actionStore.claim).not.toHaveBeenCalled();
    expect(serviceMocks.changeBillingPlan).not.toHaveBeenCalled();
  });

  test("replays stored unknown outcomes without calling Lago again", async () => {
    actionStore.inspect.mockResolvedValueOnce({
      action: {
        ...actionRecord(),
        errorCode: "LAGO_PLAN_CHANGE_FAILED",
        errorMessage: "Lago plan change outcome is unknown. Inspect Lago before retrying.",
        errorStatus: 502,
        status: "outcome_unknown",
      },
      kind: "replay",
    });

    const res = await POST(request({ idempotencyKey: "idem_123" }));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "LAGO_PLAN_CHANGE_FAILED" },
    });
    expect(actionStore.claim).not.toHaveBeenCalled();
    expect(serviceMocks.changeBillingPlan).not.toHaveBeenCalled();
  });

  test("replays unfinalized provider-in-flight rows without calling Lago again", async () => {
    actionStore.inspect.mockResolvedValueOnce({
      action: {
        ...actionRecord(),
        leaseExpiresAt: Date.now() - 60_000,
        status: "provider_in_flight",
      },
      kind: "replay",
    });

    const res = await POST(request({ idempotencyKey: "idem_123" }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "LAGO_PLAN_CHANGE_OUTCOME_UNKNOWN" },
    });
    expect(actionStore.claim).not.toHaveBeenCalled();
    expect(serviceMocks.changeBillingPlan).not.toHaveBeenCalled();
  });

  test("does not call Lago when provider boundary fencing cannot be written", async () => {
    actionStore.markProviderMutationStarted.mockRejectedValueOnce(new Error("ddb unavailable"));

    const res = await POST(request({ idempotencyKey: "idem_123" }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "BILLING_ACTION_LEDGER_UNAVAILABLE" },
    });
    expect(serviceMocks.changeBillingPlan).not.toHaveBeenCalled();
    expect(actionStore.finalizeSuccess).not.toHaveBeenCalled();
    expect(actionStore.finalizeFailure).not.toHaveBeenCalled();
  });

  test("does not mark provider-accepted mutations as failed when ledger finalization fails", async () => {
    actionStore.finalizeSuccess.mockRejectedValueOnce(new Error("ddb unavailable"));

    const res = await POST(request({ idempotencyKey: "idem_123" }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "BILLING_ACTION_FINALIZE_FAILED" },
    });
    expect(serviceMocks.changeBillingPlan).toHaveBeenCalledOnce();
    expect(actionStore.finalizeFailure).not.toHaveBeenCalled();
  });

  test("stores mapped Lago failure status for exact idempotent replay", async () => {
    serviceMocks.changeBillingPlan.mockRejectedValueOnce(new Error("TARGET_PLAN_NOT_AVAILABLE"));

    const res = await POST(request({ idempotencyKey: "idem_123" }));

    expect(res.status).toBe(400);
    expect(actionStore.finalizeFailure).toHaveBeenCalledWith({
      action: expect.objectContaining({ actionId: "action_123", status: "provider_in_flight" }),
      errorCode: "TARGET_PLAN_NOT_AVAILABLE",
      errorMessage: "Selected plan is not available.",
      errorStatus: 400,
      status: "failed_permanent",
    });
  });

  test("stores ambiguous provider failures as terminal outcome_unknown", async () => {
    serviceMocks.changeBillingPlan.mockRejectedValueOnce(new Error("network dropped"));

    const res = await POST(request({ idempotencyKey: "idem_123" }));

    expect(res.status).toBe(502);
    expect(actionStore.finalizeFailure).toHaveBeenCalledWith({
      action: expect.objectContaining({ actionId: "action_123", status: "provider_in_flight" }),
      errorCode: "LAGO_PLAN_CHANGE_FAILED",
      errorMessage: "network dropped",
      errorStatus: 502,
      status: "outcome_unknown",
    });
  });

  test("returns controlled JSON when provider failure cannot be finalized", async () => {
    serviceMocks.changeBillingPlan.mockRejectedValueOnce(new Error("TARGET_PLAN_NOT_AVAILABLE"));
    actionStore.finalizeFailure.mockRejectedValueOnce(new Error("ddb unavailable"));

    const res = await POST(request({ idempotencyKey: "idem_123" }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "BILLING_ACTION_FINALIZE_FAILED" },
    });
  });
});
