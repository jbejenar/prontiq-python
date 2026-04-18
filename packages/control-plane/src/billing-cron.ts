import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  type ApiKeyRecord,
  type RedirectRecord,
  type UsageCounterRecord,
  getMeterEventNameForProduct,
} from "@prontiq/shared";
import Stripe from "stripe";

type Logger = Pick<Console, "error" | "warn" | "info">;

export interface BillingCronDependencies {
  ddb: DynamoDBDocumentClient;
  keysTableName: string;
  logger: Logger;
  stripe: Stripe;
  usageTableName: string;
}

export interface BillingCronSummary {
  keysProcessed: number;
  meterEventsSent: number;
  negativeDeltas: number;
  scopesSkipped: number;
}

interface MeterPushPlan {
  delta: number;
  identifier: string;
  targetCumulativeCount: number;
}

const ACTIVE_HASHES_ATTRIBUTE = "activeHashes";
const CURRENT_HASH_SCOPE_TTL_SECONDS = 90 * 24 * 60 * 60;
const MAX_CHAIN_DEPTH = 10;
const NEW_HASH_REDIRECT_INDEX = "newHash-redirect-index";
const REDIRECT_SCOPE = "REDIRECT";
const ACTIVE_REGISTRY_KEY = "REGISTRY#active-keys";
const RETIRED_REGISTRY_KEY = "REGISTRY#retired-billing-keys";

let cachedDdb: DynamoDBDocumentClient | undefined;
let cachedStripe: Stripe | undefined;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getDefaultDdb(): DynamoDBDocumentClient {
  if (!cachedDdb) {
    cachedDdb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return cachedDdb;
}

function getDefaultStripe(): Stripe {
  if (!cachedStripe) {
    cachedStripe = new Stripe(getRequiredEnv("STRIPE_SECRET_KEY"), { maxNetworkRetries: 3 });
  }
  return cachedStripe;
}

function isConditionalCheckFailure(error: unknown): boolean {
  return error instanceof ConditionalCheckFailedException ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "ConditionalCheckFailedException");
}

function getMonthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

function getPreviousMonthKey(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}

function getBillingMonthKeys(now: Date): string[] {
  const current = getMonthKey(now);
  if (now.getUTCDate() === 1 && now.getUTCHours() < 6) {
    return [current, getPreviousMonthKey(now)];
  }
  return [current];
}

function getRetirementBlockingMonthKeys(now: Date): string[] {
  return [getMonthKey(now), getPreviousMonthKey(now)];
}

function getScope(product: string, monthKey: string): string {
  return `${product}#${monthKey}`;
}

function getMeterEventIdentifier(apiKeyHash: string, scope: string, targetCumulativeCount: number): string {
  return `meter-${apiKeyHash}-${scope.replace("#", "-")}-${targetCumulativeCount}`;
}

function getUsageTtl(now: Date): number {
  return Math.floor(now.getTime() / 1000) + CURRENT_HASH_SCOPE_TTL_SECONDS;
}

function parseActiveHashes(value: unknown): string[] {
  if (value instanceof Set) {
    return Array.from(value).filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  return [];
}

async function loadRegistryApiKeyHashes(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  registryKey: string,
): Promise<string[]> {
  const response = await ddb.send(
    new GetCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: registryKey },
    }),
  );
  return parseActiveHashes(response.Item?.[ACTIVE_HASHES_ATTRIBUTE]);
}

async function updateRegistryMembership(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  registryKey: string,
  apiKeyHashes: string[],
  mode: "add" | "delete",
): Promise<void> {
  if (apiKeyHashes.length === 0) {
    return;
  }
  await ddb.send(
    new UpdateCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: registryKey },
      UpdateExpression: mode === "add" ? "ADD #activeHashes :hashes" : "DELETE #activeHashes :hashes",
      ExpressionAttributeNames: {
        "#activeHashes": ACTIVE_HASHES_ATTRIBUTE,
      },
      ExpressionAttributeValues: {
        ":hashes": new Set(apiKeyHashes),
      },
    }),
  );
}

