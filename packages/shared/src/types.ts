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

export interface ApiKeyRecord {
  apiKey: string;
  ownerEmail: string;
  orgId: string;
  tier: Tier;
  products: string[];
  monthlyQuotaPerProduct: number;
  usage: Record<string, Record<string, number>>;
  active: boolean;
  lastSyncedFromUnkey: string;
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
  | "RATE_LIMIT_EXCEEDED"
  | "QUOTA_EXCEEDED"
  | "PRODUCT_NOT_ALLOWED"
  | "INVALID_PARAMETERS"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";
