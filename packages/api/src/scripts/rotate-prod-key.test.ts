import test from "node:test";
import assert from "node:assert/strict";
import { hashKey } from "@prontiq/shared";
import type { ApiKeyRecord, UsageCounterRecord } from "@prontiq/shared";
import { buildRotationPlan } from "./rotate-prod-key.js";

test("buildRotationPlan clones entitlements and usage onto a fresh key", () => {
  const source = {
    keyRecord: {
      apiKeyHash: hashKey("pq_live_prod_000000000000000000000000"),
      keyId: "key_01TESTKEYIDXXXXXXXXXXXXXX",
      keyPrefix: "pq_live_prod",
      ownerEmail: "owner@example.com",
      orgId: "org_prod",
      tier: "enterprise",
      products: ["address", "abn"],
      quotaPerProduct: 999999,
      rateLimit: null,
      active: true,
      paymentOverdue: false,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      subscriptionItems: {},
      createdAt: "2026-04-16T00:00:00.000Z",
      lastUsedAt: null,
    } satisfies ApiKeyRecord,
    legacyRecord: {
      apiKey: "pq_live_prod_000000000000000000000000",
      active: true,
      monthlyQuotaPerProduct: 999999,
      orgId: "org_prod",
      ownerEmail: "owner@example.com",
      products: ["address", "abn"],
      tier: "enterprise" as const,
      usage: {
        address: {
          "2026-04": 12,
        },
      },
    },
    oldApiKeyRaw: "pq_live_prod_000000000000000000000000",
    usageRecords: [
      {
        apiKeyHash: hashKey("pq_live_prod_000000000000000000000000"),
        scope: "address#2026-04",
        requestCount: 277,
        ttl: 1793318400,
        lastPushedCumulativeCount: 217,
        closed: true,
      } satisfies UsageCounterRecord,
    ],
  };

  const plan = buildRotationPlan(
    source,
    {
      raw: "pq_live_671a797b240ec8313f38b8db263c15211c006ba4083c4155",
      hash: hashKey("pq_live_671a797b240ec8313f38b8db263c15211c006ba4083c4155"),
      prefix: "pq_live_671a",
    },
    "2026-04-17T00:00:00.000Z",
  );

  assert.equal(plan.newKeyRecord.active, true);
  assert.equal(plan.newKeyRecord.apiKeyHash, hashKey(plan.newApiKeyRaw));
  assert.equal(plan.newKeyRecord.keyPrefix, "pq_live_671a");
  assert.equal(plan.newKeyRecord.createdAt, "2026-04-17T00:00:00.000Z");
  assert.equal(plan.newLegacyRecord.apiKey, plan.newApiKeyRaw);
  assert.equal(plan.newLegacyRecord.active, true);
  assert.deepEqual(plan.newLegacyRecord.products, ["address", "abn"]);
  assert.deepEqual(plan.newLegacyRecord.usage, {
    address: {
      "2026-04": 277,
    },
  });
  assert.equal(plan.newUsageRecords.length, 1);
  assert.equal(plan.newUsageRecords[0]?.apiKeyHash, plan.newKeyRecord.apiKeyHash);
  assert.equal(plan.newUsageRecords[0]?.scope, "address#2026-04");
  assert.equal(plan.newUsageRecords[0]?.closed, undefined);
});