async function loadKey(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  apiKeyHash: string,
): Promise<ApiKeyRecord | undefined> {
  const response = await ddb.send(
    new GetCommand({
      TableName: keysTableName,
      Key: { apiKeyHash },
    }),
  );
  return response.Item as ApiKeyRecord | undefined;
}

async function loadUsageRow(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  apiKeyHash: string,
  scope: string,
): Promise<UsageCounterRecord | undefined> {
  const response = await ddb.send(
    new GetCommand({
      TableName: usageTableName,
      Key: { apiKeyHash, scope },
    }),
  );
  return response.Item as UsageCounterRecord | undefined;
}

async function loadUsageRowsForHash(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  apiKeyHash: string,
): Promise<UsageCounterRecord[]> {
  const response = await ddb.send(
    new QueryCommand({
      TableName: usageTableName,
      KeyConditionExpression: "apiKeyHash = :apiKeyHash",
      ExpressionAttributeValues: {
        ":apiKeyHash": apiKeyHash,
      },
    }),
  );
  return (response.Items as UsageCounterRecord[] | undefined) ?? [];
}

async function discoverAttributionChain(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  currentHash: string,
): Promise<string[]> {
  const chain = [currentHash];
  let frontier = [currentHash];
  while (frontier.length > 0 && chain.length < MAX_CHAIN_DEPTH) {
    const nextFrontier: string[] = [];
    for (const hash of frontier) {
      const response = await ddb.send(
        new QueryCommand({
          TableName: usageTableName,
          IndexName: NEW_HASH_REDIRECT_INDEX,
          KeyConditionExpression: "newHash = :newHash",
          ExpressionAttributeValues: {
            ":newHash": hash,
          },
        }),
      );
      const redirects = (response.Items as RedirectRecord[] | undefined) ?? [];
      for (const redirect of redirects) {
        if (redirect.scope !== REDIRECT_SCOPE) continue;
        if (chain.includes(redirect.apiKeyHash)) continue;
        chain.push(redirect.apiKeyHash);
        nextFrontier.push(redirect.apiKeyHash);
        if (chain.length >= MAX_CHAIN_DEPTH) {
          break;
        }
      }
      if (chain.length >= MAX_CHAIN_DEPTH) {
        break;
      }
    }
    frontier = nextFrontier;
  }
  return chain;
}

async function sumRequestCountForScope(
  usageRowsByHash: Map<string, Map<string, UsageCounterRecord>>,
  chain: string[],
  scope: string,
): Promise<number> {
  let sum = 0;
  for (const apiKeyHash of chain) {
    const usage = usageRowsByHash.get(apiKeyHash)?.get(scope);
    if (usage?.closed && apiKeyHash !== chain[0]) {
      // Closed predecessor rows still contribute to billing attribution.
    }
    if (typeof usage?.requestCount === "number") {
      sum += usage.requestCount;
    }
  }
  return sum;
}

function parseProductScope(scope: string): { monthKey: string; product: string } | null {
  if (scope === REDIRECT_SCOPE) {
    return null;
  }
  const separatorIndex = scope.lastIndexOf("#");
  if (separatorIndex <= 0 || separatorIndex === scope.length - 1) {
    return null;
  }
  return {
    monthKey: scope.slice(separatorIndex + 1),
    product: scope.slice(0, separatorIndex),
  };
}

function buildUsageScopeIndex(rows: UsageCounterRecord[]): Map<string, UsageCounterRecord> {
  return new Map(rows.map((row) => [row.scope, row]));
}

function discoverProductsForMonth(
  currentProducts: string[],
  usageRowsByHash: Map<string, Map<string, UsageCounterRecord>>,
  chain: string[],
  monthKey: string,
): string[] {
  const discovered = new Set(currentProducts);
  for (const apiKeyHash of chain) {
    const rows = usageRowsByHash.get(apiKeyHash);
    if (!rows) {
      continue;
    }
    for (const usage of rows.values()) {
      const parsedScope = parseProductScope(usage.scope);
      if (!parsedScope || parsedScope.monthKey !== monthKey) {
        continue;
      }
      if (
        usage.requestCount > 0 ||
        (usage.lastPushedCumulativeCount ?? 0) > 0 ||
        typeof usage.pendingMeterTargetCumulativeCount === "number" ||
        typeof usage.pendingMeterEventIdentifier === "string"
      ) {
        discovered.add(parsedScope.product);
      }
    }
  }
  return Array.from(discovered).sort();
}

