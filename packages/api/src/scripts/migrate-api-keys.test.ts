import test from "node:test";
import assert from "node:assert/strict";
import { hashKey } from "@prontiq/shared/keys";
import {
  buildMigrationPlan,
  isLegacySeedKey,
  recordsSemanticallyMatch,
  type LegacyApiKeyRecord,
} from "./migrate-api-keys.js";

test("buildMigrationPlan converts legacy usage maps into v2.2 records", () => {
  const legacyRecord: LegacyApiKeyRecord = {
    apiKey: "pq_test_valid_key_1234567890",
    active: true,
    createdAt: "2026-04-01T00:00:00.000Z",
    orgId: "org_123",
    ownerEmail: "owner@example.com",
    tier: "starter",
    usage: {
      address: {
        "2026-03": 12,
        "2026-04": 9,
      },
      abn: {
        "2026-04": 3,
      },
    },
  };

  const migratedAt = "2026-04-16T12:00:00.000Z";
  const plan = buildMigrationPlan(legacyRecord, migratedAt);

  assert.equal(plan.keyRecord.apiKeyHash, hashKey(legacyRecord.apiKey));
  assert.equal(plan.keyRecord.keyPrefix, "pq_test_vali");
  assert.equal(plan.keyRecord.products.includes("address"), true);
  assert.equal(plan.keyRecord.products.includes("abn"), true);
  assert.equal(plan.keyRecord.lastUsedAt, null);
  assert.equal(plan.keyRecord.quotaPerProduct, 10000);
  assert.equal(plan.usageRecords.length, 3);
  assert.deepEqual(
    plan.usageRecords.map(({ scope, requestCount, lastPushedCumulativeCount, lastUsedAt }) => ({
      lastUsedAt,
      lastPushedCumulativeCount,
      requestCount,
      scope,
    })),
    [
      {
        lastUsedAt: undefined,
        lastPushedCumulativeCount: 12,
        requestCount: 12,
        scope: "address#2026-03",
      },
      {
        lastUsedAt: undefined,
        lastPushedCumulativeCount: 9,
        requestCount: 9,
        scope: "address#2026-04",
      },
      {
        lastUsedAt: undefined,
        lastPushedCumulativeCount: 3,
        requestCount: 3,
        scope: "abn#2026-04",
      },
    ],
  );
});

test("free-tier migration constrains products to address only", () => {
  const plan = buildMigrationPlan({
    apiKey: "pq_test_free_key_1234567890",
    tier: "free",
    products: ["address"],
    usage: {
      address: { "2026-04": 4 },
    },
  });

  assert.deepEqual(plan.keyRecord.products, ["address"]);
  assert.equal(plan.keyRecord.quotaPerProduct, 5000);
  assert.equal(plan.keyRecord.rateLimit, 10);
});

test("free-tier migration preserves legacy ABN access when products were previously enabled", () => {
  const plan = buildMigrationPlan({
    apiKey: "pq_test_free_abn_key_1234567890",
    monthlyQuotaPerProduct: 5000,
    products: ["address", "abn"],
    tier: "free",
  });

  assert.deepEqual(plan.keyRecord.products, ["address", "abn"]);
  assert.equal(plan.keyRecord.quotaPerProduct, 5000);
});

test("free-tier migration falls back to the legacy free entitlement set when products are absent", () => {
  const plan = buildMigrationPlan({
    apiKey: "pq_test_free_legacy_key_1234567890",
    tier: "free",
  });

  assert.deepEqual(plan.keyRecord.products, ["address", "abn"]);
});

test("recordsSemanticallyMatch ignores array order and undefined fields", () => {
  assert.equal(
    recordsSemanticallyMatch(
      { products: ["abn", "address"], lastUsedAt: undefined, active: true },
      { active: true, products: ["address", "abn"] },
    ),
    true,
  );
});

test("isLegacySeedKey detects the internal production seed key prefix", () => {
  assert.equal(isLegacySeedKey("pq_live_prod_000000000000000000000000"), true);
  assert.equal(isLegacySeedKey("pq_live_customer_123"), false);
});
