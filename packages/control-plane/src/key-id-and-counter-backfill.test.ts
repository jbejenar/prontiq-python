import test from "node:test";
import assert from "node:assert/strict";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  type DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { backfillKeyIdsAndCounters } from "./key-id-and-counter-backfill.js";

interface FakeDdbCommand {
  input?: {
    Key?: Record<string, unknown>;
    UpdateExpression?: string;
    ExpressionAttributeValues?: Record<string, unknown>;
    ConditionExpression?: string;
    FilterExpression?: string;
    Select?: string;
  };
}

function makeEnvelopeItem(input: {
  apiKeyHash: string;
  orgId: string;
  activeKeyCount?: number;
}): Record<string, unknown> {
  const item: Record<string, unknown> = {
    apiKeyHash: input.apiKeyHash,
    orgId: input.orgId,
    ownerEmail: "owner@example.com",
    tier: "free",
    products: ["address"],
    paymentOverdue: false,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    hasFirstKey: true,
    completedAt: "2026-04-27T00:00:00.000Z",
  };
  if (input.activeKeyCount !== undefined) {
    item.activeKeyCount = input.activeKeyCount;
  }
  return item;
}

function makeKeyItem(input: {
  apiKeyHash: string;
  orgId: string;
  keyId?: string;
}): Record<string, unknown> {
  const item: Record<string, unknown> = {
    apiKeyHash: input.apiKeyHash,
    orgId: input.orgId,
    keyPrefix: "pq_live_aaaa",
    active: true,
    tier: "free",
    products: ["address"],
    quotaPerProduct: 1000,
    rateLimit: null,
    paymentOverdue: false,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    ownerEmail: "owner@example.com",
    createdAt: "2026-04-27T00:00:00.000Z",
    lastUsedAt: null,
  };
  if (input.keyId !== undefined) {
    item.keyId = input.keyId;
  }
  return item;
}

interface FakeDdbState {
  scanItems: Array<Record<string, unknown>>;
  scanPages?: Array<Array<Record<string, unknown>>>;
  countByOrgId: Record<string, number>;
  // If set, the UpdateCommand for keyId throws a generic error on the
  // matching apiKeyHash key (simulates a transient SDK failure).
  conditionalThrowOnKeyId?: Set<string>;
  // If set, the conditional UpdateCommand for keyId fails the
  // `attribute_not_exists(keyId)` check (simulates a concurrent writer).
  conditionalCheckFailedOnKeyId?: Set<string>;
  // If set, the conditional UpdateCommand for activeKeyCount fails the
  // `attribute_not_exists(activeKeyCount)` check on the matching envelope
  // (simulates the script-vs-createKey race).
  conditionalCheckFailedOnActiveKeyCount?: Set<string>;
}