function hasOutstandingBillableUsage(
  currentHash: string,
  monthKeys: string[],
  usageRowsByHash: Map<string, Map<string, UsageCounterRecord>>,
  chain: string[],
): boolean {
  const currentUsageRows = usageRowsByHash.get(currentHash) ?? new Map<string, UsageCounterRecord>();

  const candidateProducts = new Set<string>();
  for (const monthKey of monthKeys) {
    for (const product of discoverProductsForMonth([], usageRowsByHash, chain, monthKey)) {
      candidateProducts.add(product);
    }
  }

  for (const product of candidateProducts) {
    if (!getMeterEventNameForProduct(product)) {
      continue;
    }
    for (const monthKey of monthKeys) {
      const scope = getScope(product, monthKey);
      const currentUsage = currentUsageRows.get(scope);
      if (
        typeof currentUsage?.pendingMeterTargetCumulativeCount === "number" ||
        typeof currentUsage?.pendingMeterEventIdentifier === "string"
      ) {
        return true;
      }
      const sumRequestCount = chain.reduce((sum, apiKeyHash) => {
        const usage = usageRowsByHash.get(apiKeyHash)?.get(scope);
        return sum + (usage?.requestCount ?? 0);
      }, 0);
      const currentLastPushed = currentUsage?.lastPushedCumulativeCount ?? 0;
      if (sumRequestCount > currentLastPushed) {
        return true;
      }
    }
  }

  return false;
}

async function clearPendingMeterPush(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  apiKeyHash: string,
  scope: string,
  identifier: string,
): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: usageTableName,
        Key: { apiKeyHash, scope },
        ConditionExpression: "#pendingId = :identifier",
        UpdateExpression: "REMOVE #pendingId, #pendingTarget",
        ExpressionAttributeNames: {
          "#pendingId": "pendingMeterEventIdentifier",
          "#pendingTarget": "pendingMeterTargetCumulativeCount",
        },
        ExpressionAttributeValues: {
          ":identifier": identifier,
        },
      }),
    );
  } catch (error) {
    if (isConditionalCheckFailure(error)) {
      return;
    }
    throw error;
  }
}

async function claimPendingMeterPush(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  apiKeyHash: string,
  scope: string,
  expectedLastPushed: number,
  identifier: string,
  targetCumulativeCount: number,
  now: Date,
): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: usageTableName,
        Key: { apiKeyHash, scope },
        ConditionExpression: [
          "((attribute_not_exists(#pendingId) AND attribute_not_exists(#pendingTarget))",
          "OR (#pendingId = :identifier AND #pendingTarget = :target))",
          "AND (attribute_not_exists(#lastPushed) OR #lastPushed = :expectedLastPushed)",
          "AND (attribute_not_exists(#closed) OR #closed = :false)",
        ].join(" "),
        UpdateExpression: [
          "SET #requestCount = if_not_exists(#requestCount, :zero)",
          "#ttl = if_not_exists(#ttl, :ttl)",
          "#lastPushed = if_not_exists(#lastPushed, :expectedLastPushed)",
          "#pendingId = :identifier",
          "#pendingTarget = :target",
        ].join(", "),
        ExpressionAttributeNames: {
          "#closed": "closed",
          "#lastPushed": "lastPushedCumulativeCount",
          "#pendingId": "pendingMeterEventIdentifier",
          "#pendingTarget": "pendingMeterTargetCumulativeCount",
          "#requestCount": "requestCount",
          "#ttl": "ttl",
        },
        ExpressionAttributeValues: {
          ":expectedLastPushed": expectedLastPushed,
          ":false": false,
          ":identifier": identifier,
          ":target": targetCumulativeCount,
          ":ttl": getUsageTtl(now),
          ":zero": 0,
        },
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalCheckFailure(error)) {
      return false;
    }
    throw error;
  }
}

