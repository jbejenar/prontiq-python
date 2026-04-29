import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient, QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  PLANS,
  generateKey,
  type ApiKeyRecord,
  type AuditRecord,
  type OrgEnvelopeRecord,
  type UsageCounterRecord,
} from "@prontiq/shared";
import { monotonicFactory } from "ulid";
import { buildAuditTransactItem } from "./audit.js";
import { getAdminRoles } from "./clerk.js";

const ulid = monotonicFactory();
const ORG_ID_INDEX = "orgId-index";
const ENVELOPE_PREFIX = "ORG#";
const REDIRECT_SCOPE = "REDIRECT";
const KEY_AUDIT_ACTIONS = new Set(["CREATE", "ROTATE", "REVOKE"]);
const AUDIT_QUERY_PAGE_SIZE = 50;
const AUDIT_QUERY_MAX_PAGES = 10;

/**
 * Maximum number of times rotateKey re-Queries usage rows + retries
 * the TransactWriteItems when a usage-row optimistic-concurrency check
 * fails. A failure here means a hot-path increment landed on the OLD
 * key partition between our pre-tx Query and the transaction commit;
 * we re-read the latest counter values and try again. At free-tier
 * traffic (≤10 RPS per key), a single retry resolves the race; we
 * cap at 3 to bound latency in pathological collision storms.
 */
const ROTATE_USAGE_RETRY_MAX = 3;

/**
 * Hard ceiling on TransactItems per TransactWriteCommand. AWS limit
 * is 100. rotateKey base cost is 4 (Delete old key, Put new key, Put
 * REDIRECT, Audit) and each migrated usage row adds 2 (Put new + Delete
 * old). Today PRODUCT_REGISTRY caps at ~5 products × 1 active period
 * = 5 rows → 14 items. Defensive throw if a future schema explosion
 * (e.g. new "scope" types beyond product#yearMonth) ever pushes us
 * over 100; we'd rather fail-loud here than have the transaction
 * silently 4xx with a cryptic AWS error mid-rotate.
 */
const TRANSACT_ITEM_LIMIT = 100;

type Logger = Pick<Console, "error" | "warn" | "info">;

const noopLogger: Logger = {
  error: () => {},
  info: () => {},
  warn: () => {},
};

/**
 * Snapshot of plan-relevant fields copied from the org envelope onto
 * each key row at create/rotate time. Auth-middleware reads these
 * directly off the key row (not the envelope) so the hot path stays a
 * single GetItem.
 */
function pickEnvelopeSnapshot(envelope: OrgEnvelopeRecord) {
  const snapshot: Partial<ApiKeyRecord> = {
    paymentOverdue: envelope.paymentOverdue,
    products: envelope.products,
    stripeCustomerId: envelope.stripeCustomerId,
    stripeSubscriptionId: envelope.stripeSubscriptionId,
    subscriptionItems: envelope.subscriptionItems,
    tier: envelope.tier,
  };
  if (envelope.lagoPlanCode !== undefined) snapshot.lagoPlanCode = envelope.lagoPlanCode;
  if (envelope.lagoSubscriptionExternalId !== undefined)
    snapshot.lagoSubscriptionExternalId = envelope.lagoSubscriptionExternalId;
  if (envelope.lagoSubscriptionStatus !== undefined)
    snapshot.lagoSubscriptionStatus = envelope.lagoSubscriptionStatus;
  if (envelope.lagoPreviousPlanCode !== undefined)
    snapshot.lagoPreviousPlanCode = envelope.lagoPreviousPlanCode;
  if (envelope.lagoNextPlanCode !== undefined)
    snapshot.lagoNextPlanCode = envelope.lagoNextPlanCode;
  if (envelope.lagoDowngradePlanDate !== undefined)
    snapshot.lagoDowngradePlanDate = envelope.lagoDowngradePlanDate;
  if (envelope.lagoPlanTransitionStatus !== undefined)
    snapshot.lagoPlanTransitionStatus = envelope.lagoPlanTransitionStatus;
  if (envelope.billingPeriodStartedAt !== undefined)
    snapshot.billingPeriodStartedAt = envelope.billingPeriodStartedAt;
  if (envelope.billingPeriodEndingAt !== undefined)
    snapshot.billingPeriodEndingAt = envelope.billingPeriodEndingAt;
  if (envelope.billingPeriodKey !== undefined)
    snapshot.billingPeriodKey = envelope.billingPeriodKey;
  if (envelope.lagoPaymentOverdueInvoiceId !== undefined)
    snapshot.lagoPaymentOverdueInvoiceId = envelope.lagoPaymentOverdueInvoiceId;
  return snapshot;
}

export interface KeyManagementDependencies {
  ddb: DynamoDBDocumentClient;
  keysTableName: string;
  auditTableName: string;
  /**
   * Usage table — REDIRECT rows live here on rotate so the auth
   * middleware can resolve a presented old hash to the new key for
   * the 5-minute grace window. Required for rotateKey; revokeKey
   * doesn't touch this table.
   */
  usageTableName: string;
  logger?: Logger;
  /** Override for deterministic tests. Production uses the module factory. */
  generateKeyId?: () => string;
  /** Override for deterministic tests. Production uses {@link generateKey}. */
  generateRawKey?: () => ReturnType<typeof generateKey>;
}

