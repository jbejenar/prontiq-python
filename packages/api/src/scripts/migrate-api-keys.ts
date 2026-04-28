#!/usr/bin/env node
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  type PutCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { PLANS, type ApiKeyRecord, type RedirectRecord, type Tier, type UsageCounterRecord } from "@prontiq/shared";
import { hashKey } from "@prontiq/shared";
import { monotonicFactory } from "ulid";

const ulid = monotonicFactory();

type LegacyUsageByMonth = Record<string, number>;
type LegacyUsageByProduct = Record<string, LegacyUsageByMonth>;

export interface LegacyApiKeyRecord {
  apiKey: string;
  active?: boolean;
  createdAt?: string;
  monthlyQuotaPerProduct?: number;
  orgId?: string;
  ownerEmail?: string;
  products?: string[];
  tier?: Tier;
  usage?: LegacyUsageByProduct;
}

export interface MigrationPlan {
  keyRecord: ApiKeyRecord;
  redirectRecord?: RedirectRecord;
  usageRecords: UsageCounterRecord[];
}

export interface MigrationStats {
  conflicted: number;
  conflictKeys: string[];
  migrated: number;
  scanned: number;
  skipped: number;
}

type MigrationOutcome =
  | { status: "migrated" | "skipped" }
  | { status: "conflicted"; conflictKeys: string[] };

const LEGACY_TABLE_NAME = process.env.LEGACY_API_KEY_TABLE_NAME ?? "ApiKeyTable";
const KEYS_TABLE_NAME = process.env.KEYS_TABLE_NAME ?? "prontiq-keys";
const USAGE_TABLE_NAME = process.env.USAGE_TABLE_NAME ?? "prontiq-usage";
const DEFAULT_ORG_ID = "internal";
const DEFAULT_OWNER_EMAIL = "engineering@prontiq.dev";
const LEGACY_FREE_PRODUCTS = ["address", "abn"];
const USAGE_TTL_SECONDS = 90 * 24 * 60 * 60;
const SEED_KEY_PREFIX = "pq_live_prod_";

function nowIso(): string {
  return new Date().toISOString();
}

function getTtlFromMonth(monthKey: string): number {
  const parsed = new Date(`${monthKey}-01T00:00:00.000Z`);
  const expiry = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 4, 1));
  return Math.floor(expiry.getTime() / 1000) + USAGE_TTL_SECONDS;
}

function deriveKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 12);
}

function normalizeTier(tier: Tier | undefined): Tier {
  return tier ?? "free";
}

function uniqueProducts(products: string[]): string[] {
  return [...new Set(products)];
}

function deriveMigratedProducts(legacyRecord: LegacyApiKeyRecord, tier: Tier): string[] {
  const explicitProducts = uniqueProducts(legacyRecord.products ?? []);
  const usageProducts = uniqueProducts(Object.keys(legacyRecord.usage ?? {}));

  if (explicitProducts.length > 0) {
    return uniqueProducts([...explicitProducts, ...usageProducts]);
  }

  if (tier === "free") {
    return uniqueProducts([...LEGACY_FREE_PRODUCTS, ...usageProducts]);
  }

  return uniqueProducts([...PLANS[tier].products, ...usageProducts]);
}

function deriveMigratedQuota(legacyRecord: LegacyApiKeyRecord, tier: Tier): number | null {
  return legacyRecord.monthlyQuotaPerProduct ?? PLANS[tier].quotaPerProduct;
}

function normalizeRecordForCompare<T>(record: T): T {
  if (Array.isArray(record)) {
    return record.map((value) => normalizeRecordForCompare(value)).sort() as T;
  }

  if (record && typeof record === "object") {
    const normalizedEntries = Object.entries(record)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalizeRecordForCompare(value)]);
    return Object.fromEntries(normalizedEntries) as T;
  }

  return record;
}

export function recordsSemanticallyMatch<T>(planned: T, existing: T): boolean {
  return isDeepStrictEqual(
    normalizeRecordForCompare(planned),
    normalizeRecordForCompare(existing),
  );
}

