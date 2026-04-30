import type { DynamoDBDocumentClient, QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import { BatchGetCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  BILLING_ENDPOINTS,
  PRODUCT_REGISTRY,
  getMonthKey,
  parseUsageScope,
  resolveEffectiveCommercialProjection,
  type ApiKeyRecord,
  type CounterPeriodSource,
  type EnforcementMode,
  type OrgEnvelopeRecord,
  type UsageCounterRecord,
  type UsageDailyRecord,
} from "@prontiq/shared";
import { getOrgEnvelopeKey } from "./key-management.js";

const ORG_ID_INDEX = "orgId-index";
const BATCH_GET_LIMIT = 100;
const BATCH_GET_MAX_ATTEMPTS = 4;

export type UsageGranularity = "daily" | "weekly" | "monthly";
export type UsageSeriesPointKind = "baseline" | "projected" | "total";

export interface UsageSeriesPoint {
  bucket: string;
  label: string;
  credits: number;
  kind: UsageSeriesPointKind;
  sortKey: string;
}

export interface AccountUsageProduct {
  product: string;
  displayName: string;
  includedInCurrentPlan: boolean;
  usedCredits: number;
  quotaCredits: number | null;
  remainingCredits: number | null;
  overageCredits: number | null;
  enforcementMode: EnforcementMode;
  rateLimitPerSecond: number | null;
  series: UsageSeriesPoint[];
}

export interface AccountUsageResponse {
  generatedAt: string;
  granularity: UsageGranularity;
  period: {
    key: string;
    startedAt: string | null;
    endingAt: string | null;
    source: CounterPeriodSource;
    entitlementsSyncedAt: string | null;
    scopeConsistency: "single_period" | "mixed_key_periods";
  };
  products: AccountUsageProduct[];
}

export interface AccountUsageService {
  getUsage(input: { granularity: UsageGranularity; now?: Date; orgId: string }): Promise<
    | { status: "ok"; usage: AccountUsageResponse }
    | { status: "org_not_provisioned" }
  >;
}

export interface AccountUsageDependencies {
  ddb: DynamoDBDocumentClient;
  keysTableName: string;
  usageTableName: string;
  usageDailyTableName: string;
  counterPeriodSource?: () => CounterPeriodSource;
}

function resolveCounterPeriodSource(): CounterPeriodSource {
  return process.env.COUNTER_PERIOD_SOURCE === "lago" ? "lago" : "calendar";
}

function fallbackPeriod(now: Date): {
  endingAt: string;
  key: string;
  startedAt: string;
} {
  const key = getMonthKey(now);
  const [yearRaw, monthRaw] = key.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { key, startedAt: start.toISOString(), endingAt: end.toISOString() };
}

function resolvePeriod(
  envelope: OrgEnvelopeRecord,
  now: Date,
  counterPeriodSource: CounterPeriodSource,
) {
  if (
    counterPeriodSource === "lago" &&
    envelope.billingPeriodKey &&
    envelope.billingPeriodStartedAt &&
    envelope.billingPeriodEndingAt
  ) {
    return {
      key: envelope.billingPeriodKey,
      startedAt: envelope.billingPeriodStartedAt,
      endingAt: envelope.billingPeriodEndingAt,
      source: "lago" as const,
    };
  }
  return { ...fallbackPeriod(now), source: "calendar" as const };
}

function buildCurrentPeriodUsageScope(input: {
  counterPeriodSource: CounterPeriodSource;
  periodKey: string;
  product: string;
}): string {
  return input.counterPeriodSource === "lago"
    ? `${input.product}#period#${input.periodKey}`
    : `${input.product}#${input.periodKey}`;
}

function productDisplayName(product: string): string {
  const endpoint = Object.values(BILLING_ENDPOINTS).find((item) => item.product === product);
  return endpoint?.familyDisplayName ?? PRODUCT_REGISTRY[product]?.description ?? product;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`));
}

function addDays(value: Date, days: number): Date {
  const out = new Date(value);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function currentPeriodBucket(input: {
  periodEndingAt: string | null;
  periodStartedAt: string | null;
}): string {
  return input.periodStartedAt && input.periodEndingAt
    ? `${input.periodStartedAt.slice(0, 10)}_${input.periodEndingAt.slice(0, 10)}`
    : "current_period";
}

function currentPeriodSortKey(periodStartedAt: string | null): string {
  return periodStartedAt ? `${periodStartedAt.slice(0, 10)}#0000` : "0000-00-00#0000";
}

function aggregatePoint(input: {
  credits: number;
  kind: "baseline" | "total";
  periodEndingAt: string | null;
  periodStartedAt: string | null;
}): UsageSeriesPoint {
  const bucket = currentPeriodBucket(input);
  return {
    bucket: input.kind === "baseline" ? `baseline#${bucket}` : bucket,
    label: input.kind === "baseline" ? "Before chart tracking" : "Current period",
    credits: input.credits,
    kind: input.kind,
    sortKey: currentPeriodSortKey(input.periodStartedAt),
  };
}

function groupSeries(input: {
  dailyRows: UsageDailyRecord[];
  granularity: UsageGranularity;
  periodEndingAt: string | null;
  periodStartedAt: string | null;
  product: string;
  usedCredits: number;
}): UsageSeriesPoint[] {
  const rows = input.dailyRows
    .filter((row) => row.product === input.product)
    .sort((a, b) => a.bucketDate.localeCompare(b.bucketDate));
  const projectedCredits = rows.reduce((sum, row) => sum + row.credits, 0);
  if (input.usedCredits === 0) return [];
  if (input.granularity === "monthly" || projectedCredits > input.usedCredits) {
    return [aggregatePoint({
      credits: input.usedCredits,
      kind: "total",
      periodEndingAt: input.periodEndingAt,
      periodStartedAt: input.periodStartedAt,
    })];
  }
  const baselineCredits = input.usedCredits - projectedCredits;
  const baseline = baselineCredits > 0
    ? [aggregatePoint({
      credits: baselineCredits,
      kind: "baseline",
      periodEndingAt: input.periodEndingAt,
      periodStartedAt: input.periodStartedAt,
    })]
    : [];
  if (input.granularity === "daily") {
    return [
      ...baseline,
      ...rows.map((row) => ({
        bucket: row.bucketDate,
        label: dateLabel(row.bucketDate),
        credits: row.credits,
        kind: "projected" as const,
        sortKey: `${row.bucketDate}#1000`,
      })),
    ];
  }

  const start = input.periodStartedAt ? new Date(input.periodStartedAt) : null;
  if (!start || Number.isNaN(start.getTime())) {
    return [aggregatePoint({
      credits: input.usedCredits,
      kind: "total",
      periodEndingAt: input.periodEndingAt,
      periodStartedAt: input.periodStartedAt,
    })];
  }
  const buckets = new Map<string, number>();
  for (const row of rows) {
    const day = new Date(`${row.bucketDate}T00:00:00.000Z`);
    const offsetDays = Math.max(0, Math.floor((day.getTime() - start.getTime()) / 86_400_000));
    const weekStart = addDays(start, Math.floor(offsetDays / 7) * 7).toISOString().slice(0, 10);
    buckets.set(weekStart, (buckets.get(weekStart) ?? 0) + row.credits);
  }
  return [
    ...baseline,
    ...[...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, credits]) => ({
        bucket,
        label: `Week of ${dateLabel(bucket)}`,
        credits,
        kind: "projected" as const,
        sortKey: `${bucket}#1000`,
      })),
  ];
}

