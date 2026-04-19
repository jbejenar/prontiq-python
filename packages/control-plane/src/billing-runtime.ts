import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  type ApiKeyRecord,
  type RedirectRecord,
  type UsageCounterRecord,
  getMeterEventNameForProduct,
} from "@prontiq/shared";
import type Stripe from "stripe";

export type BillingLogger = Pick<Console, "error" | "warn" | "info">;

export interface RegistryMembershipState {
  active: boolean;
  retired: boolean;
}

export interface BillingScopeReconciliationResult {
  closedScopes: number;
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

export const ACTIVE_REGISTRY_KEY = "REGISTRY#active-keys";
export const RETIRED_REGISTRY_KEY = "REGISTRY#retired-billing-keys";

function isConditionalCheckFailure(error: unknown): boolean {
  return error instanceof ConditionalCheckFailedException ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "ConditionalCheckFailedException");
}

export function getMonthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function getPreviousMonthKey(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}

export function getBillingMonthKeys(now: Date): string[] {
  const current = getMonthKey(now);
  if (now.getUTCDate() === 1 && now.getUTCHours() < 6) {
    return [current, getPreviousMonthKey(now)];
  }
  return [current];
}

export function getRetirementBlockingMonthKeys(now: Date): string[] {
  return [getMonthKey(now), getPreviousMonthKey(now)];
}

export function getScope(product: string, monthKey: string): string {
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

export async function loadRegistryApiKeyHashes(
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

export async function updateRegistryMembership(
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

export async function loadKey(
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

export async function loadUsageRow(
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

export async function loadUsageRowsForHash(
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

export async function discoverAttributionChain(
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
      continue;
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

export function buildUsageScopeIndex(rows: UsageCounterRecord[]): Map<string, UsageCounterRecord> {
  return new Map(rows.map((row) => [row.scope, row]));
}

export function discoverProductsForMonth(
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

export function hasOutstandingBillableUsage(
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

async function closeUsageScope(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  apiKeyHash: string,
  scope: string,
  requiredLastPushed: number,
): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: usageTableName,
        Key: { apiKeyHash, scope },
        ConditionExpression: [
          "(attribute_not_exists(#closed) OR #closed = :false)",
          "AND attribute_exists(#lastPushed)",
          "AND #lastPushed >= :requiredLastPushed",
          "AND attribute_not_exists(#pendingId)",
          "AND attribute_not_exists(#pendingTarget)",
        ].join(" "),
        UpdateExpression: "SET #closed = :true",
        ExpressionAttributeNames: {
          "#closed": "closed",
          "#lastPushed": "lastPushedCumulativeCount",
          "#pendingId": "pendingMeterEventIdentifier",
          "#pendingTarget": "pendingMeterTargetCumulativeCount",
        },
        ExpressionAttributeValues: {
          ":false": false,
          ":requiredLastPushed": requiredLastPushed,
          ":true": true,
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

async function materializeCurrentUsageScope(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  apiKeyHash: string,
  scope: string,
  lastPushedCumulativeCount: number,
  now: Date,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: usageTableName,
      Key: { apiKeyHash, scope },
      ConditionExpression: [
        "attribute_not_exists(#pendingId)",
        "AND attribute_not_exists(#pendingTarget)",
        "AND (attribute_not_exists(#closed) OR #closed = :false)",
        "AND (attribute_not_exists(#lastPushed) OR #lastPushed <= :target)",
      ].join(" "),
      UpdateExpression: [
        "SET #requestCount = if_not_exists(#requestCount, :zero)",
        "#ttl = if_not_exists(#ttl, :ttl)",
        "#lastPushed = :target",
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
        ":false": false,
        ":target": lastPushedCumulativeCount,
        ":ttl": getUsageTtl(now),
        ":zero": 0,
      },
    }),
  );
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

export interface ReconcileBillingScopeInput {
  chain: string[];
  closeAfterFinalize?: boolean;
  currentHash: string;
  ddb: DynamoDBDocumentClient;
  logger: BillingLogger;
  monthKey: string;
  now: Date;
  product: string;
  stripe: Stripe;
  stripeCustomerId: string;
  usageRowsByHash: Map<string, Map<string, UsageCounterRecord>>;
  usageTableName: string;
}

export async function reconcileBillingScope(
  input: ReconcileBillingScopeInput,
): Promise<BillingScopeReconciliationResult> {
  const scope = getScope(input.product, input.monthKey);
  const meterEventName = getMeterEventNameForProduct(input.product);
  if (!meterEventName) {
    throw new Error(`No Stripe meter event mapping configured for product ${input.product}`);
  }

  const sumRequestCount = await sumRequestCountForScope(input.usageRowsByHash, input.chain, scope);
  const currentUsage = await loadUsageRow(input.ddb, input.usageTableName, input.currentHash, scope);
  const currentLastPushed = currentUsage?.lastPushedCumulativeCount ?? 0;
  if (sumRequestCount < currentLastPushed) {
    input.logger.warn("Billing runtime observed negative delta; skipping scope", {
      apiKeyHash: input.currentHash,
      chain: input.chain,
      currentLastPushed,
      monthKey: input.monthKey,
      product: input.product,
      sumRequestCount,
    });
    return { closedScopes: 0, meterEventsSent: 0, negativeDeltas: 1, scopesSkipped: 0 };
  }

  const plan = await buildMeterPushPlan(
    input.ddb,
    input.usageTableName,
    input.currentHash,
    scope,
    input.now,
    sumRequestCount,
  );
  if (!plan || plan.delta <= 0) {
    let closedScopes = 0;
    if (input.closeAfterFinalize && sumRequestCount <= currentLastPushed) {
      if (!currentUsage && sumRequestCount > 0) {
        await materializeCurrentUsageScope(
          input.ddb,
          input.usageTableName,
          input.currentHash,
          scope,
          sumRequestCount,
          input.now,
        );
      }
      const refreshedUsage = currentUsage ?? await loadUsageRow(input.ddb, input.usageTableName, input.currentHash, scope);
      if (
        refreshedUsage &&
        !refreshedUsage.closed &&
        await closeUsageScope(input.ddb, input.usageTableName, input.currentHash, scope, sumRequestCount)
      ) {
        closedScopes = 1;
      }
    }
    return { closedScopes, meterEventsSent: 0, negativeDeltas: 0, scopesSkipped: 1 };
  }

  await input.stripe.billing.meterEvents.create({
    event_name: meterEventName,
    identifier: plan.identifier,
    payload: {
      request_count: String(plan.delta),
      stripe_customer_id: input.stripeCustomerId,
    },
    timestamp: Math.floor(input.now.getTime() / 1000),
  });

  const finalized = await finalizePendingMeterPush(
    input.ddb,
    input.usageTableName,
    input.currentHash,
    scope,
    plan.identifier,
    plan.targetCumulativeCount,
  );
  if (!finalized) {
    throw new Error(`Failed to finalize pending meter push for ${input.currentHash} ${scope}`);
  }

  let closedScopes = 0;
  if (input.closeAfterFinalize) {
    if (
      await closeUsageScope(
        input.ddb,
        input.usageTableName,
        input.currentHash,
        scope,
        plan.targetCumulativeCount,
      )
    ) {
      closedScopes = 1;
    }
  }

  return { closedScopes, meterEventsSent: 1, negativeDeltas: 0, scopesSkipped: 0 };
}