export type CreateKeyInput = {
  orgId: string;
  actorId: string;
  ip?: string;
  userAgent?: string;
  label?: string;
  now?: Date;
};

export type CreateKeyResult =
  | {
      status: "created";
      keyId: string;
      raw: string;
      keyPrefix: string;
      createdAt: string;
      label: string | undefined;
    }
  | { status: "limit_exceeded" }
  | { status: "org_not_provisioned" };

export type RotateKeyInput = {
  orgId: string;
  keyId: string;
  actorId: string;
  ip?: string;
  userAgent?: string;
  now?: Date;
};

export type RotateKeyResult =
  | {
      status: "rotated";
      keyId: string;
      raw: string;
      keyPrefix: string;
      createdAt: string;
      rotatedAt: string;
    }
  | { status: "key_not_found" };

export type RevokeKeyInput = {
  orgId: string;
  keyId: string;
  actorId: string;
  ip?: string;
  userAgent?: string;
  now?: Date;
};

export type RevokeKeyResult =
  | { status: "revoked"; keyId: string; revokedAt: string }
  | { status: "key_not_found" }
  | { status: "already_revoked" };

export interface ListedKey {
  keyId: string;
  keyPrefix: string;
  label?: string;
  createdAt: string;
  lastUsedAt: string | null;
  active: boolean;
  products: string[];
}

export interface ListedAuditEvent {
  action: string;
  actorId: string;
  timestamp: string;
  metadata?: {
    keyId?: string;
    label?: string;
  };
  ip?: string;
  userAgent?: string;
}

function publicAuditMetadata(metadata: AuditRecord["metadata"]): ListedAuditEvent["metadata"] {
  if (!metadata || typeof metadata !== "object") return undefined;
  const out: Record<string, unknown> = {};
  if (typeof metadata.keyId === "string") out.keyId = metadata.keyId;
  if (typeof metadata.label === "string") out.label = metadata.label;
  return Object.keys(out).length > 0 ? out : undefined;
}

export type OrgKeyStatus =
  | {
      orgId: string;
      orgRole: string;
      canManageKeys: boolean;
      provisioned: false;
    }
  | {
      orgId: string;
      orgRole: string;
      canManageKeys: boolean;
      provisioned: true;
      hasFirstKey: boolean;
      activeKeyCount: number;
      tier: OrgEnvelopeRecord["tier"];
      maxKeys: number;
    };

export interface KeyManagementService {
  getOrgStatus(input: { orgId: string; orgRole: string }): Promise<OrgKeyStatus>;
  createKey(input: CreateKeyInput): Promise<CreateKeyResult>;
  listOrgKeys(input: { orgId: string }): Promise<ListedKey[]>;
  listAuditTail(input: { orgId: string; limit?: number }): Promise<ListedAuditEvent[]>;
  rotateKey(input: RotateKeyInput): Promise<RotateKeyResult>;
  revokeKey(input: RevokeKeyInput): Promise<RevokeKeyResult>;
}

export function getOrgEnvelopeKey(orgId: string): string {
  return `${ENVELOPE_PREFIX}${orgId}`;
}