async function finalizePendingMeterPush(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  apiKeyHash: string,
  scope: string,
  identifier: string,
  targetCumulativeCount: number,
): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: usageTableName,
        Key: { apiKeyHash, scope },
        ConditionExpression: [
          "#pendingId = :identifier",
          "AND #pendingTarget = :target",
          "AND (attribute_not_exists(#closed) OR #closed = :false)",
          "AND (attribute_not_exists(#lastPushed) OR #lastPushed <= :target)",
        ].join(" "),
        UpdateExpression: "SET #lastPushed = :target REMOVE #pendingId, #pendingTarget",
        ExpressionAttributeNames: {
          "#closed": "closed",
          "#lastPushed": "lastPushedCumulativeCount",
          "#pendingId": "pendingMeterEventIdentifier",
          "#pendingTarget": "pendingMeterTargetCumulativeCount",
        },
        ExpressionAttributeValues: {
          ":false": false,
          ":identifier": identifier,
          ":target": targetCumulativeCount,
        },
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalCheckFailure(error)) {
      return false;
    }
    throw error;
  }
}

async function buildMeterPushPlan(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  currentHash: string,
  scope: string,
  now: Date,
  sumRequestCount: number,
): Promise<MeterPushPlan | null> {
  const currentUsage = await loadUsageRow(ddb, usageTableName, currentHash, scope);
  if (currentUsage?.closed) {
    return null;
  }

  const currentLastPushed = currentUsage?.lastPushedCumulativeCount ?? 0;
  const pendingIdentifier = currentUsage?.pendingMeterEventIdentifier;
  const pendingTarget = currentUsage?.pendingMeterTargetCumulativeCount;

  if (pendingIdentifier && typeof pendingTarget === "number") {
    if (pendingTarget <= currentLastPushed) {
      await clearPendingMeterPush(ddb, usageTableName, currentHash, scope, pendingIdentifier);
      return null;
    }
    return {
      delta: pendingTarget - currentLastPushed,
      identifier: pendingIdentifier,
      targetCumulativeCount: pendingTarget,
    };
  }

  if (sumRequestCount <= currentLastPushed) {
    return null;
  }

  const identifier = getMeterEventIdentifier(currentHash, scope, sumRequestCount);
  const claimed = await claimPendingMeterPush(
    ddb,
    usageTableName,
    currentHash,
    scope,
    currentLastPushed,
    identifier,
    sumRequestCount,
    now,
  );
  if (!claimed) {
    const refreshedUsage = await loadUsageRow(ddb, usageTableName, currentHash, scope);
    if (
      refreshedUsage?.pendingMeterEventIdentifier === identifier &&
      refreshedUsage.pendingMeterTargetCumulativeCount === sumRequestCount
    ) {
      return {
        delta: sumRequestCount - (refreshedUsage.lastPushedCumulativeCount ?? 0),
        identifier,
        targetCumulativeCount: sumRequestCount,
      };
    }
    return null;
  }

  return {
    delta: sumRequestCount - currentLastPushed,
    identifier,
    targetCumulativeCount: sumRequestCount,
  };
}

