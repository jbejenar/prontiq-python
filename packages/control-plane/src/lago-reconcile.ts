import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  createLogger,
  deriveLagoExternalSubscriptionIdForOrg,
  type ApiKeyRecord,
  type OrgEnvelopeRecord,
} from "@prontiq/shared";
import {
  HttpLagoEntitlementsClient,
  type LagoEntitlementProjection,
  type LagoSubscriptionProjectionSnapshot,
  buildBillingPeriodKeyFromProjection,
  projectLagoEntitlements,
} from "./lago-entitlements.js";

type Logger = Pick<Console, "error" | "warn" | "info">;
const ORG_ID_INDEX = "orgId-index";

export interface LagoReconcileOptions {
  ddb: DynamoDBDocumentClient;
  keysTableName: string;
  lagoClient: HttpLagoEntitlementsClient;
  apply: boolean;
  orgId?: string;
  logger: Logger;
  now: () => Date;
}

export interface LagoReconcileStats {
  scanned: number;
  projected: number;
  changed: number;
  drift: number;
  errors: number;
}

const logger = createLogger("control-plane-lago-reconcile");

type EnvelopeProjection = {
  tier: string;
  products: string[];
  quotaPerProduct: number | null;
  enforcementMode: LagoEntitlementProjection["enforcementMode"];
  rateLimit: number | null;
  maxKeys: number;
  lagoPlanCode: string;
  lagoSubscriptionExternalId: string;
  lagoSubscriptionStatus: string;
  lagoPreviousPlanCode: string | null;
  lagoNextPlanCode: string | null;
  lagoDowngradePlanDate: string | null;
  lagoPlanTransitionStatus: string | null;
  billingPeriodStartedAt: string | null;
  billingPeriodEndingAt: string | null;
  billingPeriodKey: string | null;
  lagoEntitlementsHash: string;
  lagoLastSyncStatus: "synced";
  lagoLastSyncError: null;
};

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function getOrgEnvelopeKey(orgId: string): string {
  return `ORG#${orgId}`;
}

function isOrgEnvelope(value: unknown): value is OrgEnvelopeRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "apiKeyHash" in value &&
    typeof (value as { apiKeyHash?: unknown }).apiKeyHash === "string" &&
    (value as { apiKeyHash: string }).apiKeyHash.startsWith("ORG#")
  );
}

function isApiKeyRecord(value: unknown): value is ApiKeyRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "apiKeyHash" in value &&
    typeof (value as { apiKeyHash?: unknown }).apiKeyHash === "string" &&
    "keyPrefix" in value &&
    typeof (value as { keyPrefix?: unknown }).keyPrefix === "string" &&
    "active" in value &&
    typeof (value as { active?: unknown }).active === "boolean"
  );
}

function isCurrentClerkOrgEnvelope(value: OrgEnvelopeRecord): boolean {
  return typeof value.orgId === "string" && value.orgId.length > 0;
}

async function loadEnvelope(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  orgId: string,
): Promise<OrgEnvelopeRecord | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { apiKeyHash: getOrgEnvelopeKey(orgId) },
    }),
  );
  return isOrgEnvelope(result.Item) ? result.Item : undefined;
}

async function listActiveKeys(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  orgId: string,
): Promise<ApiKeyRecord[]> {
  const keys: ApiKeyRecord[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: ORG_ID_INDEX,
        KeyConditionExpression: "orgId = :orgId",
        FilterExpression: "attribute_exists(keyPrefix) AND #active = :true",
        ExpressionAttributeNames: {
          "#active": "active",
        },
        ExpressionAttributeValues: {
          ":orgId": orgId,
          ":true": true,
        },
        ExclusiveStartKey,
      }),
    );
    for (const item of result.Items ?? []) {
      if (isApiKeyRecord(item)) keys.push(item);
    }
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return keys;
}

async function listEnvelopes(
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<OrgEnvelopeRecord[]> {
  const envelopes: OrgEnvelopeRecord[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: "begins_with(apiKeyHash, :prefix)",
        ExpressionAttributeValues: { ":prefix": "ORG#" },
        ExclusiveStartKey,
      }),
    );
    for (const item of result.Items ?? []) {
      if (isOrgEnvelope(item) && isCurrentClerkOrgEnvelope(item)) envelopes.push(item);
    }
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return envelopes;
}