export function createKeyManagementService(deps: KeyManagementDependencies): KeyManagementService {
  const { ddb, keysTableName, auditTableName, usageTableName } = deps;
  const logger = deps.logger ?? noopLogger;
  const generateKeyId = deps.generateKeyId ?? (() => `key_${ulid()}`);
  const generateRawKey = deps.generateRawKey ?? generateKey;

  async function loadEnvelope(orgId: string): Promise<OrgEnvelopeRecord | undefined> {
    const result = await ddb.send(
      new GetCommand({
        TableName: keysTableName,
        Key: { apiKeyHash: getOrgEnvelopeKey(orgId) },
      }),
    );
    return result.Item as OrgEnvelopeRecord | undefined;
  }

  async function getOrgStatus(input: { orgId: string; orgRole: string }): Promise<OrgKeyStatus> {
    const canManageKeys = input.orgRole.length > 0 && getAdminRoles().has(input.orgRole);
    const envelope = await loadEnvelope(input.orgId);
    if (!envelope) {
      return {
        orgId: input.orgId,
        orgRole: input.orgRole,
        canManageKeys,
        provisioned: false,
      };
    }
    const plan = PLANS[envelope.tier];
    const activeKeyCount = envelope.activeKeyCount ?? 0;
    return {
      orgId: input.orgId,
      orgRole: input.orgRole,
      canManageKeys,
      provisioned: true,
      hasFirstKey: envelope.hasFirstKey || activeKeyCount > 0,
      activeKeyCount,
      tier: envelope.tier,
      maxKeys: plan.maxKeys,
    };
  }

  async function createKey(input: CreateKeyInput): Promise<CreateKeyResult> {
    const envelope = await loadEnvelope(input.orgId);
    if (!envelope) {
      return { status: "org_not_provisioned" };
    }
    const plan = PLANS[envelope.tier];

    // Capture all derivable values once, OUTSIDE any retry boundary.
    //
    // Idempotency model:
    //
    //   1. SDK-internal retries (network blip, throttle, 5xx). The
    //      AWS SDK v3 retry middleware lives at `step: "finalizeRequest"`
    //      and re-sends the SAME args.request on each attempt
    //      (@smithy/middleware-retry/dist-es/retryMiddleware.js).
    //      Serialization (where idempotencyToken auto-gen happens, see
    //      @smithy/core/dist-es/submodules/protocols/serde/
    //      ToStringShapeSerializer.js) runs at the outer `serialize`
    //      step, BEFORE retry — so the marshalled request bytes
    //      (including ClientRequestToken) are fixed before retries
    //      fire. DDB's 10-min idempotency window collapses retried
    //      successful transactions into no-ops.
    //
    //      We pass an EXPLICIT ClientRequestToken=keyId below — even
    //      though SDK auto-gen would produce equivalent behaviour —
    //      because (a) AWS docs explicitly recommend providing your
    //      own token "for logging and ease of administrative review"
    //      and (b) it makes the idempotency contract grep-able.
    //
    //   2. HTTP-level retries (lost response → caller re-issues the
    //      HTTP POST → fresh Lambda invocation). NOT addressed by
    //      ClientRequestToken — each invocation generates a fresh
    //      keyId and fresh raw key, so the second transaction has a
    //      different apiKeyHash and would succeed independently,
    //      creating a duplicate active key. Fix requires an
    //      Idempotency-Key header pattern with stored in-flight
    //      state (out of scope; see docs/runbooks/api-key-lifecycle.md
    //      once that lands).
    const now = input.now ?? new Date();
    const generated = generateRawKey();
    const keyId = generateKeyId();
    const auditEventId = ulid(now.getTime());
    const snapshot = pickEnvelopeSnapshot(envelope);

    const keyItem: ApiKeyRecord = {
      apiKeyHash: generated.hash,
      keyId,
      keyPrefix: generated.prefix,
      ownerEmail: envelope.ownerEmail,
      orgId: input.orgId,
      quotaPerProduct: plan.quotaPerProduct,
      rateLimit: plan.rateLimit,
      active: true,
      createdAt: now.toISOString(),
      lastUsedAt: null,
      paymentOverdue: snapshot.paymentOverdue ?? false,
      products: snapshot.products ?? [],
      stripeCustomerId: snapshot.stripeCustomerId ?? null,
      stripeSubscriptionId: snapshot.stripeSubscriptionId ?? null,
      subscriptionItems: snapshot.subscriptionItems ?? {},
      tier: snapshot.tier ?? envelope.tier,
      ...(snapshot.lagoPlanCode !== undefined ? { lagoPlanCode: snapshot.lagoPlanCode } : {}),
      ...(snapshot.lagoSubscriptionExternalId !== undefined
        ? { lagoSubscriptionExternalId: snapshot.lagoSubscriptionExternalId }
        : {}),
      ...(snapshot.lagoSubscriptionStatus !== undefined
        ? { lagoSubscriptionStatus: snapshot.lagoSubscriptionStatus }
        : {}),
      ...(snapshot.lagoPreviousPlanCode !== undefined
        ? { lagoPreviousPlanCode: snapshot.lagoPreviousPlanCode }
        : {}),
      ...(snapshot.lagoNextPlanCode !== undefined
        ? { lagoNextPlanCode: snapshot.lagoNextPlanCode }
        : {}),
      ...(snapshot.lagoDowngradePlanDate !== undefined
        ? { lagoDowngradePlanDate: snapshot.lagoDowngradePlanDate }
        : {}),
      ...(snapshot.lagoPlanTransitionStatus !== undefined
        ? { lagoPlanTransitionStatus: snapshot.lagoPlanTransitionStatus }
        : {}),
      ...(snapshot.billingPeriodStartedAt !== undefined
        ? { billingPeriodStartedAt: snapshot.billingPeriodStartedAt }
        : {}),
      ...(snapshot.billingPeriodEndingAt !== undefined
        ? { billingPeriodEndingAt: snapshot.billingPeriodEndingAt }
        : {}),
      ...(snapshot.billingPeriodKey !== undefined
        ? { billingPeriodKey: snapshot.billingPeriodKey }
        : {}),
      ...(snapshot.lagoPaymentOverdueInvoiceId !== undefined
        ? { lagoPaymentOverdueInvoiceId: snapshot.lagoPaymentOverdueInvoiceId }
        : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      createdByActorId: input.actorId,
    };

    const auditItem = buildAuditTransactItem({
      tableName: auditTableName,
      orgId: input.orgId,
      action: "CREATE",
      actorId: input.actorId,
      apiKeyHash: generated.hash,
      metadata: { keyId, ...(input.label !== undefined ? { label: input.label } : {}) },
      now,
      eventId: auditEventId,
      ...(input.ip !== undefined ? { ip: input.ip } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    });

    try {
      await ddb.send(
        new TransactWriteCommand({
          // Explicit idempotency token — see comment block above for
          // the full retry-boundary analysis. keyId is a fresh ULID
          // generated outside any retry loop, so it's stable across
          // SDK-internal retries and unique per Lambda invocation.
          ClientRequestToken: keyId,
          TransactItems: [
            {
              Put: {
                TableName: keysTableName,
                Item: keyItem,
                ConditionExpression: "attribute_not_exists(apiKeyHash)",
              },
            },
            {
              Update: {
                TableName: keysTableName,
                Key: { apiKeyHash: getOrgEnvelopeKey(input.orgId) },
                UpdateExpression:
                  "SET hasFirstKey = :true, activeKeyCount = if_not_exists(activeKeyCount, :zero) + :one",
                // `attribute_exists(apiKeyHash)` rejects a deleted-then-rescanned
                // upsert: DynamoDB's UpdateItem upserts by default, and
                // `attribute_not_exists(activeKeyCount)` is vacuously true on
                // a missing item. Without the existence check, a hypothetical
                // envelope-deletion race would create a partial
                // { apiKeyHash, hasFirstKey, activeKeyCount } row that no other
                // code knows how to interpret. Same defense the PR 0 backfill
                // landed after bot review.
                ConditionExpression:
                  "attribute_exists(apiKeyHash) AND (attribute_not_exists(activeKeyCount) OR activeKeyCount < :max)",
                ExpressionAttributeValues: {
                  ":true": true,
                  ":zero": 0,
                  ":one": 1,
                  ":max": plan.maxKeys,
                },
              },
            },
            auditItem,
          ],
        }),
      );
    } catch (error) {
      // TransactWriteItems atomic-failure handling.
      //
      // CancellationReasons indices follow the TransactItems order:
      //   [0] key Put             — fails on apiKeyHash collision (cosmically rare)
      //   [1] envelope Update     — fails when activeKeyCount >= maxKeys
      //   [2] audit Put           — fails on duplicate eventId (idempotent retry)
      //
      // The customer-visible case is [1] = limit hit → 403. Everything
      // else (collisions, bizarre states) bubbles as a 500 — the alarm
      // fires and we read CloudWatch logs.
      if (error instanceof TransactionCanceledException) {
        const reasons = error.CancellationReasons ?? [];
        const envelopeFailed = reasons[1]?.Code === "ConditionalCheckFailed";
        const keyCollided = reasons[0]?.Code === "ConditionalCheckFailed";
        if (envelopeFailed && !keyCollided) {
          return { status: "limit_exceeded" };
        }
      }
      logger.error("createKey TransactWriteItems failed", {
        orgId: input.orgId,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof TransactionCanceledException
          ? { cancellationReasons: error.CancellationReasons }
          : {}),
      });
      throw error;
    }

    return {
      status: "created",
      keyId,
      raw: generated.raw,
      keyPrefix: generated.prefix,
      createdAt: now.toISOString(),
      label: input.label,
    };
  }

  /**
   * Locate a key row by `keyId` via the `orgId-index` GSI. Returns
   * the row regardless of `active` status (rotate/revoke handlers
   * differentiate on the field). Expected cardinality is exactly 1
   * per `keyId` in an org; >1 indicates data corruption (a `keyId`
   * uniqueness invariant was violated) and the caller throws.
   *
   * Filter: `attribute_exists(keyPrefix)` excludes the org envelope;
   * `attribute_exists(active)` excludes any GSI-projected rows that
   * would lack the field. We deliberately do NOT filter on
   * `active = :true` — this is the lookup path for both rotate
   * (target must be active) and revoke (target may already be revoked
   * → caller returns 409 ALREADY_REVOKED with a clear message).
   *
   * Future-optimisation: linear in org's key count. Acceptable up to
   * ~100 keys/org. Add a `keyId-index` GSI when enterprise plans grow
   * past that ceiling — out of scope for this PR.
   */
  async function findKeyByKeyId(orgId: string, keyId: string): Promise<ApiKeyRecord | undefined> {
    const result = await ddb.send(
      new QueryCommand({
        TableName: keysTableName,
        IndexName: ORG_ID_INDEX,
        KeyConditionExpression: "orgId = :orgId",
        FilterExpression:
          "keyId = :keyId AND attribute_exists(keyPrefix) AND attribute_exists(active)",
        ExpressionAttributeValues: { ":orgId": orgId, ":keyId": keyId },
      }),
    );
    const items = (result.Items as ApiKeyRecord[] | undefined) ?? [];
    if (items.length === 0) return undefined;
    if (items.length > 1) {
      // keyId uniqueness invariant violated — escalate. Both
      // rotate/revoke handlers convert this to a 500 INTERNAL_ERROR
      // so an alarm fires; we do NOT silently pick `items[0]`.
      logger.error("findKeyByKeyId: keyId uniqueness invariant violated", {
        orgId,
        keyId,
        rowCount: items.length,
      });
      throw new Error(
        `keyId uniqueness invariant violated: orgId=${orgId} keyId=${keyId} returned ${items.length} rows`,
      );
    }
    return items[0];
  }

  async function listOrgKeys(input: { orgId: string }): Promise<ListedKey[]> {
    // Sentinel: `attribute_exists(keyPrefix)` excludes the ORG envelope
    // (which has no keyPrefix). `active = :true` excludes revoked keys
    // — matches the count semantics used for limit enforcement.
    const result = await ddb.send(
      new QueryCommand({
        TableName: keysTableName,
        IndexName: ORG_ID_INDEX,
        KeyConditionExpression: "orgId = :orgId",
        FilterExpression: "attribute_exists(keyPrefix) AND active = :true",
        ExpressionAttributeValues: { ":orgId": input.orgId, ":true": true },
      }),
    );
    const out: ListedKey[] = [];
    for (const raw of (result.Items as ApiKeyRecord[] | undefined) ?? []) {
      if (typeof raw.keyId !== "string" || raw.keyId.length === 0) {
        // Defensive: backfill should have populated keyId on every row,
        // but if a row somehow lacks it, drop + log rather than ship
        // an unidentified key to the caller. Operator alarm via the
        // log line.
        logger.error("listOrgKeys: dropping key row missing keyId", {
          orgId: input.orgId,
          apiKeyHash: raw.apiKeyHash,
        });
        continue;
      }
      out.push({
        keyId: raw.keyId,
        keyPrefix: raw.keyPrefix,
        ...(raw.label !== undefined ? { label: raw.label } : {}),
        createdAt: raw.createdAt,
        lastUsedAt: raw.lastUsedAt,
        active: raw.active,
        products: raw.products,
      });
    }
    return out;
  }

  async function listAuditTail(input: {
    orgId: string;
    limit?: number;
  }): Promise<ListedAuditEvent[]> {
    const requestedLimit = input.limit ?? 10;
    const limit = Math.max(1, Math.min(requestedLimit, 50));
    const rows: AuditRecord[] = [];
    let exclusiveStartKey: QueryCommandInput["ExclusiveStartKey"] | undefined;
    let pagesRead = 0;

    do {
      const result = await ddb.send(
        new QueryCommand({
          TableName: auditTableName,
          KeyConditionExpression: "orgId = :orgId",
          ExpressionAttributeValues: { ":orgId": input.orgId },
          ScanIndexForward: false,
          Limit: AUDIT_QUERY_PAGE_SIZE,
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        }),
      );
      pagesRead += 1;
      for (const row of (result.Items as AuditRecord[] | undefined) ?? []) {
        if (KEY_AUDIT_ACTIONS.has(row.action)) {
          rows.push(row);
          if (rows.length >= limit) break;
        }
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (
      rows.length < limit &&
      exclusiveStartKey !== undefined &&
      pagesRead < AUDIT_QUERY_MAX_PAGES
    );

    if (rows.length < limit && exclusiveStartKey !== undefined) {
      logger.warn("listAuditTail: truncated before collecting requested key lifecycle events", {
        orgId: input.orgId,
        requestedLimit: limit,
        pagesRead,
      });
    }

    return rows.slice(0, limit).map((row) => {
      const [timestamp = row["timestamp#eventId"]] = row["timestamp#eventId"].split("#", 1);
      const metadata = publicAuditMetadata(row.metadata);
      return {
        action: row.action,
        actorId: row.actorId,
        timestamp,
        ...(metadata !== undefined ? { metadata } : {}),
        ...(row.ip !== undefined ? { ip: row.ip } : {}),
        ...(row.userAgent !== undefined ? { userAgent: row.userAgent } : {}),
      };
    });
  }

  /**
   * Read all usage rows partitioned under `oldApiKeyHash` that need
   * to be migrated to the new hash on rotate. Excludes the `REDIRECT`
   * scope (that's auth-rail metadata, not a counter — and a fresh
   * REDIRECT row gets written by rotate itself).
   *
   * Why this exists: the UsageCounterRecord table is partitioned by
   * apiKeyHash (the secret-derived hash), not by the stable keyId.
   * Rotation produces a new hash, so without migration the new key
   * would start each billing period at requestCount=0, dropping
   * `lastPushedCumulativeCount` (Lago metering anchor),
   * `pendingMeterEventIdentifier` / `pendingMeterTargetCumulativeCount`
   * (in-flight Lago push), and `warningEmailSent` / `limitEmailSent`
   * (threshold-email idempotency flags). That manifests as: (a) quota
   * refresh exploit — customer rotates mid-period to dodge the
   * quota; (b) Lago undercount — the next push's delta starts from
   * 0 instead of 900, double-counting from Lago's perspective; (c)
   * threshold-email re-fire when the new partition crosses 80% again.
   *
   * Stop-gap acknowledgment: the architecturally-clean fix is to
   * repartition UsageCounterRecord by keyId (which survives rotation
   * per ADR-036). That's a separate ticket — schema change + dual
   * write + backfill + cutover. Until that lands, rotateKey carries
   * the rows forward in the same atomic transaction.
   */
  async function loadUsageRowsForMigration(oldApiKeyHash: string): Promise<UsageCounterRecord[]> {
    // KeyConditionExpression on a DynamoDB sort key supports `=`, `<`,
    // `>`, `<=`, `>=`, `BETWEEN`, `begins_with` — but NOT `<>`. So we
    // pull every row for this partition and filter REDIRECT in-memory.
    // For a single key this is at most ~5 rows (products × current
    // period + REDIRECT) so the bandwidth cost is negligible.
    const result = await ddb.send(
      new QueryCommand({
        TableName: usageTableName,
        KeyConditionExpression: "apiKeyHash = :hash",
        ExpressionAttributeValues: { ":hash": oldApiKeyHash },
      }),
    );
    const items = (result.Items as UsageCounterRecord[] | undefined) ?? [];
    return items.filter((row) => row.scope !== REDIRECT_SCOPE);
  }

  async function rotateKey(input: RotateKeyInput): Promise<RotateKeyResult> {
    const existing = await findKeyByKeyId(input.orgId, input.keyId);
    if (!existing || existing.active !== true) {
      // Treat "not found" and "found but already revoked" identically
      // — neither is rotatable, and exposing the distinction leaks
      // revocation history to admin UIs that haven't fetched it yet.
      // The integration test suite pins both paths.
      return { status: "key_not_found" };
    }

    // Capture all derivable values once, OUTSIDE any retry boundary —
    // same idempotency model as createKey (see comment block there).
    // Token = auditEventId (fresh per Lambda invocation), NOT keyId,
    // because keyId is preserved across rotations and reusing it
    // would block legitimate consecutive rotations within DDB's 10-min
    // idempotency window.
    //
    // Token reuse across our outer retry loop is safe: per AWS docs,
    // a CANCELLED TransactWriteItems releases its token — the same
    // token may be passed in a subsequent TransactWriteItems request.
    // Only a SUCCESSFUL completion binds the token for 10 minutes.
    const now = input.now ?? new Date();
    const generated = generateRawKey();
    const auditEventId = ulid(now.getTime());
    const oldApiKeyHash = existing.apiKeyHash;
    const nowEpochSeconds = Math.floor(now.getTime() / 1000);
    const REDIRECT_GRACE_SECONDS = 300; // 5 min — matches auth.ts:437 reader
    const REDIRECT_TTL_SECONDS = 7_776_000; // 90 days — DDB TTL cleanup

    // Rebuild the new row from the OLD row's plan-snapshot fields so
    // a rotate doesn't silently drop entitlements that were attached
    // to the key (e.g., a starter key carrying `tier: "starter"` with
    // a snapshot of products+quotas; the envelope's tier may differ
    // mid-rotation, but the key is the auth boundary).
    const newKeyItem: ApiKeyRecord = {
      ...existing,
      apiKeyHash: generated.hash,
      keyPrefix: generated.prefix,
      // keyId preserved — survives rotation per ADR-036.
      // createdAt preserved — operators / customers care when the key
      //   came into existence, not when it was last re-issued.
      // rotatedAt is a separate, new field per the plan; do NOT
      //   overwrite createdAt with now (the legacy rotate-prod-key.ts
      //   script's createdAt = rotatedAt was a pre-existing data-
      //   fidelity bug; this new path does not repeat it).
      rotatedAt: now.toISOString(),
      lastUsedAt: null,
    };

    const auditItem = buildAuditTransactItem({
      tableName: auditTableName,
      orgId: input.orgId,
      action: "ROTATE",
      actorId: input.actorId,
      apiKeyHash: generated.hash,
      metadata: { keyId: input.keyId, oldApiKeyHash },
      now,
      eventId: auditEventId,
      ...(input.ip !== undefined ? { ip: input.ip } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    });

    // Outer retry loop. The Query → TransactWrite window is racy
    // against ANY concurrent writer of the OLD usage partition:
    //   * hot-path increments (auth.ts incrementUsage)
    //   * threshold-email worker claims/finalizes (quota-email.ts)
    //   * plan-transition row closes (lago-webhook-reconciliation.ts)
    // Every such writer bumps `version` (UsageCounterRecord.version
    // sentinel — see type doc). Our Delete CondExpr asserts version
    // matches what we read; a mismatch cancels the transaction and
    // we re-Query for the latest state.
    //
    // We also retry on `TransactionConflict` cancellations (DDB
    // surfaces this when two transactions touch the same item
    // simultaneously, distinct from `ConditionalCheckFailed`).
    for (let attempt = 0; attempt <= ROTATE_USAGE_RETRY_MAX; attempt++) {
      const oldUsageRows = await loadUsageRowsForMigration(oldApiKeyHash);

      // For each migrated usage row: Put under NEW hash with the FULL
      // snapshot we just read (requestCount, lastPushedCumulativeCount,
      // pending meter identifiers, warning/limit email flags,
      // lastUsedAt, ttl, version). Delete the OLD partition row with
      // a CondExpr asserting version matches our snapshot. ANY
      // concurrent writer (hot path, email worker, plan transition)
      // will have bumped version → CondExpr fails → outer retry.
      const usagePuts = oldUsageRows.map((row) => ({
        Put: {
          TableName: usageTableName,
          Item: { ...row, apiKeyHash: generated.hash },
          // The NEW partition is unreachable to anyone but rotateKey
          // until the transaction commits (the new keys row doesn't
          // exist yet, so resolveKeyRecord can't return it). A
          // collision here would indicate a hash reuse — alarm.
          ConditionExpression: "attribute_not_exists(apiKeyHash)",
        },
      }));
      const usageDeletes = oldUsageRows.map((row) => {
        const readVersion = row.version ?? 0;
        return {
          Delete: {
            TableName: usageTableName,
            Key: { apiKeyHash: row.apiKeyHash, scope: row.scope },
            // Single optimistic-concurrency sentinel: `version`. Every
            // writer that mutates this row MUST `ADD #version :one`
            // (see UsageCounterRecord.version doc + writer audit:
            // auth.ts incrementUsage, quota-email.ts claim/finalize/
            // release, lago-webhook-reconciliation.ts closePeriod).
            //
            // The `(attribute_not_exists(#v) AND :rv = :zero) OR
            // #v = :rv` form handles legacy pre-P1C.03 rows that
            // lack the field: if we read undefined → :rv = 0 → first
            // branch matches IFF the row STILL has no version
            // attribute at TransactWrite time. Any post-P1C.03 writer
            // touching the row will set/bump version → first branch
            // false (#v exists) AND second branch false (#v != 0) →
            // CondExpr fails → cancel → retry.
            ConditionExpression: "(attribute_not_exists(#v) AND :rv = :zero) OR #v = :rv",
            ExpressionAttributeNames: { "#v": "version" },
            ExpressionAttributeValues: { ":rv": readVersion, ":zero": 0 },
          },
        };
      });

      // Item layout (CancellationReasons indices follow this order):
      //   [0]                          Delete old key
      //   [1]                          Put new key
      //   [2]                          Put REDIRECT
      //   [3 .. 3+N)                   Put new usage rows           (N = oldUsageRows.length)
      //   [3+N .. 3+2N)                Delete old usage rows        (CondExpr on version)
      //   [3+2N]                       Audit
      const transactItems = [
        {
          Delete: {
            TableName: keysTableName,
            Key: { apiKeyHash: oldApiKeyHash },
            // Race guard: another rotate or revoke between our
            // findKeyByKeyId() and now would flip `active` or
            // remove the row. Fail the transaction; caller
            // retries or the user re-issues.
            ConditionExpression: "active = :true AND keyId = :keyId",
            ExpressionAttributeValues: { ":true": true, ":keyId": input.keyId },
          },
        },
        {
          Put: {
            TableName: keysTableName,
            Item: newKeyItem,
            ConditionExpression: "attribute_not_exists(apiKeyHash)",
          },
        },
        {
          Put: {
            TableName: usageTableName,
            Item: {
              apiKeyHash: oldApiKeyHash,
              scope: REDIRECT_SCOPE,
              newHash: generated.hash,
              authValidUntil: nowEpochSeconds + REDIRECT_GRACE_SECONDS,
              ttl: nowEpochSeconds + REDIRECT_TTL_SECONDS,
              revokedByRotateAt: now.toISOString(),
            },
            // Defense-in-depth — REDIRECT row for this old hash
            // shouldn't exist (each rotation produces a unique
            // hash, and DDB TTL eventually cleans up). A
            // collision would mean a hash reuse — alarm.
            ConditionExpression: "attribute_not_exists(apiKeyHash)",
          },
        },
        ...usagePuts,
        ...usageDeletes,
        auditItem,
      ];

      if (transactItems.length > TRANSACT_ITEM_LIMIT) {
        // Defensive — see TRANSACT_ITEM_LIMIT comment above. With
        // current schema we top out at ~14, so this fires only if a
        // future change adds many more usage scopes per key.
        throw new Error(
          `rotateKey TransactItems count ${transactItems.length} exceeds DDB limit ${TRANSACT_ITEM_LIMIT}`,
        );
      }

      // Per-attempt ClientRequestToken. Reusing the SAME token across
      // attempts with DIFFERENT TransactItems (which is what happens
      // when concurrent writers shift the snapshot) returns
      // `IdempotentParameterMismatch` per AWS docs — DDB treats the
      // second call as a contradicting replay of the first. Suffix
      // the attempt index so each TransactWrite has a fresh token
      // while keeping the audit eventId stable across attempts (the
      // audit row's sort key is deterministic regardless).
      //
      // Token format: `${auditEventId}-${attempt}`. auditEventId is
      // a 26-char ULID; suffix `-N` adds 2 chars (N is 0..3) →
      // 28 chars. Within DDB's 36-char ClientRequestToken limit and
      // matches the [A-Za-z0-9_-]+ pattern.
      const attemptToken = `${auditEventId}-${attempt}`;

      try {
        await ddb.send(
          new TransactWriteCommand({
            ClientRequestToken: attemptToken,
            TransactItems: transactItems,
          }),
        );
        return {
          status: "rotated",
          keyId: input.keyId,
          raw: generated.raw,
          keyPrefix: generated.prefix,
          createdAt: existing.createdAt,
          rotatedAt: now.toISOString(),
        };
      } catch (error) {
        if (error instanceof TransactionCanceledException) {
          const reasons = error.CancellationReasons ?? [];

          if (reasons[0]?.Code === "ConditionalCheckFailed") {
            // The OLD key row was revoked/rotated between findKeyByKeyId
            // and the transaction. Surface as not-found regardless of
            // attempt count — retrying won't help, the row is gone.
            return { status: "key_not_found" };
          }

          // Did a usage-row reason indicate a concurrent-writer race?
          // Indices [3 .. 3+2N). Two retryable codes:
          //   - `ConditionalCheckFailed` — version sentinel mismatch
          //   - `TransactionConflict`    — concurrent transaction on
          //     the same item; DDB surfaces this distinctly from
          //     CondExpr failures.
          const usageRangeStart = 3;
          const usageRangeEnd = usageRangeStart + 2 * oldUsageRows.length;
          const usageMigrationRaceLost = reasons
            .slice(usageRangeStart, usageRangeEnd)
            .some((r) => r?.Code === "ConditionalCheckFailed" || r?.Code === "TransactionConflict");

          if (usageMigrationRaceLost && attempt < ROTATE_USAGE_RETRY_MAX) {
            logger.warn("rotateKey: usage-row concurrency race; re-Querying and retrying", {
              orgId: input.orgId,
              keyId: input.keyId,
              attempt: attempt + 1,
              maxAttempts: ROTATE_USAGE_RETRY_MAX + 1,
              reasons: reasons.map((r) => r?.Code ?? null),
            });
            continue;
          }
        }
        logger.error("rotateKey TransactWriteItems failed", {
          orgId: input.orgId,
          keyId: input.keyId,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof TransactionCanceledException
            ? { cancellationReasons: error.CancellationReasons }
            : {}),
        });
        throw error;
      }
    }

    // Exhausted retries on usage-row collisions. Surface as 500
    // (the route handler converts thrown errors to 500). An alarm
    // here means traffic on a single key is so high that we can't
    // win the optimistic-concurrency race — that's a customer-scale
    // signal, not a bug; bump ROTATE_USAGE_RETRY_MAX or move to a
    // keyId-partitioned counter.
    logger.error("rotateKey: exhausted usage-row migration retries", {
      orgId: input.orgId,
      keyId: input.keyId,
      maxAttempts: ROTATE_USAGE_RETRY_MAX + 1,
    });
    throw new Error(
      `rotateKey: usage-row migration failed after ${ROTATE_USAGE_RETRY_MAX + 1} attempts`,
    );
  }

  async function revokeKey(input: RevokeKeyInput): Promise<RevokeKeyResult> {
    const existing = await findKeyByKeyId(input.orgId, input.keyId);
    if (!existing) {
      return { status: "key_not_found" };
    }
    if (existing.active === false) {
      // 409 surfaces idempotency to the UI clearly — "already revoked"
      // is distinct from "doesn't exist" so admin UIs can show "no-op".
      return { status: "already_revoked" };
    }

    const now = input.now ?? new Date();
    const auditEventId = ulid(now.getTime());

    const auditItem = buildAuditTransactItem({
      tableName: auditTableName,
      orgId: input.orgId,
      action: "REVOKE",
      actorId: input.actorId,
      apiKeyHash: existing.apiKeyHash,
      metadata: { keyId: input.keyId },
      now,
      eventId: auditEventId,
      ...(input.ip !== undefined ? { ip: input.ip } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    });

    try {
      await ddb.send(
        new TransactWriteCommand({
          ClientRequestToken: auditEventId,
          TransactItems: [
            {
              Update: {
                TableName: keysTableName,
                Key: { apiKeyHash: existing.apiKeyHash },
                UpdateExpression: "SET active = :false, revokedAt = :now",
                // Race guard: rejects an already-revoked-by-someone-else
                // re-revoke; caller maps this to 409 ALREADY_REVOKED.
                ConditionExpression: "active = :true AND keyId = :keyId",
                ExpressionAttributeValues: {
                  ":false": false,
                  ":true": true,
                  ":now": now.toISOString(),
                  ":keyId": input.keyId,
                },
              },
            },
            {
              Update: {
                TableName: keysTableName,
                Key: { apiKeyHash: getOrgEnvelopeKey(input.orgId) },
                UpdateExpression: "SET activeKeyCount = activeKeyCount - :one",
                // attribute_exists(apiKeyHash) rejects deleted-row upsert
                // (mirrors the createKey defense). activeKeyCount > 0
                // catches counter drift — a successful revoke can never
                // legitimately happen against an envelope reporting 0
                // active keys.
                ConditionExpression:
                  "attribute_exists(apiKeyHash) AND attribute_exists(activeKeyCount) AND activeKeyCount > :zero",
                ExpressionAttributeValues: { ":one": 1, ":zero": 0 },
              },
            },
            auditItem,
          ],
        }),
      );
    } catch (error) {
      // CancellationReasons indices:
      //   [0] Update key       — fails when key was revoked between find & tx (race)
      //   [1] Update envelope  — fails on counter drift (operator alarm)
      //   [2] Audit Put        — fails on duplicate eventId (idempotent retry)
      if (error instanceof TransactionCanceledException) {
        const reasons = error.CancellationReasons ?? [];
        if (
          reasons[0]?.Code === "ConditionalCheckFailed" &&
          reasons[1]?.Code !== "ConditionalCheckFailed"
        ) {
          return { status: "already_revoked" };
        }
      }
      logger.error("revokeKey TransactWriteItems failed", {
        orgId: input.orgId,
        keyId: input.keyId,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof TransactionCanceledException
          ? { cancellationReasons: error.CancellationReasons }
          : {}),
      });
      throw error;
    }

    return {
      status: "revoked",
      keyId: input.keyId,
      revokedAt: now.toISOString(),
    };
  }

  return { getOrgStatus, createKey, listOrgKeys, listAuditTail, rotateKey, revokeKey };
}