export function createBillingCronService(
  overrides: Partial<BillingCronDependencies> = {},
): { handleTick: (now?: Date) => Promise<BillingCronSummary> } {
  const dependencies: BillingCronDependencies = {
    ddb: overrides.ddb ?? getDefaultDdb(),
    keysTableName: overrides.keysTableName ?? getRequiredEnv("KEYS_TABLE_NAME"),
    logger: overrides.logger ?? console,
    stripe: overrides.stripe ?? getDefaultStripe(),
    usageTableName: overrides.usageTableName ?? getRequiredEnv("USAGE_TABLE_NAME"),
  };

  async function handleTick(now = new Date()): Promise<BillingCronSummary> {
    const summary: BillingCronSummary = {
      keysProcessed: 0,
      meterEventsSent: 0,
      negativeDeltas: 0,
      scopesSkipped: 0,
    };

    const activeApiKeyHashes = await loadRegistryApiKeyHashes(
      dependencies.ddb,
      dependencies.keysTableName,
      ACTIVE_REGISTRY_KEY,
    );
    const retiredApiKeyHashes = await loadRegistryApiKeyHashes(
      dependencies.ddb,
      dependencies.keysTableName,
      RETIRED_REGISTRY_KEY,
    );
    const registryStatuses = new Map<string, "active" | "retired">();
    for (const hash of activeApiKeyHashes) {
      registryStatuses.set(hash, "active");
    }
    for (const hash of retiredApiKeyHashes) {
      if (!registryStatuses.has(hash)) {
        registryStatuses.set(hash, "retired");
      }
    }
    const monthKeys = getBillingMonthKeys(now);
    const retirementBlockingMonthKeys = getRetirementBlockingMonthKeys(now);

    for (const [apiKeyHash, registryStatus] of registryStatuses) {
      const key = await loadKey(dependencies.ddb, dependencies.keysTableName, apiKeyHash);
      if (!key || !key.stripeCustomerId || (registryStatus === "active" && !key.active)) {
        summary.scopesSkipped += 1;
        continue;
      }

      summary.keysProcessed += 1;
      const chain = await discoverAttributionChain(dependencies.ddb, dependencies.usageTableName, apiKeyHash);
      const usageRowsByHash = new Map<string, Map<string, UsageCounterRecord>>();
      for (const hash of chain) {
        const rows = await loadUsageRowsForHash(dependencies.ddb, dependencies.usageTableName, hash);
        usageRowsByHash.set(hash, buildUsageScopeIndex(rows));
      }

      for (const monthKey of monthKeys) {
        const productsToProcess = discoverProductsForMonth(key.products, usageRowsByHash, chain, monthKey);
        if (productsToProcess.length === 0) {
          summary.scopesSkipped += 1;
          continue;
        }

        for (const product of productsToProcess) {
          const meterEventName = getMeterEventNameForProduct(product);
          if (!meterEventName) {
            throw new Error(`No Stripe meter event mapping configured for product ${product}`);
          }
          const scope = getScope(product, monthKey);
          const sumRequestCount = await sumRequestCountForScope(usageRowsByHash, chain, scope);
          const currentUsage = usageRowsByHash.get(apiKeyHash)?.get(scope);
          const currentLastPushed = currentUsage?.lastPushedCumulativeCount ?? 0;
          if (sumRequestCount < currentLastPushed) {
            summary.negativeDeltas += 1;
            dependencies.logger.warn("Billing cron observed negative delta; skipping scope", {
              apiKeyHash,
              chain,
              currentLastPushed,
              monthKey,
              product,
              sumRequestCount,
            });
            continue;
          }

          const plan = await buildMeterPushPlan(
            dependencies.ddb,
            dependencies.usageTableName,
            apiKeyHash,
            scope,
            now,
            sumRequestCount,
          );
          if (!plan || plan.delta <= 0) {
            summary.scopesSkipped += 1;
            continue;
          }

          await dependencies.stripe.billing.meterEvents.create({
            event_name: meterEventName,
            identifier: plan.identifier,
            payload: {
              request_count: String(plan.delta),
              stripe_customer_id: key.stripeCustomerId,
            },
            timestamp: Math.floor(now.getTime() / 1000),
          });

          const finalized = await finalizePendingMeterPush(
            dependencies.ddb,
            dependencies.usageTableName,
            apiKeyHash,
            scope,
            plan.identifier,
            plan.targetCumulativeCount,
          );
          if (!finalized) {
            throw new Error(`Failed to finalize pending meter push for ${apiKeyHash} ${scope}`);
          }
          summary.meterEventsSent += 1;
        }
      }

      if (
        registryStatus === "retired" &&
        !hasOutstandingBillableUsage(apiKeyHash, retirementBlockingMonthKeys, usageRowsByHash, chain)
      ) {
        await updateRegistryMembership(
          dependencies.ddb,
          dependencies.keysTableName,
          RETIRED_REGISTRY_KEY,
          [apiKeyHash],
          "delete",
        );
      }
    }

    dependencies.logger.info("Billing cron completed", summary);
    return summary;
  }

  return { handleTick };
}

export async function handler(): Promise<BillingCronSummary> {
  return createBillingCronService().handleTick();
}
