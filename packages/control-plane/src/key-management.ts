import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  PLANS,
  generateKey,
  type ApiKeyRecord,
  type OrgEnvelopeRecord,
} from "@prontiq/shared";
import { monotonicFactory } from "ulid";
import { buildAuditTransactItem } from "./audit.js";

const ulid = monotonicFactory();
const ORG_ID_INDEX = "orgId-index";
const ENVELOPE_PREFIX = "ORG#";

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
  if (envelope.billingPeriodKey !== undefined) snapshot.billingPeriodKey = envelope.billingPeriodKey;
  if (envelope.lagoPaymentOverdueInvoiceId !== undefined)
    snapshot.lagoPaymentOverdueInvoiceId = envelope.lagoPaymentOverdueInvoiceId;
  return snapshot;
}

export interface KeyManagementDependencies {
  ddb: DynamoDBDocumentClient;
  keysTableName: string;
  auditTableName: string;
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

export interface ListedKey {
  keyId: string;
  keyPrefix: string;
  label?: string;
  createdAt: string;
  lastUsedAt: string | null;
  active: boolean;
  products: string[];
}

export interface KeyManagementService {
  createKey(input: CreateKeyInput): Promise<CreateKeyResult>;
  listOrgKeys(input: { orgId: string }): Promise<ListedKey[]>;
}

export function getOrgEnvelopeKey(orgId: string): string {
  return `${ENVELOPE_PREFIX}${orgId}`;
}

export function createKeyManagementService(
  deps: KeyManagementDependencies,
): KeyManagementService {
  const { ddb, keysTableName, auditTableName } = deps;
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

  return { createKey, listOrgKeys };
}
