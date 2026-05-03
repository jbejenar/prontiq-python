import { beforeEach, describe, expect, test, vi } from "vitest";

type TestPlaygroundDemoStatus =
  | { execution: "enabled" }
  | {
      execution: "reference_only";
      reasonCode: "DEMO_KEY_NOT_CONFIGURED" | "DEMO_BACKEND_POLICY_NOT_CONFIRMED";
      message: string;
    };

const authMocks = vi.hoisted(() => ({
  getBillingPrincipal: vi.fn(),
}));

const statusMocks = vi.hoisted(() => ({
  status: { execution: "enabled" } as TestPlaygroundDemoStatus,
}));

vi.mock("../../../../../lib/billing-auth.js", () => authMocks);
vi.mock("../../../../../lib/server-env.js", () => ({
  getPlaygroundDemoStatus: () => statusMocks.status,
}));

import { GET } from "./route.js";

describe("GET /api/playground/demo/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getBillingPrincipal.mockResolvedValue({
      canManageBilling: true,
      orgId: "org_123",
      orgRole: "org:admin",
      userId: "user_123",
    });
    statusMocks.status = { execution: "enabled" };
  });

  test("requires a Clerk principal", async () => {
    authMocks.getBillingPrincipal.mockResolvedValueOnce(
      Response.json(
        { error: { code: "NO_CLERK_SESSION", message: "Sign in is required.", status: 401 } },
        { status: 401 },
      ),
    );

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NO_CLERK_SESSION" },
    });
  });

  test("returns enabled status without exposing secrets", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ execution: "enabled" });
  });

  test("returns reference-only status when demo key is not configured", async () => {
    statusMocks.status = {
      execution: "reference_only",
      reasonCode: "DEMO_KEY_NOT_CONFIGURED",
      message: "Demo execution is unavailable on this deployment because the demo key is not configured.",
    };

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      execution: "reference_only",
      reasonCode: "DEMO_KEY_NOT_CONFIGURED",
    });
  });

  test("returns reference-only status when backend policy is not confirmed", async () => {
    statusMocks.status = {
      execution: "reference_only",
      reasonCode: "DEMO_BACKEND_POLICY_NOT_CONFIRMED",
      message:
        "Demo execution is unavailable until backend quota and rate controls are confirmed for the demo key.",
    };

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      execution: "reference_only",
      reasonCode: "DEMO_BACKEND_POLICY_NOT_CONFIRMED",
    });
  });
});
