export interface ProductIngestionPolicy {
  mode: "manifest_files" | "single_file";
  required_file_suffix?: string;
  required_mappings_key_prefix?: string;
  phase1_shards?: number;
  phase1_replicas?: number;
  known_good_query?: {
    kind: "address_contains";
    query: string;
    expected_label_fragment: string;
  };
}

export interface ProductConfig {
  alias: string;
  description: string;
  retention_hours: number;
  cache_ttl_seconds: number;
  update_cadence: "quarterly" | "daily" | "continuous" | "periodic";
  ingestion?: ProductIngestionPolicy;
}

export interface ManifestV1 {
  manifest_version: 1;
  product: string;
  version: string;
  created_at: string;
  pipeline: {
    repo: string;
    commit: string;
    run_id: string;
  };
  source: {
    name: string;
    release: string;
    url: string;
  };
  files: ManifestFile[];
  total_records: number;
  index: {
    mappings_key: string;
    settings: {
      number_of_shards: number;
      number_of_replicas: number;
    };
  };
}

export interface ManifestV2 {
  manifest_version: 2;
  product: string;
  version: string;
  created_at: string;
  pipeline: {
    repo: string;
    commit: string;
    run_id: string;
  };
  source: {
    name: string;
    release: string;
    url: string;
  };
  files: ManifestFile[];
  total_records: number;
  index: {
    mappings_key: string;
    settings: {
      number_of_shards: number;
      number_of_replicas: number;
    };
    source_keys: string[];
  };
}

export type Manifest = ManifestV1 | ManifestV2;

export interface ManifestFile {
  key: string;
  records: number;
  bytes: number;
  sha256: string;
}

export interface ApiKeySubscriptionItems {
  [product: string]: string;
}

export interface ApiKeyRecord {
  apiKeyHash: string;
  /**
   * Stable opaque identifier (`key_<ulid>`) that survives rotation.
   * Required as of P1C.03 — backfill populates pre-existing rows.
   * `apiKeyHash` and `keyPrefix` change on rotate; `keyId` does not.
   */
  keyId: string;
  customerId?: string;
  keyPrefix: string;
  ownerEmail: string;
  orgId: string;
  tier: Tier;
  products: string[];
  quotaPerProduct: number | null;
  rateLimit: number | null;
  active: boolean;
  paymentOverdue: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionItems: ApiKeySubscriptionItems;
  lagoPlanCode?: string;
  lagoSubscriptionExternalId?: string | null;
  lagoSubscriptionStatus?: string | null;
  lagoPreviousPlanCode?: string | null;
  lagoNextPlanCode?: string | null;
  lagoDowngradePlanDate?: string | null;
  lagoPlanTransitionStatus?: string | null;
  billingPeriodStartedAt?: string | null;
  billingPeriodEndingAt?: string | null;
  billingPeriodKey?: string | null;
  lagoPaymentOverdueInvoiceId?: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  /** User-supplied display label, set at creation time. */
  label?: string;
  /** Clerk userId of the actor that created this key. */
  createdByActorId?: string;
  /**
   * ISO-8601 timestamp of the most recent rotation. Set on the new
   * row produced by `rotateKey` (the old row is deleted). `createdAt`
   * is preserved across rotation; `rotatedAt` is the separate
   * "issued-fresh" marker per ADR-036.
   */
  rotatedAt?: string;
  /**
   * ISO-8601 timestamp of revocation. Set when `revokeKey` flips
   * `active` to false. Distinct from absence-of-`active` (which
   * would mean a missing field, not "revoked").
   */
  revokedAt?: string;
}

export interface UsageCounterRecord {
  apiKeyHash: string;
  scope: string;
  /**
   * Current shipped semantics: family-level credits consumed for `{product}#{yearMonth}`.
   * Legacy name retained to avoid a breaking table/schema migration.
   */
  requestCount: number;
  ttl: number;
  lastUsedAt?: string;
  lastPushedCumulativeCount: number;
  pendingMeterEventIdentifier?: string;
  pendingMeterTargetCumulativeCount?: number;
  warningEmailSent?: boolean;
  limitEmailSent?: boolean;
  warningEmailPendingAt?: string;
  limitEmailPendingAt?: string;
  closed?: boolean;
  /**
   * Optimistic-concurrency sentinel. EVERY writer that mutates a usage
   * row MUST `ADD #version :one` to its UpdateExpression — without
   * exception. Used by `rotateKey` (P1C.03) to detect concurrent
   * mutations between its pre-tx Query and the migration TransactWrite:
   * the OLD-row Delete asserts `version = :rv` (or absent + 0) so any
   * racing writer cancels the transaction → outer retry re-Queries.
   *
   * Optional only because pre-P1C.03 rows lack the field; the
   * `attribute_not_exists(version)` branch in the rotate CondExpr
   * handles legacy rows. New writes (post-P1C.03) always bump it.
   *
   * Do NOT read this field for anything other than concurrency control.
   * It is not a meaningful number — just a monotonic counter.
   */
  version?: number;
}

