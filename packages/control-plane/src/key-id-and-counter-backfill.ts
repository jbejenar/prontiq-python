import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createLogger } from "@prontiq/shared";
import { monotonicFactory } from "ulid";

const logger = createLogger("control-plane-key-id-and-counter-backfill");
const ulid = monotonicFactory();
const ORG_ID_INDEX = "orgId-index";
const ENVELOPE_PREFIX = "ORG#";
const REGISTRY_PREFIX = "REGISTRY#";

export interface KeyIdAndCounterBackfillStats {
  dryRun: boolean;
  envelopesScanned: number;
  envelopesUpdated: number;
  envelopesAlreadyUpToDate: number;
  keysScanned: number;
  keysBackfilled: number;
  keysAlreadyUpToDate: number;
  errors: Array<{ apiKeyHash: string; reason: string }>;
}

export interface KeyIdAndCounterBackfillOptions {
  apply?: boolean;
  ddb?: DynamoDBDocumentClient;
  keysTableName: string;
  /**
   * Optional ULID factory override for deterministic tests. Production
   * uses the module-level monotonic factory.
   */
  generateKeyId?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnvelope(item: Record<string, unknown>): boolean {
  return typeof item.apiKeyHash === "string" && item.apiKeyHash.startsWith(ENVELOPE_PREFIX);
}

function isCandidateApiKey(item: Record<string, unknown>): boolean {
  if (typeof item.apiKeyHash !== "string") return false;
  if (item.apiKeyHash.startsWith(ENVELOPE_PREFIX)) return false;
  if (item.apiKeyHash.startsWith(REGISTRY_PREFIX)) return false;
  return typeof item.orgId === "string" && typeof item.keyPrefix === "string";
}

async function countActiveKeysForOrg(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  orgId: string,
): Promise<number> {
  // Count must include only `active = true` keys. `attribute_exists(active)`
  // is true for both `active: true` AND `active: false` rows (the attribute
  // is present on revoked keys), which would inflate the counter and cause
  // phantom maxKeys-limit failures in /v1/account/keys/create.
  const response = await ddb.send(
    new QueryCommand({
      TableName: keysTableName,
      IndexName: ORG_ID_INDEX,
      KeyConditionExpression: "orgId = :orgId",
      FilterExpression: "attribute_exists(keyPrefix) AND active = :true",
      ExpressionAttributeValues: { ":orgId": orgId, ":true": true },
      Select: "COUNT",
    }),
  );
  return response.Count ?? 0;
}

async function setEnvelopeActiveKeyCountIfMissing(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  apiKeyHash: string,
  count: number,
): Promise<boolean> {
  // Two preconditions:
  //   1. `attribute_exists(apiKeyHash)` — the row must still exist. Without
  //      this, a row deleted between Scan and Update would pass the
  //      `attribute_not_exists(activeKeyCount)` check (vacuously true on a
  //      missing item) and DynamoDB's upsert-by-default UpdateItem would
  //      CREATE a partial row containing only { apiKeyHash, activeKeyCount }.
  //   2. `attribute_not_exists(activeKeyCount)` — race protection so a
  //      re-run cannot clobber a counter already mutated by
  //      /v1/account/keys/{create,revoke}. Drift correction lives in the
  //      post-launch reconciliation runbook, not here.
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: keysTableName,
        Key: { apiKeyHash },
        UpdateExpression: "SET activeKeyCount = :c",
        ConditionExpression:
          "attribute_exists(apiKeyHash) AND attribute_not_exists(activeKeyCount)",
        ExpressionAttributeValues: { ":c": count },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw err;
  }
}

async function setKeyIdIfMissing(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  apiKeyHash: string,
  keyId: string,
): Promise<boolean> {
  // Same upsert-protection rationale as `setEnvelopeActiveKeyCountIfMissing`:
  // `attribute_exists(apiKeyHash)` rejects a deleted-then-recreated upsert.
  // The orgId + keyPrefix existence checks further ensure we only ever
  // backfill rows that look like real key records (defense in depth against
  // a partial row that managed to acquire the apiKeyHash partition key).
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: keysTableName,
        Key: { apiKeyHash },
        UpdateExpression: "SET keyId = :id",
        ConditionExpression:
          "attribute_exists(apiKeyHash) AND attribute_exists(orgId) AND attribute_exists(keyPrefix) AND attribute_not_exists(keyId)",
        ExpressionAttributeValues: { ":id": keyId },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw err;
  }
}

