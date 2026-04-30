import { expect, test, vi } from "vitest";

import { LagoBillingClient } from "./billing-lago.js";

function makeClient(fetchMock: typeof fetch, catalogEnv: "dev" | "prod" | "all" = "dev") {
  return new LagoBillingClient({
    apiKey: "test-key",
    baseUrl: "https://billing-dev.prontiq.dev",
    catalogEnv,
    fetchImpl: fetchMock,
  });
}

test("Lago billing client filters plans by Prontiq visibility metadata", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        plans: [
          {
            code: "free",
            name: "Free",
            metadata: { prontiq_console_visible: "true", prontiq_environment: "dev" },
          },
          {
            code: "prod_pack",
            name: "Prod Pack",
            metadata: { prontiq_console_visible: true, prontiq_environment: "prod" },
          },
          {
            code: "test_pack",
            name: "Test Pack",
            metadata: { prontiq_console_visible: true, prontiq_test: true },
          },
          {
            code: "hidden",
            name: "Hidden",
            metadata: {},
          },
        ],
      }),
      { status: 200 },
    ),
  ) as unknown as typeof fetch;

  await expect(makeClient(fetchMock).listVisiblePlans()).resolves.toEqual([
    expect.objectContaining({ code: "free", name: "Free" }),
  ]);
});

test("Lago billing client maps Lago plan pricing fields without hard-coded assumptions", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        plans: [
          {
            code: "usd_pack",
            name: "USD Pack",
            amount_currency: "USD",
            amount_cents: 2500,
            metadata: { prontiq_console_visible: true, prontiq_environment: "dev" },
            charges: [
              {
                invoice_display_name: "Displayed address requests",
                charge_model: "package",
                properties: {
                  amount: "1.25",
                  free_units: 5000,
                  package_size: 5000,
                },
                billable_metric: { code: "prontiq_address_requests", name: "Metric fallback" },
              },
              {
                charge_model: "standard",
                properties: { amount: "0.0015" },
                billable_metric: { code: "prontiq_address_requests" },
              },
              {
                charge_model: "graduated",
                properties: { graduated_ranges: [{ from_value: 0, to_value: 1000 }] },
                billable_metric: { code: "prontiq_address_requests" },
              },
              {
                charge_model: "volume",
                properties: { volume_ranges: [{ from_value: 0, to_value: null }] },
                billable_metric: { code: "prontiq_address_requests" },
              },
            ],
          },
        ],
      }),
      { status: 200 },
    ),
  ) as unknown as typeof fetch;

  await expect(makeClient(fetchMock).listVisiblePlans()).resolves.toEqual([
    expect.objectContaining({
      amountCents: 2500,
      code: "usd_pack",
      currency: "USD",
      charges: [
        expect.objectContaining({
          amountCents: 125,
          amountDecimal: "1.25",
          name: "Displayed address requests",
          packageSize: 5000,
        }),
        expect.objectContaining({
          amountCents: 0,
          amountDecimal: "0.0015",
          chargeModel: "standard",
        }),
        expect.objectContaining({
          pricingDescription: "1 graduated pricing tiers configured in Lago",
        }),
        expect.objectContaining({
          pricingDescription: "1 volume pricing tiers configured in Lago",
        }),
      ],
    }),
  ]);
});

test("Lago billing client maps subscription, usage, invoices, and payment URLs", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          subscription: {
            external_id: "lago_sub_org_123",
            external_customer_id: "org_123",
            status: "active",
            plan: { code: "free", name: "Free" },
            current_billing_period_started_at: "2026-04-01T00:00:00Z",
            current_billing_period_ending_at: "2026-05-01T00:00:00Z",
          },
        }),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          customer_usage: {
            amount_cents: 1234,
            currency: "AUD",
            from_datetime: "2026-04-01T00:00:00Z",
            to_datetime: "2026-05-01T00:00:00Z",
            charges_usage: [{ billable_metric: { code: "prontiq_address_requests" }, units: 42 }],
          },
        }),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          invoices: [
            {
              lago_id: "inv_123",
              number: "INV-1",
              payment_status: "pending",
              total_amount_cents: 1234,
              currency: "AUD",
            },
          ],
        }),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ checkout_url: "https://checkout.example" }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          invoice_payment_details: {
            external_customer_id: "org_123",
            payment_url: "https://pay.example",
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
  const client = makeClient(fetchMock);

  await expect(client.getSubscription("lago_sub_org_123")).resolves.toMatchObject({
    externalCustomerId: "org_123",
    planCode: "free",
  });
  await expect(
    client.getCurrentUsage({
      externalCustomerId: "org_123",
      externalSubscriptionId: "lago_sub_org_123",
    }),
  ).resolves.toMatchObject({ amountCents: 1234, chargesUsage: [{ units: 42 }] });
  await expect(client.listInvoices("org_123")).resolves.toMatchObject([
    { id: "inv_123", paymentStatus: "pending" },
  ]);
  await expect(client.createCheckoutUrl("org_123")).resolves.toBe("https://checkout.example");
  await expect(client.createInvoicePaymentUrl("inv_123")).resolves.toEqual({
    externalCustomerId: "org_123",
    paymentUrl: "https://pay.example",
  });
});

test("Lago billing client rejects non-HTTPS redirect URLs", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ checkout_url: "http://checkout.example" }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          invoice_payment_details: { payment_url: "http://pay.example" },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
  const client = makeClient(fetchMock);

  await expect(client.createCheckoutUrl("org_123")).rejects.toThrow(
    "Lago checkout_url response must be an https URL",
  );
  await expect(client.createInvoicePaymentUrl("inv_123")).rejects.toThrow(
    "Lago payment_url response must be an https URL",
  );
});

test("Lago billing client preserves HTTP status when Lago returns a non-JSON error", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("upstream unavailable", { status: 503 })) as
    unknown as typeof fetch;

  await expect(makeClient(fetchMock).listVisiblePlans()).rejects.toThrow(
    "Lago request failed with HTTP 503",
  );
});
