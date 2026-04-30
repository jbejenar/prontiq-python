import test from "node:test";
import assert from "node:assert/strict";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AccountUsageResponse, AccountUsageService } from "@prontiq/control-plane";
import { requestId } from "../middleware/request-id.js";
import { createUsageRoutes } from "./usage.js";

const usageResponse: AccountUsageResponse = {
  generatedAt: "2026-04-30T00:00:00.000Z",
  granularity: "daily",
  period: {
    key: "2026-04-25_2026-05-25",
    startedAt: "2026-04-25T00:00:00.000Z",
    endingAt: "2026-05-25T00:00:00.000Z",
    source: "lago",
    entitlementsSyncedAt: "2026-04-30T00:00:00.000Z",
    scopeConsistency: "single_period",
  },
  products: [
    {
      product: "address",
      displayName: "Address",
      includedInCurrentPlan: true,
      usedCredits: 10,
      quotaCredits: 5_000,
      remainingCredits: 4_990,
      overageCredits: 0,
      enforcementMode: "hard_cap",
      rateLimitPerSecond: 10,
      series: [{ bucket: "2026-04-30", label: "30 Apr", credits: 10 }],
    },
  ],
};

function buildApp(service: AccountUsageService) {
  const app = new OpenAPIHono();
  app.use("*", requestId());
  app.use("*", async (c, next) => {
    c.set("clerkPrincipal", {
      userId: "user_test",
      orgId: "org_test",
      orgRole: "org:member",
    });
    await next();
  });
  app.route("/v1/account", createUsageRoutes({ service }));
  return app;
}

test("GET /v1/account/usage returns member-readable usage for the active Clerk org", async () => {
  const calls: Array<{ granularity: string; orgId: string }> = [];
  const app = buildApp({
    async getUsage(input) {
      calls.push({ granularity: input.granularity, orgId: input.orgId });
      return { status: "ok", usage: usageResponse };
    },
  });

  const response = await app.request("/v1/account/usage?granularity=daily");
  const body = (await response.json()) as AccountUsageResponse;

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ granularity: "daily", orgId: "org_test" }]);
  assert.equal(body.products[0]?.usedCredits, 10);
});

test("GET /v1/account/usage maps missing org envelope to ORG_NOT_PROVISIONED", async () => {
  const app = buildApp({
    async getUsage() {
      return { status: "org_not_provisioned" };
    },
  });

  const response = await app.request("/v1/account/usage");
  const body = (await response.json()) as {
    error: { code: string; request_id: string; status: number };
  };

  assert.equal(response.status, 404);
  assert.equal(body.error.code, "ORG_NOT_PROVISIONED");
  assert.equal(body.error.status, 404);
  assert.ok(body.error.request_id.startsWith("req_"));
});

test("GET /v1/account/usage fails closed on service errors", async () => {
  const app = buildApp({
    async getUsage() {
      throw new Error("usage table unavailable");
    },
  });

  const response = await app.request("/v1/account/usage?granularity=weekly");
  const body = (await response.json()) as {
    error: { code: string; request_id: string; status: number };
  };

  assert.equal(response.status, 500);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.status, 500);
  assert.ok(body.error.request_id.startsWith("req_"));
});
