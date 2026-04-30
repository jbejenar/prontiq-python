import test from "node:test";
import assert from "node:assert/strict";
import { BatchGetCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createAccountUsageService } from "./account-usage.js";
import { getOrgEnvelopeKey } from "./key-management.js";
import type { ApiKeyRecord, OrgEnvelopeRecord, UsageCounterRecord, UsageDailyRecord } from "@prontiq/shared";

class FakeDdb {
  batchGetCalls = 0;

  constructor(
    private readonly input: {
      envelope?: OrgEnvelopeRecord;
      keys?: ApiKeyRecord[];
      usageRows?: UsageCounterRecord[];
      usageRowsByCall?: UsageCounterRecord[][];
      unprocessedKeysByCall?: Array<Array<{ apiKeyHash: string; scope: string }>>;
      dailyRows?: UsageDailyRecord[];
    },
  ) {}

  async send(command: GetCommand | QueryCommand | BatchGetCommand) {
    if (command instanceof GetCommand) {
      const key = command.input.Key as { apiKeyHash?: string };
      return key.apiKeyHash === getOrgEnvelopeKey("org_test")
        ? { Item: this.input.envelope }
        : {};
    }
    if (command instanceof QueryCommand) {
      if (command.input.TableName === "keys") {
        return { Items: this.input.keys ?? [] };
      }
      return { Items: this.input.dailyRows ?? [] };
    }
    if (command instanceof BatchGetCommand) {
      const call = this.batchGetCalls;
      this.batchGetCalls += 1;
      const requestedKeys =
        command.input.RequestItems?.usage?.Keys as Array<{ apiKeyHash: string; scope: string }> | undefined;
      const requested = new Set(requestedKeys?.map((key) => `${key.apiKeyHash}|${key.scope}`) ?? []);
      const usageRows = this.input.usageRowsByCall?.[call] ?? this.input.usageRows ?? [];
      return {
        Responses: {
          usage: requested.size > 0
            ? usageRows.filter((row) => requested.has(`${row.apiKeyHash}|${row.scope}`))
            : usageRows,
        },
        UnprocessedKeys: this.input.unprocessedKeysByCall?.[call]?.length
          ? { usage: { Keys: this.input.unprocessedKeysByCall[call] } }
          : undefined,
      };
    }
    throw new Error("unexpected command");
  }
}

function makeEnvelope(overrides: Partial<OrgEnvelopeRecord> = {}): OrgEnvelopeRecord {
  return {
    apiKeyHash: getOrgEnvelopeKey("org_test"),
    orgId: "org_test",
    ownerEmail: "test@example.com",
    tier: "free",
    products: ["address"],
    quotaPerProduct: 5_000,
    enforcementMode: "hard_cap",
    rateLimit: 10,
    maxKeys: 2,
    paymentOverdue: false,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    hasFirstKey: true,
    activeKeyCount: 1,
    completedAt: "2026-04-25T00:00:00.000Z",
    billingPeriodKey: "2026-04-25_2026-05-25",
    billingPeriodStartedAt: "2026-04-25T00:00:00.000Z",
    billingPeriodEndingAt: "2026-05-25T00:00:00.000Z",
    lagoLastSyncedAt: "2026-04-25T00:00:00.000Z",
    ...overrides,
  };
}

function makeKey(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    apiKeyHash: "h".repeat(64),
    keyId: "key_01J00000000000000000000000",
    keyPrefix: "pq_live_1234",
    ownerEmail: "test@example.com",
    orgId: "org_test",
    tier: "free",
    products: ["address"],
    quotaPerProduct: 5_000,
    enforcementMode: "hard_cap",
    rateLimit: 10,
    active: false,
    paymentOverdue: false,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    createdAt: "2026-04-25T00:00:00.000Z",
    lastUsedAt: null,
    billingPeriodKey: "2026-04-25_2026-05-25",
    billingPeriodStartedAt: "2026-04-25T00:00:00.000Z",
    billingPeriodEndingAt: "2026-05-25T00:00:00.000Z",
    ...overrides,
  };
}

