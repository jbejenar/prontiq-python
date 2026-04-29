import assert from "node:assert/strict";
import test from "node:test";
import { HttpLagoEntitlementsClient, projectLagoEntitlements } from "./lago-entitlements.js";

const snapshot = {
  externalCustomerId: "org_test",
  externalSubscriptionId: "lago_sub_org_test",
  planCode: "free",
  status: "active",
  billingPeriodStartedAt: "2026-04-01T00:00:00Z",
  billingPeriodEndingAt: "2026-05-01T00:00:00Z",
};

test("projects package/free plan from Lago charge and entitlements", () => {
  const result = projectLagoEntitlements({
    snapshot,
    charges: [
      {
        billableMetricCode: "prontiq_address_requests",
        chargeModel: "package",
        properties: { free_units: 5_000 },
      },
    ],
    entitlements: [
      { featureCode: "api_keys", privileges: { max: 2 } },
      {
        featureCode: "address_api",
        privileges: {
          enabled: true,
          monthly_quota: 5_000,
          rate_limit_per_second: 10,
          enforcement_mode: "hard_cap",
        },
      },
    ],
  });
  assert.equal(result.status, "projected");
  if (result.status === "projected") {
    assert.deepEqual(result.projection.products, ["address"]);
    assert.equal(result.projection.quotaPerProduct, 5_000);
    assert.equal(result.projection.enforcementMode, "hard_cap");
    assert.equal(result.projection.rateLimit, 10);
    assert.equal(result.projection.maxKeys, 2);
  }
});

test("projects PAYG standard charge as uncapped tracked", () => {
  const result = projectLagoEntitlements({
    snapshot: { ...snapshot, planCode: "payg_aud" },
    charges: [
      {
        billableMetricCode: "prontiq_address_requests",
        chargeModel: "standard",
        properties: { amount: "0.0015" },
      },
    ],
    entitlements: [
      { featureCode: "api_keys", privileges: { max: 3 } },
      {
        featureCode: "address_api",
        privileges: {
          enabled: true,
          rate_limit_per_second: 25,
          enforcement_mode: "uncapped_tracked",
        },
      },
    ],
  });
  assert.equal(result.status, "projected");
  if (result.status === "projected") {
    assert.equal(result.projection.quotaPerProduct, null);
    assert.equal(result.projection.enforcementMode, "uncapped_tracked");
    assert.equal(result.projection.rateLimit, 25);
    assert.equal(result.projection.maxKeys, 3);
  }
});

test("returns drift when enabled address API is missing the required rate limit", () => {
  const result = projectLagoEntitlements({
    snapshot,
    charges: [
      {
        billableMetricCode: "prontiq_address_requests",
        chargeModel: "package",
        properties: { free_units: 5_000 },
      },
    ],
    entitlements: [
      { featureCode: "api_keys", privileges: { max: 2 } },
      {
        featureCode: "address_api",
        privileges: {
          enabled: true,
          monthly_quota: 5_000,
          enforcement_mode: "hard_cap",
        },
      },
    ],
  });
  assert.equal(result.status, "drift");
  if (result.status === "drift") {
    assert.match(result.reason, /rate_limit_per_second/);
  }
});

test("returns drift when enabled address API has a null, negative, fractional, or zero rate limit", () => {
  for (const rateLimit of [null, -1, 0, 10.5] as const) {
    const result = projectLagoEntitlements({
      snapshot,
      charges: [
        {
          billableMetricCode: "prontiq_address_requests",
          chargeModel: "package",
          properties: { free_units: 5_000 },
        },
      ],
      entitlements: [
        { featureCode: "api_keys", privileges: { max: 2 } },
        {
          featureCode: "address_api",
          privileges: {
            enabled: true,
            monthly_quota: 5_000,
            rate_limit_per_second: rateLimit,
            enforcement_mode: "hard_cap",
          },
        },
      ],
    });
    assert.equal(result.status, "drift", `expected ${String(rateLimit)} to drift`);
  }
});

test("accepts string integer rate-limit metadata as a compatibility input", () => {
  const result = projectLagoEntitlements({
    snapshot: { ...snapshot, metadata: { prontiq_rate_limit_per_second: "15" } },
    charges: [
      {
        billableMetricCode: "prontiq_address_requests",
        chargeModel: "package",
        properties: { free_units: 5_000 },
      },
    ],
    entitlements: [
      { featureCode: "api_keys", privileges: { max: 2 } },
      {
        featureCode: "address_api",
        privileges: {
          enabled: true,
          monthly_quota: 5_000,
          enforcement_mode: "hard_cap",
        },
      },
    ],
  });
  assert.equal(result.status, "projected");
  if (result.status === "projected") {
    assert.equal(result.projection.rateLimit, 15);
  }
});

