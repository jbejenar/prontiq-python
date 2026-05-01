import { afterEach, beforeEach, expect, test, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  NEXT_PUBLIC_API_URL: "https://api.test.prontiq.dev",
  NEXT_PUBLIC_CLERK_JWT_TEMPLATE: undefined as string | undefined,
}));

vi.mock("./env.js", () => ({
  env: envMock,
}));

import { accountApi, AccountApiError } from "./account-api.js";

beforeEach(() => {
  envMock.NEXT_PUBLIC_CLERK_JWT_TEMPLATE = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("account API uses the default Clerk session token when no template is configured", async () => {
  const getToken = vi.fn().mockResolvedValue("default-session-jwt");
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        orgId: "org_123",
        orgRole: "org:admin",
        canManageKeys: true,
        provisioned: false,
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  await accountApi.getStatus(getToken);

  expect(getToken).toHaveBeenCalledWith(undefined);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.test.prontiq.dev/v1/account/status",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer default-session-jwt",
      }),
    }),
  );
});

test("account API passes the configured Clerk JWT template to getToken", async () => {
  envMock.NEXT_PUBLIC_CLERK_JWT_TEMPLATE = "account-api";
  const getToken = vi.fn().mockResolvedValue("templated-jwt");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          orgId: "org_123",
          orgRole: "org:admin",
          canManageKeys: true,
          provisioned: false,
        }),
        { status: 200 },
      ),
    ),
  );

  await accountApi.getStatus(getToken);

  expect(getToken).toHaveBeenCalledWith({ template: "account-api" });
});

test("account API fails before fetch when Clerk returns no token", async () => {
  const getToken = vi.fn().mockResolvedValue(null);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await expect(accountApi.getStatus(getToken)).rejects.toMatchObject({
    code: "NO_CLERK_SESSION",
    status: 401,
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("account API posts rotate and revoke requests to the private key endpoints", async () => {
  const getToken = vi.fn().mockResolvedValue("default-session-jwt");
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          keyId: "key_01HX0000000000000000000000",
          raw: `pq_live_${"a".repeat(48)}`,
          keyPrefix: "pq_live_aaaa",
          createdAt: "2026-04-29T00:00:00.000Z",
          rotatedAt: "2026-04-29T01:00:00.000Z",
        }),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          keyId: "key_01HX0000000000000000000000",
          revokedAt: "2026-04-29T02:00:00.000Z",
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);

  await accountApi.rotateKey(getToken, { keyId: "key_01HX0000000000000000000000" });
  await accountApi.revokeKey(getToken, { keyId: "key_01HX0000000000000000000000" });

  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "https://api.test.prontiq.dev/v1/account/keys/rotate",
    expect.objectContaining({
      body: JSON.stringify({ keyId: "key_01HX0000000000000000000000" }),
      method: "POST",
    }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "https://api.test.prontiq.dev/v1/account/keys/revoke",
    expect.objectContaining({
      body: JSON.stringify({ keyId: "key_01HX0000000000000000000000" }),
      method: "POST",
    }),
  );
});

test("account API reads recent audit events from the private account API", async () => {
  const getToken = vi.fn().mockResolvedValue("default-session-jwt");
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        events: [
          {
            action: "CREATE",
            actorId: "user_123",
            timestamp: "2026-04-29T00:00:00.000Z",
            ip: "203.0.113.10",
          },
        ],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(accountApi.listAudit(getToken)).resolves.toEqual({
    events: [
      {
        action: "CREATE",
        actorId: "user_123",
        timestamp: "2026-04-29T00:00:00.000Z",
        ip: "203.0.113.10",
      },
    ],
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.test.prontiq.dev/v1/account/audit",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer default-session-jwt",
      }),
    }),
  );
});

test("account API reads usage at the requested granularity", async () => {
  const getToken = vi.fn().mockResolvedValue("default-session-jwt");
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        generatedAt: "2026-04-30T00:00:00.000Z",
        granularity: "weekly",
        period: {
          key: "2026-04-25_2026-05-25",
          startedAt: "2026-04-25T00:00:00.000Z",
          endingAt: "2026-05-25T00:00:00.000Z",
          source: "lago",
          entitlementsSyncedAt: "2026-04-25T00:00:00.000Z",
          scopeConsistency: "single_period",
        },
        products: [],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(accountApi.getUsage(getToken, "weekly")).resolves.toMatchObject({
    granularity: "weekly",
    period: { source: "lago" },
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.test.prontiq.dev/v1/account/usage?granularity=weekly",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer default-session-jwt",
      }),
    }),
  );
});

test("account API posts billing plan changes with Idempotency-Key", async () => {
  const getToken = vi.fn().mockResolvedValue("default-session-jwt");
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        currentPlanCode: "starter",
        downgradePlanDate: null,
        nextPlanCode: null,
        reconciliationState: "pending_lago_webhook",
        status: "accepted",
        targetPlanCode: "starter",
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  await accountApi.changeBillingPlan(getToken, {
    idempotencyKey: "plan-change-1",
    targetPlanCode: "starter",
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.test.prontiq.dev/v1/account/billing/plan-change",
    expect.objectContaining({
      body: JSON.stringify({ targetPlanCode: "starter" }),
      headers: expect.objectContaining({
        Authorization: "Bearer default-session-jwt",
        "Idempotency-Key": "plan-change-1",
      }),
      method: "POST",
    }),
  );
});

test("account API returns Clerk reverification bodies so useReverification can inspect them", async () => {
  const getToken = vi.fn().mockResolvedValue("default-session-jwt");
  const clerkError = {
    clerk_error: {
      type: "forbidden",
      reason: "reverification-error",
      metadata: { reverification: { level: "second_factor", afterMinutes: 10 } },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(clerkError), { status: 403 })),
  );

  await expect(
    accountApi.rotateKey(getToken, { keyId: "key_01HX0000000000000000000000" }),
  ).resolves.toEqual(clerkError);
});

test("account API rejects non-reverification Clerk error bodies", async () => {
  const getToken = vi.fn().mockResolvedValue("default-session-jwt");
  const clerkError = {
    clerk_error: {
      type: "forbidden",
      reason: "organization-mismatch",
      metadata: { organizationId: "org_other" },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(clerkError), { status: 403 })),
  );

  await expect(
    accountApi.rotateKey(getToken, { keyId: "key_01HX0000000000000000000000" }),
  ).rejects.toMatchObject({
    code: "ACCOUNT_API_ERROR",
    message: "Account API request failed",
    status: 403,
  });
});

test("account API rejects malformed Clerk reverification hints", async () => {
  const getToken = vi.fn().mockResolvedValue("default-session-jwt");
  const malformedHint = {
    clerk_error: {
      type: "forbidden",
      reason: "reverification-error",
      metadata: { level: "second_factor", afterMinutes: 10 },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(malformedHint), { status: 403 })),
  );

  await expect(
    accountApi.rotateKey(getToken, { keyId: "key_01HX0000000000000000000000" }),
  ).rejects.toBeInstanceOf(AccountApiError);
});

test("account API still wraps non-Clerk key-management errors", async () => {
  const getToken = vi.fn().mockResolvedValue("default-session-jwt");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "STEP_UP_MISCONFIGURED",
            message: "Step-up enforcement is not configured. Contact support.",
            status: 500,
          },
        }),
        { status: 500 },
      ),
    ),
  );

  await expect(
    accountApi.rotateKey(getToken, { keyId: "key_01HX0000000000000000000000" }),
  ).rejects.toBeInstanceOf(AccountApiError);
});