export async function backfillKeyIdsAndCounters(
  options: KeyIdAndCounterBackfillOptions,
): Promise<KeyIdAndCounterBackfillStats> {
  const ddb = options.ddb ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const dryRun = options.apply !== true;
  const generateKeyId = options.generateKeyId ?? (() => `key_${ulid()}`);
  const stats: KeyIdAndCounterBackfillStats = {
    dryRun,
    envelopesScanned: 0,
    envelopesUpdated: 0,
    envelopesAlreadyUpToDate: 0,
    keysScanned: 0,
    keysBackfilled: 0,
    keysAlreadyUpToDate: 0,
    errors: [],
  };

  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: options.keysTableName,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const rawItem of (page.Items as unknown[] | undefined) ?? []) {
      if (!isRecord(rawItem)) continue;

      if (isEnvelope(rawItem)) {
        stats.envelopesScanned += 1;
        const apiKeyHash = rawItem.apiKeyHash as string;
        const existing =
          typeof rawItem.activeKeyCount === "number" ? rawItem.activeKeyCount : undefined;
        if (existing !== undefined) {
          // Already counted (initial backfill complete OR another writer
          // owns it now). Skip — drift correction is a separate runbook.
          stats.envelopesAlreadyUpToDate += 1;
          continue;
        }
        const orgId =
          typeof rawItem.orgId === "string" && rawItem.orgId.length > 0
            ? rawItem.orgId
            : apiKeyHash.slice(ENVELOPE_PREFIX.length);
        try {
          const expectedCount = await countActiveKeysForOrg(ddb, options.keysTableName, orgId);
          if (dryRun) {
            stats.envelopesUpdated += 1;
            continue;
          }
          const wrote = await setEnvelopeActiveKeyCountIfMissing(
            ddb,
            options.keysTableName,
            apiKeyHash,
            expectedCount,
          );
          if (wrote) {
            stats.envelopesUpdated += 1;
          } else {
            // Race: a concurrent writer set activeKeyCount between our
            // scan and our update. That writer's value is authoritative.
            stats.envelopesAlreadyUpToDate += 1;
          }
        } catch (err) {
          stats.errors.push({
            apiKeyHash,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }

      if (isCandidateApiKey(rawItem)) {
        stats.keysScanned += 1;
        const apiKeyHash = rawItem.apiKeyHash as string;
        if (typeof rawItem.keyId === "string" && rawItem.keyId.length > 0) {
          stats.keysAlreadyUpToDate += 1;
          continue;
        }
        if (dryRun) {
          stats.keysBackfilled += 1;
          continue;
        }
        try {
          const wrote = await setKeyIdIfMissing(
            ddb,
            options.keysTableName,
            apiKeyHash,
            generateKeyId(),
          );
          if (wrote) {
            stats.keysBackfilled += 1;
          } else {
            stats.keysAlreadyUpToDate += 1;
          }
        } catch (err) {
          stats.errors.push({
            apiKeyHash,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    exclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return stats;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const keysTableName = process.env.KEYS_TABLE_NAME;
  if (!keysTableName) throw new Error("KEYS_TABLE_NAME is required");
  const apply = process.argv.includes("--apply");
  const stats = await backfillKeyIdsAndCounters({ apply, keysTableName });
  logger.info("Key id + counter backfill completed", stats);
  // Exit non-zero on any per-item failure so an operator wrapper / CI
  // gate cannot mistakenly treat a partial run as a successful deploy
  // gate. Both --apply and dry-run honor this; dry-run errors usually
  // signal IAM/GSI issues that would also break --apply.
  if (stats.errors.length > 0) {
    logger.error(`Backfill exited with ${stats.errors.length} item-level error(s)`);
    process.exit(1);
  }
}
