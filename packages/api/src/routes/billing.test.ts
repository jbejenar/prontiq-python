import test from "node:test";
import assert from "node:assert/strict";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { BillingActionRecord, BillingPlanChangeService } from "@prontiq/control-plane";
import { clerkJwt, type ClerkVerifier } from "../middleware/clerk-jwt.js";
import { requestId } from "../middleware/request-id.js";
import { createBillingRoutes } from "./billing.js";

function buildApp(input: {
  orgRole?: string;
  planChangesEnabled?: boolean;
  service: BillingPlanChangeService;
}) {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_test",
    org_id: "org_test",
    org_role: input.orgRole ?? "org:admin",
    fva: [0, -1],
  });
  const app = new OpenAPIHono();
  app.use("*", requestId());
  app.use("/v1/account/*", clerkJwt({ verifier }));
  app.route(
    "/v1/account",
    createBillingRoutes({
      allowedOrgIds: null,
      planChangesEnabled: input.planChangesEnabled ?? true,
      service: input.service,
    }),
  );
  return app;
}

function makeService(
  changePlan: BillingPlanChangeService["changePlan"],
): BillingPlanChangeService {
  return { changePlan };
}

test("POST /v1/account/billing/plan-change requires Idempotency-Key before Lago mutation", async () => {
  let called = false;
  const app = buildApp({
    service: makeService(async () => {
      called = true;
      return {
        kind: "success",
        responseBody: {
          currentPlanCode: "payg_aud",
          downgradePlanDate: null,
          nextPlanCode: null,
          reconciliationState: "pending_lago_webhook",
          status: "accepted",
          targetPlanCode: "payg_aud",
        },
      };
    }),
  });

  const response = await app.request("/v1/account/billing/plan-change", {
    body: JSON.stringify({ targetPlanCode: "payg_aud" }),
    headers: {
      Authorization: "Bearer good_token",
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const body = (await response.json()) as { error: { code: string } };

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "MISSING_IDEMPOTENCY_KEY");
  assert.equal(called, false);
});

test("POST /v1/account/billing/plan-change accepts admin first-factor step-up and calls service", async () => {
  const calls: Array<{
    actorUserId: string;
    idempotencyKey: string;
    orgId: string;
    targetPlanCode: string;
  }> = [];
  const app = buildApp({
    service: makeService(async (input) => {
      calls.push(input);
      return {
        kind: "success",
        responseBody: {
          currentPlanCode: "starter",
          downgradePlanDate: null,
          nextPlanCode: null,
          reconciliationState: "pending_lago_webhook",
          status: "accepted",
          targetPlanCode: input.targetPlanCode,
        },
      };
    }),
  });

  const response = await app.request("/v1/account/billing/plan-change", {
    body: JSON.stringify({ targetPlanCode: "starter" }),
    headers: {
      Authorization: "Bearer good_token",
      "Content-Type": "application/json",
      "Idempotency-Key": "plan-change-test-1",
    },
    method: "POST",
  });
  const body = (await response.json()) as { targetPlanCode: string };

  assert.equal(response.status, 200);
  assert.equal(body.targetPlanCode, "starter");
  assert.deepEqual(calls, [{
    actorUserId: "user_test",
    idempotencyKey: "plan-change-test-1",
    orgId: "org_test",
    targetPlanCode: "starter",
  }]);
});

test("POST /v1/account/billing/plan-change remains admin-only", async () => {
  const app = buildApp({
    orgRole: "org:member",
    service: makeService(async () => ({
      kind: "success",
      responseBody: {
        currentPlanCode: "starter",
        downgradePlanDate: null,
        nextPlanCode: null,
        reconciliationState: "pending_lago_webhook",
        status: "accepted",
        targetPlanCode: "starter",
      },
    })),
  });

  const response = await app.request("/v1/account/billing/plan-change", {
    body: JSON.stringify({ targetPlanCode: "starter" }),
    headers: {
      Authorization: "Bearer good_token",
      "Content-Type": "application/json",
      "Idempotency-Key": "plan-change-test-2",
    },
    method: "POST",
  });
  const body = (await response.json()) as { error: { code: string } };

  assert.equal(response.status, 403);
  assert.equal(body.error.code, "INSUFFICIENT_ROLE");
});

test("POST /v1/account/billing/plan-change returns Clerk-native first-factor step-up body", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_test",
    org_id: "org_test",
    org_role: "org:admin",
    fva: [11, -1],
  });
  const app = new OpenAPIHono();
  app.use("*", requestId());
  app.use("/v1/account/*", clerkJwt({ verifier }));
  app.route(
    "/v1/account",
    createBillingRoutes({
      planChangesEnabled: true,
      service: makeService(async () => ({
        kind: "success",
        responseBody: {
          currentPlanCode: "starter",
          downgradePlanDate: null,
          nextPlanCode: null,
          reconciliationState: "pending_lago_webhook",
          status: "accepted",
          targetPlanCode: "starter",
        },
      })),
    }),
  );

  const response = await app.request("/v1/account/billing/plan-change", {
    body: JSON.stringify({ targetPlanCode: "starter" }),
    headers: {
      Authorization: "Bearer good_token",
      "Content-Type": "application/json",
      "Idempotency-Key": "plan-change-test-3",
    },
    method: "POST",
  });
  const body = (await response.json()) as {
    clerk_error?: { metadata: { reverification: { level: string } } };
    error?: unknown;
  };

  assert.equal(response.status, 403);
  assert.equal(body.error, undefined);
  assert.equal(body.clerk_error?.metadata.reverification.level, "first_factor");
});

test("POST /v1/account/billing/plan-change replays outcome_unknown as manual reconcile", async () => {
  const action = {
    actionId: "action_123",
    actorUserId: "user_test",
    attemptToken: "attempt_1",
    createdAt: "2026-04-30T00:00:00.000Z",
    errorCode: "LAGO_PLAN_CHANGE_FAILED",
    errorMessage: "Lago request failed with HTTP 500",
    errorStatus: 502,
    externalSubscriptionId: "lago_sub_org_test",
    idempotencyKeyHash: "hash",
    leaseExpiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    orgId: "org_test",
    requestHash: "request_hash",
    route: "billing.plan-change",
    status: "outcome_unknown",
    targetPlanCode: "starter",
    ttl: 1_798_675_200,
    updatedAt: "2026-04-30T00:01:00.000Z",
  } satisfies BillingActionRecord;
  const app = buildApp({
    service: makeService(async () => ({ action, kind: "replay" })),
  });

  const response = await app.request("/v1/account/billing/plan-change", {
    body: JSON.stringify({ targetPlanCode: "starter" }),
    headers: {
      Authorization: "Bearer good_token",
      "Content-Type": "application/json",
      "Idempotency-Key": "plan-change-test-4",
    },
    method: "POST",
  });
  const body = (await response.json()) as { error: { code: string; status: number } };

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "LAGO_PLAN_CHANGE_OUTCOME_UNKNOWN");
  assert.equal(body.error.status, 409);
});