test("getUsage includes revoked-key usage and PAYG nullable quota fields", async () => {
  const ddb = new FakeDdb({
    envelope: makeEnvelope({
      tier: "payg",
      quotaPerProduct: null,
      enforcementMode: "uncapped_tracked",
      rateLimit: 25,
    }),
    keys: [makeKey({ active: false, quotaPerProduct: null, enforcementMode: "uncapped_tracked" })],
    usageRows: [
      {
        apiKeyHash: "h".repeat(64),
        scope: "address#period#2026-04-25_2026-05-25",
        requestCount: 12,
        lastPushedCumulativeCount: 0,
        ttl: 1,
      },
    ],
    dailyRows: [
      {
        orgId: "org_test",
        bucketKey: "period#2026-04-25_2026-05-25#day#2026-04-30#product#address",
        product: "address",
        periodKey: "2026-04-25_2026-05-25",
        bucketDate: "2026-04-30",
        credits: 12,
        eventCount: 12,
        updatedAt: "2026-04-30T00:00:00.000Z",
        ttl: 1,
      },
    ],
  });
  const service = createAccountUsageService({
    ddb: ddb as never,
    keysTableName: "keys",
    usageTableName: "usage",
    usageDailyTableName: "daily",
    counterPeriodSource: () => "lago",
  });

  const result = await service.getUsage({
    orgId: "org_test",
    granularity: "daily",
    now: new Date("2026-04-30T00:00:00.000Z"),
  });

  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.usage.products[0]?.usedCredits, 12);
  assert.equal(result.usage.products[0]?.quotaCredits, null);
  assert.equal(result.usage.products[0]?.remainingCredits, null);
  assert.equal(result.usage.products[0]?.overageCredits, null);
  assert.equal(result.usage.products[0]?.series[0]?.credits, 12);
});

test("getUsage retries DynamoDB BatchGet unprocessed keys before returning totals", async () => {
  const usageKey = {
    apiKeyHash: "h".repeat(64),
    scope: "address#period#2026-04-25_2026-05-25",
  };
  const ddb = new FakeDdb({
    envelope: makeEnvelope(),
    keys: [makeKey()],
    usageRowsByCall: [
      [],
      [
        {
          ...usageKey,
          requestCount: 19,
          lastPushedCumulativeCount: 0,
          ttl: 1,
        },
      ],
    ],
    unprocessedKeysByCall: [[usageKey], []],
  });
  const service = createAccountUsageService({
    ddb: ddb as never,
    keysTableName: "keys",
    usageTableName: "usage",
    usageDailyTableName: "daily",
    counterPeriodSource: () => "lago",
  });

  const result = await service.getUsage({
    orgId: "org_test",
    granularity: "daily",
    now: new Date("2026-04-30T00:00:00.000Z"),
  });

  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(ddb.batchGetCalls, 2);
  assert.equal(result.usage.products[0]?.usedCredits, 19);
});

test("getUsage reports mixed_key_periods when counter rows do not match the active period", async () => {
  const ddb = new FakeDdb({
    envelope: makeEnvelope(),
    keys: [makeKey({ billingPeriodKey: "2026-03-25_2026-04-25" })],
    usageRows: [
      {
        apiKeyHash: "h".repeat(64),
        scope: "address#period#2026-03-25_2026-04-25",
        requestCount: 7,
        lastPushedCumulativeCount: 0,
        ttl: 1,
      },
    ],
  });
  const service = createAccountUsageService({
    ddb: ddb as never,
    keysTableName: "keys",
    usageTableName: "usage",
    usageDailyTableName: "daily",
    counterPeriodSource: () => "lago",
  });

  const result = await service.getUsage({
    orgId: "org_test",
    granularity: "daily",
    now: new Date("2026-04-30T00:00:00.000Z"),
  });

  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.usage.period.key, "2026-04-25_2026-05-25");
  assert.equal(result.usage.period.scopeConsistency, "mixed_key_periods");
  assert.equal(result.usage.products[0]?.usedCredits, 0);
});

test("getUsage excludes stale key-period counters from current-period card totals", async () => {
  const activeHash = "a".repeat(64);
  const staleHash = "b".repeat(64);
  const ddb = new FakeDdb({
    envelope: makeEnvelope({ quotaPerProduct: 100 }),
    keys: [
      makeKey({
        apiKeyHash: activeHash,
        keyId: "key_01J00000000000000000000001",
        billingPeriodKey: "2026-04-25_2026-05-25",
      }),
      makeKey({
        apiKeyHash: staleHash,
        keyId: "key_01J00000000000000000000002",
        billingPeriodKey: "2026-03-25_2026-04-25",
      }),
    ],
    usageRows: [
      {
        apiKeyHash: activeHash,
        scope: "address#period#2026-04-25_2026-05-25",
        requestCount: 12,
        lastPushedCumulativeCount: 0,
        ttl: 1,
      },
      {
        apiKeyHash: staleHash,
        scope: "address#period#2026-03-25_2026-04-25",
        requestCount: 80,
        lastPushedCumulativeCount: 0,
        ttl: 1,
      },
    ],
  });
  const service = createAccountUsageService({
    ddb: ddb as never,
    keysTableName: "keys",
    usageTableName: "usage",
    usageDailyTableName: "daily",
    counterPeriodSource: () => "lago",
  });

  const result = await service.getUsage({
    orgId: "org_test",
    granularity: "daily",
    now: new Date("2026-04-30T00:00:00.000Z"),
  });

  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  const product = result.usage.products[0];
  assert.equal(product?.usedCredits, 12);
  assert.equal(product?.remainingCredits, 88);
  assert.equal(product?.overageCredits, 0);
  assert.equal(result.usage.period.scopeConsistency, "mixed_key_periods");
});