function makeFakeDdb(state: FakeDdbState): {
  ddb: DynamoDBDocumentClient;
  scanCalls: number;
  queryCalls: number;
  queryInputs: Array<{
    filter: string;
    values: Record<string, unknown> | undefined;
  }>;
  updateCalls: Array<{
    key: Record<string, unknown>;
    update: string;
    condition: string;
    values: Record<string, unknown> | undefined;
  }>;
} {
  let scanCallCount = 0;
  let queryCallCount = 0;
  const queryInputs: Array<{
    filter: string;
    values: Record<string, unknown> | undefined;
  }> = [];
  const updateCalls: Array<{
    key: Record<string, unknown>;
    update: string;
    condition: string;
    values: Record<string, unknown> | undefined;
  }> = [];
  const pages = state.scanPages ?? [state.scanItems];
  const ddb = {
    async send(command: FakeDdbCommand) {
      if (command instanceof ScanCommand) {
        const idx = scanCallCount;
        scanCallCount += 1;
        const items = pages[idx] ?? [];
        const last = idx === pages.length - 1;
        return {
          Items: items,
          LastEvaluatedKey: last ? undefined : { __cursor: idx },
        };
      }
      if (command instanceof QueryCommand) {
        queryCallCount += 1;
        queryInputs.push({
          filter: command.input?.FilterExpression ?? "",
          values: command.input?.ExpressionAttributeValues,
        });
        const orgId = command.input?.ExpressionAttributeValues?.[":orgId"] as string;
        const count = state.countByOrgId[orgId] ?? 0;
        return command.input?.Select === "COUNT" ? { Count: count } : { Items: [] };
      }
      if (command instanceof UpdateCommand) {
        const key = command.input?.Key ?? {};
        const apiKeyHash = key.apiKeyHash as string;
        const expression = command.input?.UpdateExpression ?? "";
        const isKeyIdUpdate = expression.includes("keyId");
        const isActiveKeyCountUpdate = expression.includes("activeKeyCount");
        if (isKeyIdUpdate && state.conditionalThrowOnKeyId?.has(apiKeyHash)) {
          throw new Error("simulated transient");
        }
        if (isKeyIdUpdate && state.conditionalCheckFailedOnKeyId?.has(apiKeyHash)) {
          // Simulate the SDK's typed conditional-check failure.
          throw new ConditionalCheckFailedException({
            $metadata: {},
            message: "Conditional check failed",
          });
        }
        if (
          isActiveKeyCountUpdate &&
          state.conditionalCheckFailedOnActiveKeyCount?.has(apiKeyHash)
        ) {
          throw new ConditionalCheckFailedException({
            $metadata: {},
            message: "Conditional check failed",
          });
        }
        updateCalls.push({
          key,
          update: expression,
          condition: command.input?.ConditionExpression ?? "",
          values: command.input?.ExpressionAttributeValues,
        });
        return {};
      }
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    },
  } as unknown as DynamoDBDocumentClient;
  return {
    ddb,
    get scanCalls() {
      return scanCallCount;
    },
    get queryCalls() {
      return queryCallCount;
    },
    queryInputs,
    updateCalls,
  };
}

test("dry run reports envelopes and keys needing backfill without writing", async () => {
  const orgId = "org_TestA";
  const { ddb, updateCalls } = makeFakeDdb({
    scanItems: [
      makeEnvelopeItem({ apiKeyHash: `ORG#${orgId}`, orgId }),
      makeKeyItem({ apiKeyHash: "hash_a", orgId }),
      makeKeyItem({ apiKeyHash: "hash_b", orgId }),
    ],
    countByOrgId: { [orgId]: 2 },
  });

  const stats = await backfillKeyIdsAndCounters({ keysTableName: "T", ddb });
  assert.equal(stats.dryRun, true);
  assert.equal(stats.envelopesScanned, 1);
  assert.equal(stats.envelopesUpdated, 1);
  assert.equal(stats.envelopesAlreadyUpToDate, 0);
  assert.equal(stats.keysScanned, 2);
  assert.equal(stats.keysBackfilled, 2);
  assert.equal(stats.keysAlreadyUpToDate, 0);
  assert.equal(stats.errors.length, 0);
  assert.equal(updateCalls.length, 0, "dry run must not issue any UpdateCommand");
});

test("apply writes envelope counter and key ids", async () => {
  const orgId = "org_TestB";
  const fake = makeFakeDdb({
    scanItems: [
      makeEnvelopeItem({ apiKeyHash: `ORG#${orgId}`, orgId }),
      makeKeyItem({ apiKeyHash: "hash_a", orgId }),
      makeKeyItem({ apiKeyHash: "hash_b", orgId }),
    ],
    countByOrgId: { [orgId]: 2 },
  });

  let nextId = 0;
  const stats = await backfillKeyIdsAndCounters({
    keysTableName: "T",
    ddb: fake.ddb,
    apply: true,
    generateKeyId: () => `key_GEN${nextId++}`,
  });

  assert.equal(stats.dryRun, false);
  assert.equal(stats.envelopesUpdated, 1);
  assert.equal(stats.keysBackfilled, 2);
  assert.equal(stats.errors.length, 0);

  const envelopeUpdate = fake.updateCalls.find(
    (c) => (c.key.apiKeyHash as string) === `ORG#${orgId}`,
  );
  assert.ok(envelopeUpdate, "envelope must be updated");
  assert.match(envelopeUpdate.update, /SET activeKeyCount = :c/);
  assert.equal(envelopeUpdate.values?.[":c"], 2);

  const keyUpdates = fake.updateCalls.filter((c) => /SET keyId = :id/.test(c.update));
  assert.equal(keyUpdates.length, 2);
  const idValues = keyUpdates.map((c) => c.values?.[":id"]);
  assert.deepEqual(idValues.sort(), ["key_GEN0", "key_GEN1"]);
});

