import { describe, expect, test, vi } from "vitest";

import { LagoBillingError } from "../../../../../lib/billing-lago.js";

const authMocks = vi.hoisted(() => ({
  getBillingPrincipal: vi.fn(),
  requireBillingAdmin: vi.fn(),
  requireSameOrigin: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  createInvoicePaymentUrl: vi.fn(),
}));

vi.mock("../../../../../lib/billing-auth.js", () => authMocks);
vi.mock("../../../../../lib/billing-service.js", () => serviceMocks);

import { POST } from "./route.js";

function makeRequest() {
  return new Request("https://console.prontiq.dev/api/billing/invoices/payment-url", {
    body: JSON.stringify({ invoiceId: "inv_123" }),
    headers: {
      "content-type": "application/json",
      host: "console.prontiq.dev",
      origin: "https://console.prontiq.dev",
    },
    method: "POST",
  });
}

describe("POST /api/billing/invoices/payment-url", () => {
  test("maps Lago missing payment-provider customer to an actionable 409", async () => {
    authMocks.requireSameOrigin.mockReturnValue(null);
    authMocks.getBillingPrincipal.mockResolvedValue({
      canManageBilling: true,
      orgId: "org_123",
      orgRole: "org:admin",
      userId: "user_123",
    });
    authMocks.requireBillingAdmin.mockReturnValue(null);
    serviceMocks.createInvoicePaymentUrl.mockRejectedValue(
      new LagoBillingError({
        code: "validation_errors",
        details: { base: ["missing_payment_provider_customer"] },
        message: "Lago request failed with HTTP 422 (validation_errors)",
        status: 422,
      }),
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PAYMENT_PROVIDER_NOT_LINKED",
        message: "Billing is not ready for invoice payment links yet. Set up a payment method first.",
        status: 409,
      },
    });
  });
});