for (const granularity of ["daily", "weekly", "monthly"] as const) {
  test(`getUsage returns a baseline/total ${granularity} chart point when projection is missing`, async () => {
    const ddb = new FakeDdb({
      envelope: makeEnvelope({ quotaPerProduct: 100 }),
      keys: [makeKey()],
      usageRows: [
        {
          apiKeyHash: "h".repeat(64),
          scope: "address#period#2026-04-25_2026-05-25",
          requestCount: 20,
          lastPushedCumulativeCount: 0,
          ttl: 1,
        },
      ],
      dailyRows: [],
    });
    const service = createAccountUsageService({
      ddb: ddb as never,
      keysTableName: "keys",
      usageTableName: "usage",
      usageDailyTableName: "daily",
      counterPeriodSource: () => "lago",
    });

    const result = await service.getUsage({
      orgId: "org_test",
      granularity,
      now: new Date("2026-04-30T00:00:00.000Z"),
    });

    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.deepEqual(result.usage.products[0]?.series, [
      {
        bucket: granularity === "monthly"
          ? "2026-04-25_2026-05-25"
          : "baseline#2026-04-25_2026-05-25",
        label: granularity === "monthly" ? "Current period" : "Before chart tracking",
        credits: 20,
        kind: granularity === "monthly" ? "total" : "baseline",
        sortKey: "2026-04-25#0000",
      },
    ]);
  });
}

for (const granularity of ["daily", "weekly", "monthly"] as const) {
  test(`getUsage preserves projected ${granularity} buckets with a baseline during partial projection lag`, async () => {
    const ddb = new FakeDdb({
      envelope: makeEnvelope({ quotaPerProduct: 100 }),
      keys: [makeKey()],
      usageRows: [
        {
          apiKeyHash: "h".repeat(64),
          scope: "address#period#2026-04-25_2026-05-25",
          requestCount: 20,
          lastPushedCumulativeCount: 0,
          ttl: 1,
        },
      ],
      dailyRows: [
        {
          orgId: "org_test",
          bucketKey: "period#2026-04-25_2026-05-25#day#2026-04-30#product#address",
          product: "address",
          periodKey: "2026-04-25_2026-05-25",
          bucketDate: "2026-04-30",
          credits: 7,
          eventCount: 7,
          updatedAt: "2026-04-30T00:00:00.000Z",
          ttl: 1,
        },
      ],
    });
    const service = createAccountUsageService({
      ddb: ddb as never,
      keysTableName: "keys",
      usageTableName: "usage",
      usageDailyTableName: "daily",
      counterPeriodSource: () => "lago",
    });

    const result = await service.getUsage({
      orgId: "org_test",
      granularity,
      now: new Date("2026-04-30T00:00:00.000Z"),
    });

    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    if (granularity === "daily") {
      assert.deepEqual(result.usage.products[0]?.series, [
        {
          bucket: "baseline#2026-04-25_2026-05-25",
          label: "Before chart tracking",
          credits: 13,
          kind: "baseline",
          sortKey: "2026-04-25#0000",
        },
        {
          bucket: "2026-04-30",
          label: "30 Apr",
          credits: 7,
          kind: "projected",
          sortKey: "2026-04-30#1000",
        },
      ]);
    } else if (granularity === "weekly") {
      assert.deepEqual(result.usage.products[0]?.series, [
        {
          bucket: "baseline#2026-04-25_2026-05-25",
          label: "Before chart tracking",
          credits: 13,
          kind: "baseline",
          sortKey: "2026-04-25#0000",
        },
        {
          bucket: "2026-04-25",
          label: "Week of 25 Apr",
          credits: 7,
          kind: "projected",
          sortKey: "2026-04-25#1000",
        },
      ]);
    } else {
      assert.deepEqual(result.usage.products[0]?.series, [
        {
          bucket: "2026-04-25_2026-05-25",
          label: "Current period",
          credits: 20,
          kind: "total",
          sortKey: "2026-04-25#0000",
        },
      ]);
    }
  });
}