async function loadEnvelope(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  orgId: string,
): Promise<OrgEnvelopeRecord | undefined> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { apiKeyHash: getOrgEnvelopeKey(orgId) } }),
  );
  return result.Item as OrgEnvelopeRecord | undefined;
}

async function loadOrgKeys(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  orgId: string,
): Promise<ApiKeyRecord[]> {
  const keys: ApiKeyRecord[] = [];
  let ExclusiveStartKey: QueryCommandInput["ExclusiveStartKey"] | undefined;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: ORG_ID_INDEX,
        KeyConditionExpression: "orgId = :orgId",
        FilterExpression: "attribute_exists(keyPrefix)",
        ExpressionAttributeValues: { ":orgId": orgId },
        ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
      }),
    );
    keys.push(...(((result.Items as ApiKeyRecord[] | undefined) ?? [])));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return keys;
}

async function batchGetUsageRows(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  keys: Array<{ apiKeyHash: string; scope: string }>,
): Promise<UsageCounterRecord[]> {
  const rows: UsageCounterRecord[] = [];
  for (let i = 0; i < keys.length; i += BATCH_GET_LIMIT) {
    let pending = keys.slice(i, i + BATCH_GET_LIMIT);
    for (let attempt = 1; pending.length > 0; attempt += 1) {
      const result = await ddb.send(
        new BatchGetCommand({
          RequestItems: {
            [tableName]: {
              Keys: pending,
            },
          },
        }),
      );
      rows.push(...(((result.Responses?.[tableName] as UsageCounterRecord[] | undefined) ?? [])));
      pending = (result.UnprocessedKeys?.[tableName]?.Keys as typeof pending | undefined) ?? [];
      if (pending.length > 0 && attempt >= BATCH_GET_MAX_ATTEMPTS) {
        throw new Error(`usage counter BatchGet left ${pending.length} unprocessed key(s)`);
      }
    }
  }
  return rows;
}