function keyNeedsProjectionRepair(
  key: ApiKeyRecord,
  snapshot: LagoSubscriptionProjectionSnapshot,
  projection: LagoEntitlementProjection,
): boolean {
  return (
    key.tier !== snapshot.planCode ||
    key.lagoPlanCode !== snapshot.planCode ||
    key.lagoSubscriptionExternalId !== snapshot.externalSubscriptionId ||
    key.lagoSubscriptionStatus !== snapshot.status ||
    key.billingPeriodStartedAt !== snapshot.billingPeriodStartedAt ||
    key.billingPeriodEndingAt !== snapshot.billingPeriodEndingAt ||
    key.billingPeriodKey !== buildBillingPeriodKeyFromProjection(snapshot) ||
    JSON.stringify(key.products) !== JSON.stringify(projection.products) ||
    key.quotaPerProduct !== projection.quotaPerProduct ||
    key.enforcementMode !== projection.enforcementMode ||
    key.rateLimit !== projection.rateLimit
  );
}

function buildEnvelopeProjection(
  snapshot: LagoSubscriptionProjectionSnapshot,
  projection: LagoEntitlementProjection,
): EnvelopeProjection {
  const hasPendingTransition =
    snapshot.nextPlanCode !== undefined ||
    snapshot.previousPlanCode !== undefined ||
    snapshot.downgradePlanDate !== undefined;
  return {
    tier: snapshot.planCode,
    products: projection.products,
    quotaPerProduct: projection.quotaPerProduct,
    enforcementMode: projection.enforcementMode,
    rateLimit: projection.rateLimit,
    maxKeys: projection.maxKeys,
    lagoPlanCode: snapshot.planCode,
    lagoSubscriptionExternalId: snapshot.externalSubscriptionId,
    lagoSubscriptionStatus: snapshot.status,
    lagoPreviousPlanCode: snapshot.previousPlanCode ?? null,
    lagoNextPlanCode: snapshot.nextPlanCode ?? null,
    lagoDowngradePlanDate: snapshot.downgradePlanDate ?? null,
    lagoPlanTransitionStatus: hasPendingTransition ? "pending" : null,
    billingPeriodStartedAt: snapshot.billingPeriodStartedAt,
    billingPeriodEndingAt: snapshot.billingPeriodEndingAt,
    billingPeriodKey: buildBillingPeriodKeyFromProjection(snapshot),
    lagoEntitlementsHash: projection.lagoEntitlementsHash,
    lagoLastSyncStatus: "synced",
    lagoLastSyncError: null,
  };
}

function projectionValuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
}

function envelopeNeedsProjectionRepair(
  envelope: OrgEnvelopeRecord,
  desired: EnvelopeProjection,
): boolean {
  return Object.entries(desired).some(([key, value]) =>
    !projectionValuesEqual(envelope[key as keyof OrgEnvelopeRecord], value),
  );
}