for (const granularity of ["daily", "weekly"] as const) {
  test(`getUsage returns projected ${granularity} buckets only when projection matches counters`, async () => {
    const ddb = new FakeDdb({
      envelope: makeEnvelope({ quotaPerProduct: 100 }),
      keys: [makeKey()],
      usageRows: [
        {
          apiKeyHash: "h".repeat(64),
          scope: "address#period#2026-04-25_2026-05-25",
          requestCount: 12,
          lastPushedCumulativeCount: 0,
          ttl: 1,
        },
      ],
      dailyRows: [
        {
          orgId: "org_test",
          bucketKey: "period#2026-04-25_2026-05-25#day#2026-04-30#product#address",
          product: "address",
          periodKey: "2026-04-25_2026-05-25",
          bucketDate: "2026-04-30",
          credits: 12,
          eventCount: 12,
          updatedAt: "2026-04-30T00:00:00.000Z",
          ttl: 1,
        },
      ],
    });
    const service = createAccountUsageService({
      ddb: ddb as never,
      keysTableName: "keys",
      usageTableName: "usage",
      usageDailyTableName: "daily",
      counterPeriodSource: () => "lago",
    });

    const result = await service.getUsage({
      orgId: "org_test",
      granularity,
      now: new Date("2026-04-30T00:00:00.000Z"),
    });

    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.usage.products[0]?.series.length, 1);
    assert.equal(result.usage.products[0]?.series[0]?.kind, "projected");
    assert.equal(result.usage.products[0]?.series[0]?.credits, 12);
  });
}

for (const granularity of ["daily", "weekly", "monthly"] as const) {
  test(`getUsage returns authoritative ${granularity} total when projection exceeds counters`, async () => {
    const ddb = new FakeDdb({
      envelope: makeEnvelope({ quotaPerProduct: 100 }),
      keys: [makeKey()],
      usageRows: [
        {
          apiKeyHash: "h".repeat(64),
          scope: "address#period#2026-04-25_2026-05-25",
          requestCount: 9,
          lastPushedCumulativeCount: 0,
          ttl: 1,
        },
      ],
      dailyRows: [
        {
          orgId: "org_test",
          bucketKey: "period#2026-04-25_2026-05-25#day#2026-04-30#product#address",
          product: "address",
          periodKey: "2026-04-25_2026-05-25",
          bucketDate: "2026-04-30",
          credits: 12,
          eventCount: 12,
          updatedAt: "2026-04-30T00:00:00.000Z",
          ttl: 1,
        },
      ],
    });
    const service = createAccountUsageService({
      ddb: ddb as never,
      keysTableName: "keys",
      usageTableName: "usage",
      usageDailyTableName: "daily",
      counterPeriodSource: () => "lago",
    });

    const result = await service.getUsage({
      orgId: "org_test",
      granularity,
      now: new Date("2026-04-30T00:00:00.000Z"),
    });

    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.deepEqual(result.usage.products[0]?.series, [
      {
        bucket: "2026-04-25_2026-05-25",
        label: "Current period",
        credits: 9,
        kind: "total",
        sortKey: "2026-04-25#0000",
      },
    ]);
  });
}

test("getUsage reports mixed_key_periods when Lago-mode key period projection is missing", async () => {
  const keyHash = "c".repeat(64);
  const ddb = new FakeDdb({
    envelope: makeEnvelope({ quotaPerProduct: 100 }),
    keys: [
      makeKey({
        apiKeyHash: keyHash,
        billingPeriodKey: undefined,
        billingPeriodStartedAt: undefined,
        billingPeriodEndingAt: undefined,
      }),
    ],
    usageRows: [
      {
        apiKeyHash: keyHash,
        scope: "address#2026-04",
        requestCount: 30,
        lastPushedCumulativeCount: 0,
        ttl: 1,
      },
    ],
  });
  const service = createAccountUsageService({
    ddb: ddb as never,
    keysTableName: "keys",
    usageTableName: "usage",
    usageDailyTableName: "daily",
    counterPeriodSource: () => "lago",
  });

  const result = await service.getUsage({
    orgId: "org_test",
    granularity: "daily",
    now: new Date("2026-04-30T00:00:00.000Z"),
  });

  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.usage.period.key, "2026-04-25_2026-05-25");
  assert.equal(result.usage.period.scopeConsistency, "mixed_key_periods");
  assert.equal(result.usage.products[0]?.usedCredits, 0);
  assert.equal(result.usage.products[0]?.remainingCredits, 100);
  assert.equal(result.usage.products[0]?.overageCredits, 0);
});

test("getUsage resolves counter period source once per request", async () => {
  let calls = 0;
  const ddb = new FakeDdb({
    envelope: makeEnvelope(),
    keys: [makeKey()],
  });
  const service = createAccountUsageService({
    ddb: ddb as never,
    keysTableName: "keys",
    usageTableName: "usage",
    usageDailyTableName: "daily",
    counterPeriodSource: () => {
      calls += 1;
      return calls === 1 ? "lago" : "calendar";
    },
  });

  const result = await service.getUsage({
    orgId: "org_test",
    granularity: "daily",
    now: new Date("2026-04-30T00:00:00.000Z"),
  });

  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(calls, 1);
  assert.equal(result.usage.period.source, "lago");
});