export function buildMigrationPlan(
  legacyRecord: LegacyApiKeyRecord,
  migratedAt: string = nowIso(),
  /**
   * If the migration has already run for this legacy key, pass the
   * existing row's `keyId` here so the plan reuses the prior identity.
   * Otherwise a rerun generates a fresh ULID and `recordsSemanticallyMatch`
   * sees the keyId differ — classifying an idempotent skip as a conflict.
   * `keyId` is identity, not state; once assigned, it is preserved.
   */
  existingKeyId?: string,
): MigrationPlan {
  const tier = normalizeTier(legacyRecord.tier);
  const plan = PLANS[tier];
  const apiKeyHash = hashKey(legacyRecord.apiKey);
  const products = deriveMigratedProducts(legacyRecord, tier);
  const usageRecords: UsageCounterRecord[] = [];

  for (const [product, monthlyUsage] of Object.entries(legacyRecord.usage ?? {})) {
    for (const [monthKey, requestCount] of Object.entries(monthlyUsage)) {
      usageRecords.push({
        apiKeyHash,
        scope: `${product}#${monthKey}`,
        requestCount,
        ttl: getTtlFromMonth(monthKey),
        lastPushedCumulativeCount: requestCount,
      });
    }
  }

  return {
    keyRecord: {
      apiKeyHash,
      keyId: existingKeyId ?? `key_${ulid()}`,
      keyPrefix: deriveKeyPrefix(legacyRecord.apiKey),
      ownerEmail: legacyRecord.ownerEmail ?? DEFAULT_OWNER_EMAIL,
      orgId: legacyRecord.orgId ?? DEFAULT_ORG_ID,
      tier,
      products,
      quotaPerProduct: deriveMigratedQuota(legacyRecord, tier),
      rateLimit: plan.rateLimit,
      active: legacyRecord.active ?? true,
      paymentOverdue: false,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      subscriptionItems: {},
      createdAt: legacyRecord.createdAt ?? migratedAt,
      lastUsedAt: null,
    },
    usageRecords,
  };
}

function createPutIfMissing(
  TableName: string,
  Item: object,
  keyAttributes: string[],
): PutCommandInput {
  const expressionAttributeNames = Object.fromEntries(
    keyAttributes.map((attribute, index) => [`#key${index}`, attribute]),
  );
  const conditionExpression = keyAttributes
    .map((_, index) => `attribute_not_exists(#key${index})`)
    .join(" AND ");

  return {
    TableName,
    Item,
    ConditionExpression: conditionExpression,
    ExpressionAttributeNames: expressionAttributeNames,
  };
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "ConditionalCheckFailedException"
  );
}

async function putIfMissing(
  client: DynamoDBDocumentClient,
  commandInput: PutCommandInput,
  key: Record<string, unknown>,
): Promise<"migrated" | "skipped" | "conflicted"> {
  try {
    await client.send(new PutCommand(commandInput));
    return "migrated";
  } catch (error) {
    if (isConditionalCheckFailure(error)) {
      const existing = await client.send(
        new GetCommand({
          TableName: commandInput.TableName,
          Key: key,
        }),
      );

      if (existing.Item && recordsSemanticallyMatch(commandInput.Item, existing.Item)) {
        return "skipped";
      }

      return "conflicted";
    }
    throw error;
  }
}

