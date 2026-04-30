import { expect, test, vi } from "vitest";

import {
  buildBillingSummary,
  createInvoicePaymentUrl,
  externalSubscriptionIdForOrg,
} from "./billing-service.js";

test("billing service derives Lago subscription id from the active Clerk org", () => {
  expect(externalSubscriptionIdForOrg("org_123")).toBe("lago_sub_org_123");
});

test("billing summary reads Lago state without hard-coded plan data", async () => {
  const client = {
    getSubscription: vi.fn().mockResolvedValue({ planCode: "payg_aud" }),
    getCurrentUsage: vi.fn().mockResolvedValue({ amountCents: 100 }),
    listVisiblePlans: vi.fn().mockResolvedValue([{ code: "payg_aud" }]),
    listInvoices: vi.fn().mockResolvedValue([{ id: "inv_123" }]),
  };

  await expect(
    buildBillingSummary({
      orgId: "org_123",
      canManageBilling: true,
      client: client as never,
    }),
  ).resolves.toMatchObject({
    orgId: "org_123",
    canManageBilling: true,
    subscription: { planCode: "payg_aud" },
    usage: { amountCents: 100 },
    plans: [{ code: "payg_aud" }],
    invoices: [{ id: "inv_123" }],
  });
  expect(client.getSubscription).toHaveBeenCalledWith("lago_sub_org_123");
  expect(client.getCurrentUsage).toHaveBeenCalledWith({
    externalCustomerId: "org_123",
    externalSubscriptionId: "lago_sub_org_123",
  });
});

test("invoice payment URL verifies the invoice belongs to the active org", async () => {
  const client = {
    listInvoices: vi.fn().mockResolvedValue([{ id: "inv_allowed" }]),
    createInvoicePaymentUrl: vi.fn().mockResolvedValue({
      externalCustomerId: "org_123",
      paymentUrl: "https://pay.example",
    }),
  };

  await expect(
    createInvoicePaymentUrl({
      orgId: "org_123",
      invoiceId: "inv_other",
      client: client as never,
    }),
  ).resolves.toBeNull();
  await expect(
    createInvoicePaymentUrl({
      orgId: "org_123",
      invoiceId: "inv_allowed",
      client: client as never,
    }),
  ).resolves.toBe("https://pay.example");
  expect(client.createInvoicePaymentUrl).toHaveBeenCalledOnce();
});

test("invoice payment URL rejects Lago links for another customer", async () => {
  const client = {
    listInvoices: vi.fn().mockResolvedValue([{ id: "inv_allowed" }]),
    createInvoicePaymentUrl: vi.fn().mockResolvedValue({
      externalCustomerId: "org_other",
      paymentUrl: "https://pay.example",
    }),
  };

  await expect(
    createInvoicePaymentUrl({
      orgId: "org_123",
      invoiceId: "inv_allowed",
      client: client as never,
    }),
  ).rejects.toThrow("Lago invoice payment URL did not belong to the active organization.");
});