async function updateEnvelopeForProjection(
  options: LagoReconcileOptions,
  envelope: OrgEnvelopeRecord,
  desired: EnvelopeProjection,
): Promise<void> {
  await options.ddb.send(
    new UpdateCommand({
      TableName: options.keysTableName,
      Key: { apiKeyHash: envelope.apiKeyHash },
      UpdateExpression: [
        "SET #tier = :tier",
        "#products = :products",
        "#quotaPerProduct = :quotaPerProduct",
        "#enforcementMode = :enforcementMode",
        "#rateLimit = :rateLimit",
        "#maxKeys = :maxKeys",
        "#lagoPlanCode = :planCode",
        "#lagoSubscriptionExternalId = :externalSubscriptionId",
        "#lagoSubscriptionStatus = :subscriptionStatus",
        "#lagoPreviousPlanCode = :previousPlanCode",
        "#lagoNextPlanCode = :nextPlanCode",
        "#lagoDowngradePlanDate = :downgradePlanDate",
        "#lagoPlanTransitionStatus = :transitionStatus",
        "#billingPeriodStartedAt = :periodStart",
        "#billingPeriodEndingAt = :periodEnd",
        "#billingPeriodKey = :periodKey",
        "#lagoEntitlementsHash = :hash",
        "#lagoLastSyncedAt = :syncedAt",
        "#lagoLastSyncStatus = :status",
        "#lagoLastSyncError = :error",
      ].join(", "),
      ExpressionAttributeNames: {
        "#billingPeriodEndingAt": "billingPeriodEndingAt",
        "#billingPeriodKey": "billingPeriodKey",
        "#billingPeriodStartedAt": "billingPeriodStartedAt",
        "#enforcementMode": "enforcementMode",
        "#lagoDowngradePlanDate": "lagoDowngradePlanDate",
        "#lagoEntitlementsHash": "lagoEntitlementsHash",
        "#lagoLastSyncedAt": "lagoLastSyncedAt",
        "#lagoLastSyncError": "lagoLastSyncError",
        "#lagoLastSyncStatus": "lagoLastSyncStatus",
        "#lagoNextPlanCode": "lagoNextPlanCode",
        "#lagoPlanCode": "lagoPlanCode",
        "#lagoPlanTransitionStatus": "lagoPlanTransitionStatus",
        "#lagoPreviousPlanCode": "lagoPreviousPlanCode",
        "#lagoSubscriptionExternalId": "lagoSubscriptionExternalId",
        "#lagoSubscriptionStatus": "lagoSubscriptionStatus",
        "#maxKeys": "maxKeys",
        "#products": "products",
        "#quotaPerProduct": "quotaPerProduct",
        "#rateLimit": "rateLimit",
        "#tier": "tier",
      },
      ExpressionAttributeValues: {
        ":downgradePlanDate": desired.lagoDowngradePlanDate,
        ":enforcementMode": desired.enforcementMode,
        ":error": desired.lagoLastSyncError,
        ":externalSubscriptionId": desired.lagoSubscriptionExternalId,
        ":hash": desired.lagoEntitlementsHash,
        ":maxKeys": desired.maxKeys,
        ":nextPlanCode": desired.lagoNextPlanCode,
        ":periodEnd": desired.billingPeriodEndingAt,
        ":periodKey": desired.billingPeriodKey,
        ":periodStart": desired.billingPeriodStartedAt,
        ":planCode": desired.lagoPlanCode,
        ":previousPlanCode": desired.lagoPreviousPlanCode,
        ":products": desired.products,
        ":quotaPerProduct": desired.quotaPerProduct,
        ":rateLimit": desired.rateLimit,
        ":status": desired.lagoLastSyncStatus,
        ":subscriptionStatus": desired.lagoSubscriptionStatus,
        ":syncedAt": options.now().toISOString(),
        ":tier": desired.tier,
        ":transitionStatus": desired.lagoPlanTransitionStatus,
      },
    }),
  );
}

async function updateKeyForProjection(
  options: LagoReconcileOptions,
  key: ApiKeyRecord,
  snapshot: LagoSubscriptionProjectionSnapshot,
  projection: LagoEntitlementProjection,
): Promise<void> {
  await options.ddb.send(
    new UpdateCommand({
      TableName: options.keysTableName,
      Key: { apiKeyHash: key.apiKeyHash },
      UpdateExpression: [
        "SET #tier = :tier",
        "#products = :products",
        "#quotaPerProduct = :quotaPerProduct",
        "#enforcementMode = :enforcementMode",
        "#rateLimit = :rateLimit",
        "#lagoPlanCode = :planCode",
        "#lagoSubscriptionExternalId = :externalSubscriptionId",
        "#lagoSubscriptionStatus = :subscriptionStatus",
        "#billingPeriodStartedAt = :periodStart",
        "#billingPeriodEndingAt = :periodEnd",
        "#billingPeriodKey = :periodKey",
      ].join(", "),
      ConditionExpression: "attribute_exists(apiKeyHash) AND attribute_exists(keyPrefix)",
      ExpressionAttributeNames: {
        "#billingPeriodEndingAt": "billingPeriodEndingAt",
        "#billingPeriodKey": "billingPeriodKey",
        "#billingPeriodStartedAt": "billingPeriodStartedAt",
        "#enforcementMode": "enforcementMode",
        "#lagoPlanCode": "lagoPlanCode",
        "#lagoSubscriptionExternalId": "lagoSubscriptionExternalId",
        "#lagoSubscriptionStatus": "lagoSubscriptionStatus",
        "#products": "products",
        "#quotaPerProduct": "quotaPerProduct",
        "#rateLimit": "rateLimit",
        "#tier": "tier",
      },
      ExpressionAttributeValues: {
        ":externalSubscriptionId": snapshot.externalSubscriptionId,
        ":periodEnd": snapshot.billingPeriodEndingAt,
        ":periodKey": buildBillingPeriodKeyFromProjection(snapshot),
        ":periodStart": snapshot.billingPeriodStartedAt,
        ":planCode": snapshot.planCode,
        ":products": projection.products,
        ":quotaPerProduct": projection.quotaPerProduct,
        ":enforcementMode": projection.enforcementMode,
        ":rateLimit": projection.rateLimit,
        ":subscriptionStatus": snapshot.status,
        ":tier": snapshot.planCode,
      },
    }),
  );
}

