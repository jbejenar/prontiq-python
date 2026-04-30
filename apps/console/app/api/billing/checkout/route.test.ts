import { describe, expect, test, vi } from "vitest";

import { LagoBillingError } from "../../../../lib/billing-lago.js";

const authMocks = vi.hoisted(() => ({
  getBillingPrincipal: vi.fn(),
  requireBillingAdmin: vi.fn(),
  requireSameOrigin: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  createCheckoutUrl: vi.fn(),
}));

vi.mock("../../../../lib/billing-auth.js", () => authMocks);
vi.mock("../../../../lib/billing-service.js", () => serviceMocks);

import { POST } from "./route.js";

describe("POST /api/billing/checkout", () => {
  test("maps Lago missing payment-provider linkage to an actionable 409", async () => {
    authMocks.requireSameOrigin.mockReturnValue(null);
    authMocks.getBillingPrincipal.mockResolvedValue({
      canManageBilling: true,
      orgId: "org_123",
      orgRole: "org:admin",
      userId: "user_123",
    });
    authMocks.requireBillingAdmin.mockReturnValue(null);
    serviceMocks.createCheckoutUrl.mockRejectedValue(
      new LagoBillingError({
        code: "validation_errors",
        details: { base: ["no_linked_payment_provider"] },
        message: "Lago request failed with HTTP 422 (validation_errors)",
        status: 422,
      }),
    );

    const response = await POST(
      new Request("https://console.prontiq.dev/api/billing/checkout", {
        body: JSON.stringify({ intendedPlanCode: "payg_aud" }),
        headers: {
          "content-type": "application/json",
          host: "console.prontiq.dev",
          origin: "https://console.prontiq.dev",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PAYMENT_PROVIDER_NOT_LINKED",
        status: 409,
      },
    });
  });
});