test("apply is idempotent — re-run with all fields present is a no-op", async () => {
  const orgId = "org_TestC";
  const fake = makeFakeDdb({
    scanItems: [
      makeEnvelopeItem({ apiKeyHash: `ORG#${orgId}`, orgId, activeKeyCount: 2 }),
      makeKeyItem({ apiKeyHash: "hash_a", orgId, keyId: "key_existing_a" }),
      makeKeyItem({ apiKeyHash: "hash_b", orgId, keyId: "key_existing_b" }),
    ],
    countByOrgId: { [orgId]: 2 },
  });

  const stats = await backfillKeyIdsAndCounters({
    keysTableName: "T",
    ddb: fake.ddb,
    apply: true,
  });
  assert.equal(stats.envelopesUpdated, 0);
  assert.equal(stats.envelopesAlreadyUpToDate, 1);
  assert.equal(stats.keysBackfilled, 0);
  assert.equal(stats.keysAlreadyUpToDate, 2);
  assert.equal(fake.updateCalls.length, 0, "no writes on idempotent re-run");
});

test("ignores REGISTRY rows and any non-key non-envelope rows", async () => {
  const orgId = "org_TestD";
  const fake = makeFakeDdb({
    scanItems: [
      makeEnvelopeItem({ apiKeyHash: `ORG#${orgId}`, orgId }),
      { apiKeyHash: "REGISTRY#address#v1", products: ["address"] },
      { apiKeyHash: "hash_no_orgId" }, // missing orgId — not a candidate key
      makeKeyItem({ apiKeyHash: "hash_real", orgId }),
    ],
    countByOrgId: { [orgId]: 1 },
  });

  const stats = await backfillKeyIdsAndCounters({
    keysTableName: "T",
    ddb: fake.ddb,
    apply: true,
    generateKeyId: () => "key_FIXED",
  });
  assert.equal(stats.envelopesScanned, 1);
  assert.equal(stats.keysScanned, 1, "registry and malformed rows are not counted as keys");
  assert.equal(stats.keysBackfilled, 1);
});

test("paginates through multiple scan pages", async () => {
  const orgId = "org_TestE";
  const fake = makeFakeDdb({
    scanItems: [],
    scanPages: [
      [makeEnvelopeItem({ apiKeyHash: `ORG#${orgId}`, orgId })],
      [makeKeyItem({ apiKeyHash: "hash_a", orgId })],
      [makeKeyItem({ apiKeyHash: "hash_b", orgId })],
    ],
    countByOrgId: { [orgId]: 2 },
  });

  const stats = await backfillKeyIdsAndCounters({
    keysTableName: "T",
    ddb: fake.ddb,
    apply: true,
    generateKeyId: () => `key_PAGED${Math.random()}`,
  });
  assert.equal(fake.scanCalls, 3);
  assert.equal(stats.envelopesScanned, 1);
  assert.equal(stats.keysScanned, 2);
  assert.equal(stats.keysBackfilled, 2);
  assert.equal(stats.envelopesUpdated, 1);
});

