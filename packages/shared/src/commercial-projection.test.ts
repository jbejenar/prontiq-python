import assert from "node:assert/strict";
import test from "node:test";
import { resolveEffectiveCommercialProjection } from "./commercial-projection.js";

test("legacy paid tiers without Lago projection preserve prior soft-overage behavior", () => {
  for (const [tier, expectedQuota, expectedRateLimit, expectedMaxKeys] of [
    ["starter", 25_000, 50, 5],
    ["growth", 100_000, 100, 20],
    ["max", 500_000, 250, 50],
  ] as const) {
    const projection = resolveEffectiveCommercialProjection({
      products: ["address", "abn"],
      tier,
    });
    assert.equal(projection.enforcementMode, "soft_overage");
    assert.equal(projection.quotaPerProduct, expectedQuota);
    assert.equal(projection.rateLimit, expectedRateLimit);
    assert.equal(projection.maxKeys, expectedMaxKeys);
    assert.deepEqual(projection.products, ["address", "abn"]);
  }
});

test("legacy payg and enterprise remain uncapped when projection fields are absent", () => {
  for (const tier of ["payg", "enterprise"] as const) {
    const projection = resolveEffectiveCommercialProjection({ tier });
    assert.equal(projection.enforcementMode, "uncapped_tracked");
    assert.equal(projection.quotaPerProduct, null);
  }
});

test("unknown dynamic plan codes without projection fail conservatively to Free", () => {
  const projection = resolveEffectiveCommercialProjection({ tier: "custom_pack_aud" });
  assert.equal(projection.enforcementMode, "hard_cap");
  assert.equal(projection.quotaPerProduct, 10_000);
  assert.equal(projection.rateLimit, 10);
  assert.equal(projection.maxKeys, 2);
  assert.deepEqual(projection.products, ["address"]);
});

test("projected Lago fields override legacy fallback values, including explicit nulls", () => {
  const projection = resolveEffectiveCommercialProjection({
    enforcementMode: "uncapped_tracked",
    maxKeys: 7,
    products: ["address"],
    quotaPerProduct: null,
    rateLimit: null,
    tier: "starter",
  });
  assert.deepEqual(projection, {
    enforcementMode: "uncapped_tracked",
    maxKeys: 7,
    products: ["address"],
    quotaPerProduct: null,
    rateLimit: null,
  });
});