async function loadDailyRows(input: {
  ddb: DynamoDBDocumentClient;
  orgId: string;
  periodKey: string;
  tableName: string;
}): Promise<UsageDailyRecord[]> {
  const rows: UsageDailyRecord[] = [];
  let ExclusiveStartKey: QueryCommandInput["ExclusiveStartKey"] | undefined;
  do {
    const result = await input.ddb.send(
      new QueryCommand({
        TableName: input.tableName,
        KeyConditionExpression: "orgId = :orgId AND begins_with(bucketKey, :prefix)",
        ExpressionAttributeValues: {
          ":orgId": input.orgId,
          ":prefix": `period#${input.periodKey}#day#`,
        },
        ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
      }),
    );
    rows.push(...(((result.Items as UsageDailyRecord[] | undefined) ?? [])));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

export function createAccountUsageService(
  deps: AccountUsageDependencies,
): AccountUsageService {
  const counterPeriodSource = deps.counterPeriodSource ?? resolveCounterPeriodSource;

  async function getUsage(input: {
    granularity: UsageGranularity;
    now?: Date;
    orgId: string;
  }): Promise<{ status: "ok"; usage: AccountUsageResponse } | { status: "org_not_provisioned" }> {
    const now = input.now ?? new Date();
    const envelope = await loadEnvelope(deps.ddb, deps.keysTableName, input.orgId);
    if (!envelope) return { status: "org_not_provisioned" };
    const resolvedCounterPeriodSource = counterPeriodSource();
    const period = resolvePeriod(envelope, now, resolvedCounterPeriodSource);
    const effective = resolveEffectiveCommercialProjection(envelope);
    const keys = await loadOrgKeys(deps.ddb, deps.keysTableName, input.orgId);

    const wantedUsageKeys = new Map<string, { product: string; scope: string }>();
    const keyPeriodKeys = new Set<string>([period.key]);
    let missingKeyPeriodProjection = false;
    for (const key of keys) {
      if (resolvedCounterPeriodSource === "lago" && period.source === "lago") {
        if (key.billingPeriodKey) {
          keyPeriodKeys.add(key.billingPeriodKey);
        } else {
          missingKeyPeriodProjection = true;
        }
      }
      const keyProducts = new Set([...effective.products, ...(key.products ?? [])]);
      for (const product of keyProducts) {
        const scope = buildCurrentPeriodUsageScope({
          counterPeriodSource: resolvedCounterPeriodSource,
          periodKey: period.key,
          product,
        });
        wantedUsageKeys.set(`${key.apiKeyHash}|${scope}`, { product, scope });
      }
    }

    const usageRows = await batchGetUsageRows(
      deps.ddb,
      deps.usageTableName,
      [...wantedUsageKeys.keys()].map((key) => {
        const [apiKeyHash = "", scope = ""] = key.split("|");
        return { apiKeyHash, scope };
      }),
    );
    const dailyRows = await loadDailyRows({
      ddb: deps.ddb,
      orgId: input.orgId,
      periodKey: period.key,
      tableName: deps.usageDailyTableName,
    });

    const totals = new Map<string, number>();
    const scopePeriods = new Set<string>();
    for (const row of usageRows) {
      const parsed = parseUsageScope(row.scope);
      if (!parsed) continue;
      scopePeriods.add(parsed.periodKey);
      totals.set(parsed.product, (totals.get(parsed.product) ?? 0) + row.requestCount);
    }

    const products = new Set<string>(effective.products);
    for (const row of usageRows) {
      const parsed = parseUsageScope(row.scope);
      if (parsed) products.add(parsed.product);
    }
    for (const row of dailyRows) products.add(row.product);

    const responseProducts: AccountUsageProduct[] = [...products].sort().map((product) => {
      const usedCredits = totals.get(product) ?? 0;
      const quotaCredits = effective.quotaPerProduct;
      const remainingCredits = quotaCredits == null ? null : Math.max(0, quotaCredits - usedCredits);
      const overageCredits =
        quotaCredits == null || effective.enforcementMode === "uncapped_tracked"
          ? null
          : Math.max(0, usedCredits - quotaCredits);
      return {
        product,
        displayName: productDisplayName(product),
        includedInCurrentPlan: effective.products.includes(product),
        usedCredits,
        quotaCredits,
        remainingCredits,
        overageCredits,
        enforcementMode: effective.enforcementMode,
        rateLimitPerSecond: effective.rateLimit,
        series: groupSeries({
          dailyRows,
          granularity: input.granularity,
          periodEndingAt: period.endingAt,
          periodStartedAt: period.startedAt,
          product,
          usedCredits,
        }),
      };
    });

    return {
      status: "ok",
      usage: {
        generatedAt: now.toISOString(),
        granularity: input.granularity,
        period: {
          key: period.key,
          startedAt: period.startedAt,
          endingAt: period.endingAt,
          source: period.source,
          entitlementsSyncedAt: envelope.lagoLastSyncedAt ?? null,
          scopeConsistency:
            !missingKeyPeriodProjection &&
            keyPeriodKeys.size === 1 &&
            (scopePeriods.size === 0 || (scopePeriods.size === 1 && scopePeriods.has(period.key)))
              ? "single_period"
              : "mixed_key_periods",
        },
        products: responseProducts,
      },
    };
  }

  return { getUsage };
}
