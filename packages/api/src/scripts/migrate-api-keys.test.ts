import test from "node:test";
import assert from "node:assert/strict";
import { hashKey } from "@prontiq/shared";
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
  assert.equal(plan.keyRecord.quotaPerProduct, 25000);
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
  assert.equal(plan.keyRecord.quotaPerProduct, 10000);
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

test("buildMigrationPlan rerun: BOTH keyId AND createdAt must be preserved for legacy records lacking createdAt", () => {
  // Legacy record WITHOUT its own createdAt — the case where
  // buildMigrationPlan defaults to `migratedAt` (nowIso() on each
  // call). This is the path the bot caught: preserving keyId alone
  // isn't enough; createdAt also drifts on rerun.
  const legacy: LegacyApiKeyRecord = {
    apiKey: "pq_live_no_createdAt_rerun_check_0000",
    tier: "free",
    products: ["address"],
  };

  // First run at T1 — row gets keyId=ulid_A and createdAt=T1.
  const t1 = "2026-04-01T00:00:00.000Z";
  const plan1 = buildMigrationPlan(legacy, t1);
  assert.equal(plan1.keyRecord.createdAt, t1);
  assert.match(plan1.keyRecord.keyId, /^key_[0-9A-Z]{26}$/);

  // Second run at T2 with NEITHER existing field preserved — the
  // pre-fix-v1 behavior. Both keyId and createdAt drift; the rerun
  // is mis-classified as a conflict.
  const t2 = "2026-04-28T00:00:00.000Z";
  const broken = buildMigrationPlan(legacy, t2);
  assert.notEqual(
    broken.keyRecord.createdAt,
    plan1.keyRecord.createdAt,
    "without preservation, rerun's createdAt drifts to the new clock — this is the bot-flagged bug",
  );
  assert.equal(
    recordsSemanticallyMatch(broken.keyRecord, plan1.keyRecord),
    false,
    "without preservation, rerun records would be mis-classified as conflicts",
  );

  // Second run at T2 with ONLY keyId preserved (the fix-v1 state) —
  // the rerun still mis-classifies because createdAt drifts.
  const partialFix = buildMigrationPlan(legacy, t2, plan1.keyRecord.keyId);
  assert.equal(
    recordsSemanticallyMatch(partialFix.keyRecord, plan1.keyRecord),
    false,
    "preserving keyId alone is not enough — createdAt also drifts on rerun",
  );

  // Second run at T2 with BOTH keyId AND createdAt preserved —
  // the holistic fix. migrateRecord passes existing.createdAt as
  // migratedAt so the legacy-fallback path resolves to the prior
  // value instead of nowIso().
  const fullFix = buildMigrationPlan(
    legacy,
    plan1.keyRecord.createdAt,
    plan1.keyRecord.keyId,
  );
  assert.equal(fullFix.keyRecord.createdAt, plan1.keyRecord.createdAt);
  assert.equal(fullFix.keyRecord.keyId, plan1.keyRecord.keyId);
  assert.equal(
    recordsSemanticallyMatch(fullFix.keyRecord, plan1.keyRecord),
    true,
    "with BOTH fields preserved, rerun is correctly classified as a skip",
  );

  // Sanity: real entitlement drift (tier change) with both fields
  // preserved must still surface as a non-match — the fix doesn't
  // mask genuine conflicts.
  const drifted = buildMigrationPlan(
    { ...legacy, tier: "starter" },
    plan1.keyRecord.createdAt,
    plan1.keyRecord.keyId,
  );
  assert.equal(
    recordsSemanticallyMatch(drifted.keyRecord, plan1.keyRecord),
    false,
    "genuine entitlement drift must still surface as a conflict",
  );
});

test("buildMigrationPlan with legacy.createdAt present: preserved verbatim regardless of clock", () => {
  // Sanity: when the legacy row carries its own createdAt, both runs
  // use it verbatim (no clock dependence). This path was never bugged
  // but pinning it here documents the precedence rule.
  const legacy: LegacyApiKeyRecord = {
    apiKey: "pq_live_with_createdAt_legacy_0000",
    tier: "free",
    products: ["address"],
    createdAt: "2026-01-15T08:30:00.000Z",
  };
  const plan1 = buildMigrationPlan(legacy, "2026-04-01T00:00:00.000Z");
  const plan2 = buildMigrationPlan(legacy, "2026-04-28T00:00:00.000Z");
  assert.equal(plan1.keyRecord.createdAt, "2026-01-15T08:30:00.000Z");
  assert.equal(plan2.keyRecord.createdAt, "2026-01-15T08:30:00.000Z");
});