test("returns drift when the address metric charge is missing", () => {
  const result = projectLagoEntitlements({
    snapshot,
    charges: [],
    entitlements: [{ featureCode: "api_keys", privileges: { max: 2 } }],
  });
  assert.equal(result.status, "drift");
});

test("projection hash is stable for semantically equal Lago objects", () => {
  const first = projectLagoEntitlements({
    snapshot: {
      ...snapshot,
      metadata: { prontiq_max_keys: 2, prontiq_rate_limit_per_second: 10, address_api_enabled: true },
    },
    charges: [
      {
        billableMetricCode: "prontiq_address_requests",
        chargeModel: "package",
        properties: { free_units: 5_000, amount: "0.00" },
      },
    ],
    entitlements: [
      { featureCode: "api_keys", privileges: { max: 2 } },
      { featureCode: "address_api", privileges: { monthly_quota: 5_000, enabled: true } },
    ],
  });
  const second = projectLagoEntitlements({
    snapshot: {
      ...snapshot,
      metadata: { address_api_enabled: true, prontiq_rate_limit_per_second: 10, prontiq_max_keys: 2 },
    },
    charges: [
      {
        chargeModel: "package",
        billableMetricCode: "prontiq_address_requests",
        properties: { amount: "0.00", free_units: 5_000 },
      },
    ],
    entitlements: [
      { featureCode: "address_api", privileges: { enabled: true, monthly_quota: 5_000 } },
      { featureCode: "api_keys", privileges: { max: 2 } },
    ],
  });
  assert.equal(first.status, "projected");
  assert.equal(second.status, "projected");
  if (first.status === "projected" && second.status === "projected") {
    assert.equal(first.projection.lagoEntitlementsHash, second.projection.lagoEntitlementsHash);
  }
});

test("HTTP client parses Lago documented subscription charges and entitlement privilege arrays", async () => {
  const client = new HttpLagoEntitlementsClient({
    apiKey: "test-token",
    baseUrl: "https://billing-dev.prontiq.dev",
    fetchImpl: async (url, init) => {
      assert.deepEqual(init?.headers, { Authorization: "Bearer test-token" });
      const path = String(url).replace("https://billing-dev.prontiq.dev/api/v1", "");
      if (path === "/subscriptions/lago_sub_org_test") {
        return new Response(
          JSON.stringify({
            subscription: {
              external_customer_id: "org_test",
              external_id: "lago_sub_org_test",
              plan_code: "free",
              status: "active",
              current_billing_period_started_at: "2026-04-01T00:00:00Z",
              current_billing_period_ending_at: "2026-05-01T00:00:00Z",
              plan: {
                metadata: { address_api_enabled: "true" },
                charges: [
                  {
                    billable_metric: { code: "prontiq_address_requests" },
                    charge_model: "package",
                    properties: { free_units: 5_000 },
                  },
                ],
              },
            },
          }),
          { status: 200 },
        );
      }
      if (path === "/subscriptions/lago_sub_org_test/entitlements") {
        return new Response(
          JSON.stringify({
            entitlements: [
              {
                code: "api_keys",
                privileges: [{ code: "max", value: 2 }],
              },
              {
                code: "address_api",
                privileges: [
                  { code: "enabled", value: true },
                  { code: "monthly_quota", value: 5_000 },
                  { code: "enforcement_mode", value: "hard_cap" },
                  { code: "rate_limit_per_second", value: 10 },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    },
  });
  const [subscription, charges, entitlements] = await Promise.all([
    client.getSubscription("lago_sub_org_test"),
    client.getSubscriptionCharges("lago_sub_org_test"),
    client.getSubscriptionEntitlements("lago_sub_org_test"),
  ]);
  assert.equal(subscription?.planCode, "free");
  assert.deepEqual(charges, [
    {
      code: "prontiq_address_requests",
      billableMetricCode: "prontiq_address_requests",
      chargeModel: "package",
      properties: { free_units: 5_000 },
      metadata: undefined,
    },
  ]);
  assert.deepEqual(entitlements, [
    { featureCode: "api_keys", privileges: { max: 2 } },
    {
      featureCode: "address_api",
      privileges: {
        enabled: true,
        monthly_quota: 5_000,
        enforcement_mode: "hard_cap",
        rate_limit_per_second: 10,
      },
    },
  ]);
});