async function reconcileEnvelope(
  options: LagoReconcileOptions,
  envelope: OrgEnvelopeRecord,
): Promise<"projected" | "changed" | "drift" | "error"> {
  const orgId = envelope.orgId ?? envelope.apiKeyHash.slice("ORG#".length);
  try {
    const externalSubscriptionId =
      envelope.lagoSubscriptionExternalId ?? deriveLagoExternalSubscriptionIdForOrg(orgId);
    const snapshot = await options.lagoClient.getSubscription(externalSubscriptionId);
    if (!snapshot) throw new Error(`Lago subscription ${externalSubscriptionId} not found`);
    const projection = projectLagoEntitlements({
      snapshot,
      charges: await options.lagoClient.getSubscriptionCharges(externalSubscriptionId),
      entitlements: await options.lagoClient.getSubscriptionEntitlements(externalSubscriptionId),
    });
    if (projection.status === "drift") {
      options.logger.warn("Lago projection drift", { orgId, reason: projection.reason });
      if (options.apply) {
        await options.ddb.send(
          new UpdateCommand({
            TableName: options.keysTableName,
            Key: { apiKeyHash: envelope.apiKeyHash },
            UpdateExpression:
              "SET lagoLastSyncStatus = :status, lagoLastSyncError = :error, lagoLastSyncedAt = :syncedAt",
            ExpressionAttributeValues: {
              ":status": "drift",
              ":error": projection.reason,
              ":syncedAt": options.now().toISOString(),
            },
          }),
        );
      }
      return "drift";
    }
    const projected = projection.projection;
    const activeKeys = await listActiveKeys(options.ddb, options.keysTableName, orgId);
    const staleKeys = activeKeys.filter((key) => keyNeedsProjectionRepair(key, snapshot, projected));
    const desiredEnvelope = buildEnvelopeProjection(snapshot, projected);
    const envelopeChanged = envelopeNeedsProjectionRepair(envelope, desiredEnvelope);
    const changed = envelopeChanged || staleKeys.length > 0;
    if (options.apply && changed) {
      if (envelopeChanged) {
        await updateEnvelopeForProjection(options, envelope, desiredEnvelope);
      }
      for (const key of staleKeys) {
        await updateKeyForProjection(options, key, snapshot, projected);
      }
    }
    return changed ? "changed" : "projected";
  } catch (error) {
    options.logger.error("Lago reconciliation failed", {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "error";
  }
}

export async function reconcileLagoEntitlements(
  options: LagoReconcileOptions,
): Promise<LagoReconcileStats> {
  const stats: LagoReconcileStats = {
    scanned: 0,
    projected: 0,
    changed: 0,
    drift: 0,
    errors: 0,
  };
  const envelopes = options.orgId
    ? [await loadEnvelope(options.ddb, options.keysTableName, options.orgId)].filter(
        (item): item is OrgEnvelopeRecord => item !== undefined,
      )
    : await listEnvelopes(options.ddb, options.keysTableName);
  for (const envelope of envelopes) {
    stats.scanned += 1;
    const result = await reconcileEnvelope(options, envelope);
    if (result === "projected") stats.projected += 1;
    if (result === "changed") stats.changed += 1;
    if (result === "drift") stats.drift += 1;
    if (result === "error") stats.errors += 1;
  }
  return stats;
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const apply = argv.includes("--apply");
  const orgIndex = argv.indexOf("--org");
  const orgId = orgIndex >= 0 ? argv[orgIndex + 1] : undefined;
  const stats = await reconcileLagoEntitlements({
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    keysTableName: getRequiredEnv("KEYS_TABLE_NAME"),
    lagoClient: new HttpLagoEntitlementsClient({
      apiKey: getRequiredEnv("LAGO_API_KEY"),
      baseUrl: getRequiredEnv("LAGO_API_URL"),
    }),
    apply,
    ...(orgId ? { orgId } : {}),
    logger,
    now: () => new Date(),
  });
  logger.info("Lago reconciliation completed", { apply, orgId, ...stats });
  if (stats.drift > 0 || stats.errors > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runCli();
}
