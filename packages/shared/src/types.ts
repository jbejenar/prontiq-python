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
  createdAt: string;
  lastUsedAt: string | null;
}

export interface UsageCounterRecord {
  apiKeyHash: string;
  scope: string;
  requestCount: number;
  ttl: number;
  lastUsedAt?: string;
  lastPushedCumulativeCount: number;
  warningEmailSent?: boolean;
  limitEmailSent?: boolean;
  closed?: boolean;
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
  stripeCustomerId: string;
  ownerEmail: string;
  tier: "free";
  hasFirstKey: boolean;
  completedAt: string;
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
  ttl: number;
}

export type Tier = "free" | "starter" | "growth" | "enterprise";

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