test("ConditionalCheckFailed on keyId update is treated as already-up-to-date, not an error", async () => {
  const orgId = "org_TestF";
  const fake = makeFakeDdb({
    scanItems: [
      makeEnvelopeItem({ apiKeyHash: `ORG#${orgId}`, orgId, activeKeyCount: 1 }),
      makeKeyItem({ apiKeyHash: "hash_race", orgId }),
    ],
    countByOrgId: { [orgId]: 1 },
    conditionalCheckFailedOnKeyId: new Set(["hash_race"]),
  });

  const stats = await backfillKeyIdsAndCounters({
    keysTableName: "T",
    ddb: fake.ddb,
    apply: true,
  });
  assert.equal(stats.keysAlreadyUpToDate, 1);
  assert.equal(stats.keysBackfilled, 0);
  assert.equal(stats.errors.length, 0);
});

test("non-conditional failures are recorded in stats.errors and do not halt the scan", async () => {
  const orgId = "org_TestG";
  const fake = makeFakeDdb({
    scanItems: [
      makeEnvelopeItem({ apiKeyHash: `ORG#${orgId}`, orgId, activeKeyCount: 2 }),
      makeKeyItem({ apiKeyHash: "hash_throw", orgId }),
      makeKeyItem({ apiKeyHash: "hash_ok", orgId }),
    ],
    countByOrgId: { [orgId]: 2 },
    conditionalThrowOnKeyId: new Set(["hash_throw"]),
  });

  const stats = await backfillKeyIdsAndCounters({
    keysTableName: "T",
    ddb: fake.ddb,
    apply: true,
    generateKeyId: () => "key_NEW",
  });
  assert.equal(stats.errors.length, 1);
  assert.equal(stats.errors[0]?.apiKeyHash, "hash_throw");
  assert.equal(stats.keysBackfilled, 1, "the second key still gets backfilled after the first fails");
});

test("envelope race: missing-on-scan but ConditionalCheckFailed on update is treated as already-up-to-date", async () => {
  const orgId = "org_TestRace";
  const fake = makeFakeDdb({
    scanItems: [makeEnvelopeItem({ apiKeyHash: `ORG#${orgId}`, orgId })],
    countByOrgId: { [orgId]: 0 },
    conditionalCheckFailedOnActiveKeyCount: new Set([`ORG#${orgId}`]),
  });

  const stats = await backfillKeyIdsAndCounters({
    keysTableName: "T",
    ddb: fake.ddb,
    apply: true,
  });
  assert.equal(stats.envelopesUpdated, 0);
  assert.equal(stats.envelopesAlreadyUpToDate, 1);
  assert.equal(stats.errors.length, 0);
});

test("envelope already counted: skips the Query as well as the Update", async () => {
  const orgId = "org_TestSkip";
  const fake = makeFakeDdb({
    scanItems: [makeEnvelopeItem({ apiKeyHash: `ORG#${orgId}`, orgId, activeKeyCount: 5 })],
    countByOrgId: { [orgId]: 999 }, // would mismatch if we counted
  });

  const stats = await backfillKeyIdsAndCounters({
    keysTableName: "T",
    ddb: fake.ddb,
    apply: true,
  });
  assert.equal(stats.envelopesAlreadyUpToDate, 1);
  assert.equal(fake.queryCalls, 0, "Query is skipped when activeKeyCount already present");
  assert.equal(fake.updateCalls.length, 0, "no Update issued for already-counted envelope");
});

test("count query filters on active = :true (does NOT count revoked keys)", async () => {
  // Bug 1 regression: a previous version used `attribute_exists(active)`,
  // which is true for both `active: true` AND `active: false` rows. The
  // count would include revoked keys and inflate `activeKeyCount`,
  // causing phantom maxKeys-limit failures in /v1/account/keys/create.
  const orgId = "org_FilterTest";
  const fake = makeFakeDdb({
    scanItems: [makeEnvelopeItem({ apiKeyHash: `ORG#${orgId}`, orgId })],
    countByOrgId: { [orgId]: 0 },
  });
  await backfillKeyIdsAndCounters({ keysTableName: "T", ddb: fake.ddb, apply: true });
  assert.equal(fake.queryInputs.length, 1);
  const { filter, values } = fake.queryInputs[0]!;
  assert.match(filter, /active = :true/, "filter must compare active to a value, not just exist");
  assert.equal(values?.[":true"], true, "filter must bind :true to boolean true");
  assert.match(filter, /attribute_exists\(keyPrefix\)/, "sentinel keyPrefix check still required");
});