async function migrateRecord(
  client: DynamoDBDocumentClient,
  legacyRecord: LegacyApiKeyRecord,
): Promise<MigrationOutcome> {
  // Look up the existing row (if any) FIRST so a rerun reuses every
  // migration-time-generated field. Two such fields exist in the key
  // record:
  //   - `keyId`    — generated as a fresh ULID on first run.
  //   - `createdAt` when `legacyRecord.createdAt` is absent — defaults
  //     to `nowIso()` on first run.
  // Both must be preserved across reruns; otherwise
  // `recordsSemanticallyMatch` sees them differ and an otherwise-
  // identical row is mis-classified as a conflict. (The first fix
  // covered `keyId` only — the bot review in PR #172 caught the
  // remaining `createdAt` path.)
  const apiKeyHash = hashKey(legacyRecord.apiKey);
  const existing = await client.send(
    new GetCommand({ TableName: KEYS_TABLE_NAME, Key: { apiKeyHash } }),
  );
  const existingItem = existing.Item as
    | { keyId?: string; createdAt?: string }
    | undefined;
  const existingKeyId = existingItem?.keyId;
  const existingCreatedAt = existingItem?.createdAt;
  // Resolved migratedAt precedence:
  //   1. legacyRecord.createdAt (if the legacy row carries its own time)
  //   2. existingCreatedAt      (preserve prior assignment on rerun)
  //   3. nowIso()                (genuine first run for a record that
  //                                lacks its own createdAt)
  const resolvedMigratedAt =
    legacyRecord.createdAt ?? existingCreatedAt ?? nowIso();
  const migrationPlan = buildMigrationPlan(
    legacyRecord,
    resolvedMigratedAt,
    existingKeyId,
  );
  let wroteAnyRecord = false;
  const conflictKeys: string[] = [];

  const keyWrite = await putIfMissing(
    client,
    createPutIfMissing(KEYS_TABLE_NAME, migrationPlan.keyRecord, ["apiKeyHash"]),
    { apiKeyHash: migrationPlan.keyRecord.apiKeyHash },
  );
  if (keyWrite === "conflicted") {
    conflictKeys.push(`key:${migrationPlan.keyRecord.apiKeyHash}`);
  }
  wroteAnyRecord ||= keyWrite === "migrated";

  for (const usageRecord of migrationPlan.usageRecords) {
    const usageWrite = await putIfMissing(
      client,
      createPutIfMissing(USAGE_TABLE_NAME, usageRecord, ["apiKeyHash", "scope"]),
      { apiKeyHash: usageRecord.apiKeyHash, scope: usageRecord.scope },
    );
    if (usageWrite === "conflicted") {
      conflictKeys.push(`usage:${usageRecord.apiKeyHash}#${usageRecord.scope}`);
    }
    wroteAnyRecord ||= usageWrite === "migrated";
  }

  if (conflictKeys.length > 0) {
    return { status: "conflicted", conflictKeys };
  }

  return { status: wroteAnyRecord ? "migrated" : "skipped" };
}

export async function migrateAllApiKeys(
  client: DynamoDBDocumentClient,
): Promise<MigrationStats> {
  const stats: MigrationStats = {
    conflicted: 0,
    conflictKeys: [],
    migrated: 0,
    scanned: 0,
    skipped: 0,
  };

  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const response = await client.send(
      new ScanCommand({
        TableName: LEGACY_TABLE_NAME,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of (response.Items as LegacyApiKeyRecord[] | undefined) ?? []) {
      stats.scanned += 1;

      if (!item.apiKey) {
        stats.skipped += 1;
        continue;
      }

      const result = await migrateRecord(client, item);
      if (result.status === "migrated") stats.migrated += 1;
      if (result.status === "skipped") stats.skipped += 1;
      if (result.status === "conflicted") {
        stats.conflicted += 1;
        stats.conflictKeys.push(...result.conflictKeys);
      }
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return stats;
}

async function main(): Promise<void> {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const stats = await migrateAllApiKeys(client);

  console.log(
    JSON.stringify(
      {
        ...stats,
        keysTable: KEYS_TABLE_NAME,
        legacyTable: LEGACY_TABLE_NAME,
        note:
          "Legacy ApiKeyTable remains untouched for rollback soak. Replace the legacy seed key manually before deleting redirect/legacy state.",
        usageTable: USAGE_TABLE_NAME,
        warning:
          "If the internal seed key starts with pq_live_prod_, generate and distribute its replacement manually before revoking the old key.",
      },
      null,
      2,
    ),
  );

  if (stats.conflicted > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}

export function isLegacySeedKey(rawKey: string): boolean {
  return rawKey.startsWith(SEED_KEY_PREFIX);
}