export interface SesSuppressionRecord {
  email: string;
  reason: "hard_bounce" | "soft_bounce" | "complaint";
  bounceCount?: number;
  softBounceWindowStartedAt?: string;
  lastEventAt: string;
  ttl?: number;
}

export interface QuotaEmailTask {
  apiKeyHash: string;
  orgId: string;
  product: string;
  scope: string;
  threshold: "warning" | "limit";
}

export interface RedirectRecord {
  apiKeyHash: string;
  scope: "REDIRECT";
  newHash: string;
  authValidUntil: number;
  ttl: number;
  revokedByRotateAt?: string;
}

export interface OrgEnvelopeRecord {
  apiKeyHash: string;
  orgId?: string;
  /** Legacy P1B.14-P1B.21 identifier retained only on pre-pivot rows. */
  customerId?: string;
  stripeCustomerId: string | null;
  ownerEmail: string;
  tier: Tier;
  products: string[];
  paymentOverdue: boolean;
  stripeSubscriptionId: string | null;
  subscriptionItems: ApiKeySubscriptionItems;
  lagoPlanCode?: string;
  lagoSubscriptionExternalId?: string | null;
  lagoSubscriptionStatus?: string | null;
  lagoPreviousPlanCode?: string | null;
  lagoNextPlanCode?: string | null;
  lagoDowngradePlanDate?: string | null;
  lagoPlanTransitionStatus?: string | null;
  billingPeriodStartedAt?: string | null;
  billingPeriodEndingAt?: string | null;
  billingPeriodKey?: string | null;
  lagoPaymentOverdueInvoiceId?: string | null;
  hasFirstKey: boolean;
  completedAt: string;
  /**
   * Atomic count of `active === true` keys for this org. Maintained by
   * `/v1/account/keys/{create,revoke}` via TransactWriteItems with
   * `attribute_not_exists OR < :max` precondition for race-free
   * maxKeys enforcement. Treat absent as 0 on read; never decrement
   * below 0. Backfill populated this on every existing envelope in
   * P1C.03 PR 0.
   */
  activeKeyCount?: number;
}

export type CustomerStatus = "active" | "archived" | "migration_conflict";

export interface CustomerRecord {
  orgId: string;
  customerId: string;
  lagoExternalCustomerId: string;
  lagoCustomerId: string | null;
  stripeCustomerId: string | null;
  ownerEmail: string;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
  backfilledAt?: string;
  archivedAt?: string;
  conflictReason?: string;
  conflictMetadata?: Record<string, unknown>;
}

export interface AuditRecord {
  orgId: string;
  "timestamp#eventId": string;
  action: string;
  actorId: string;
  /**
   * Present for key-scoped events (CREATE / ROTATE / REVOKE) so audit
   * queries can filter by the affected key. Absent for org-scoped events
   * (e.g. ORG_PROVISIONED, UPGRADE / DOWNGRADE) where the action targets
   * the org envelope rather than a specific key. Writers populate this
   * via `buildAuditTransactItem({ apiKeyHash, ... })`.
   */
  apiKeyHash?: string;
  metadata?: Record<string, unknown>;
  /** Caller IP (X-Forwarded-For first hop) for key-management events. */
  ip?: string;
  /** Caller User-Agent for key-management events. */
  userAgent?: string;
  ttl: number;
}

export type Tier = "free" | "payg" | "starter" | "growth" | "max" | "enterprise";

/** The inner error object — used by middleware/handlers to construct errors */
export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  status: number;
  request_id: string;
  details?: Record<string, unknown>;
}

/** The full error response envelope — matches the wire format and apiErrorSchema */
export interface ApiErrorResponse {
  error: ApiErrorBody;
}

export type ErrorCode =
  | "INVALID_API_KEY"
  | "MISSING_API_KEY"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "PRODUCT_NOT_ALLOWED"
  | "INVALID_PARAMETERS"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";