test("envelope update guards against deleted-row upsert", async () => {
  // Bug 2 regression: DynamoDB UpdateItem creates the item if it doesn't
  // exist and the condition passes. Without `attribute_exists(apiKeyHash)`,
  // a row deleted between Scan and Update would pass
  // `attribute_not_exists(activeKeyCount)` (vacuously true on a missing
  // item) and DDB would CREATE a partial row { apiKeyHash, activeKeyCount }.
  const orgId = "org_EnvGuard";
  const fake = makeFakeDdb({
    scanItems: [makeEnvelopeItem({ apiKeyHash: `ORG#${orgId}`, orgId })],
    countByOrgId: { [orgId]: 1 },
  });
  await backfillKeyIdsAndCounters({ keysTableName: "T", ddb: fake.ddb, apply: true });
  const envelopeUpdate = fake.updateCalls.find((c) => /SET activeKeyCount/.test(c.update));
  assert.ok(envelopeUpdate);
  assert.match(envelopeUpdate.condition, /attribute_exists\(apiKeyHash\)/);
  assert.match(envelopeUpdate.condition, /attribute_not_exists\(activeKeyCount\)/);
});

test("key update guards against deleted-row upsert and partial-row drift", async () => {
  // Bug 2 regression: same upsert risk for the keyId backfill. Plus
  // `attribute_exists(orgId)` and `attribute_exists(keyPrefix)` give
  // defense-in-depth against ever writing keyId into a row that doesn't
  // structurally look like a real key record.
  const orgId = "org_KeyGuard";
  const fake = makeFakeDdb({
    scanItems: [makeKeyItem({ apiKeyHash: "hash_guard", orgId })],
    countByOrgId: { [orgId]: 0 },
  });
  await backfillKeyIdsAndCounters({ keysTableName: "T", ddb: fake.ddb, apply: true });
  const keyUpdate = fake.updateCalls.find((c) => /SET keyId/.test(c.update));
  assert.ok(keyUpdate);
  assert.match(keyUpdate.condition, /attribute_exists\(apiKeyHash\)/);
  assert.match(keyUpdate.condition, /attribute_exists\(orgId\)/);
  assert.match(keyUpdate.condition, /attribute_exists\(keyPrefix\)/);
  assert.match(keyUpdate.condition, /attribute_not_exists\(keyId\)/);
});

test("default key id generator emits key_<crockford-base32-ulid> with 26 chars after the prefix", async () => {
  const orgId = "org_DefaultGen";
  const fake = makeFakeDdb({
    scanItems: [makeKeyItem({ apiKeyHash: "hash_default", orgId })],
    countByOrgId: { [orgId]: 0 },
  });
  await backfillKeyIdsAndCounters({
    keysTableName: "T",
    ddb: fake.ddb,
    apply: true,
    // no generateKeyId injection — exercises the production default
  });
  const keyIdUpdate = fake.updateCalls.find((c) => /SET keyId = :id/.test(c.update));
  assert.ok(keyIdUpdate, "key id update must be issued");
  const keyId = keyIdUpdate.values?.[":id"];
  assert.equal(typeof keyId, "string");
  // Crockford base32 excludes I, L, O, U.
  assert.match(keyId as string, /^key_[0-9A-HJKMNP-TV-Z]{26}$/);
});

test("uses apiKeyHash suffix as orgId fallback when envelope orgId attribute is missing", async () => {
  const orgId = "org_TestH";
  const envelope = makeEnvelopeItem({ apiKeyHash: `ORG#${orgId}`, orgId });
  delete envelope.orgId;
  const fake = makeFakeDdb({
    scanItems: [envelope],
    countByOrgId: { [orgId]: 0 },
  });

  const stats = await backfillKeyIdsAndCounters({
    keysTableName: "T",
    ddb: fake.ddb,
    apply: true,
  });
  assert.equal(stats.envelopesUpdated, 1);
  assert.equal(fake.queryCalls, 1);
});

