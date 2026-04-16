import type { ProductConfig, Tier } from "./types.js";

export const PRODUCT_REGISTRY: Record<string, ProductConfig> = {
  address: {
    alias: "addresses",
    description: "G-NAF Australian address validation",
    retention_hours: 168,
    cache_ttl_seconds: 3600,
    update_cadence: "quarterly",
    ingestion: {
      mode: "single_file",
      required_file_suffix: "/all.ndjson.gz",
      required_mappings_key_prefix: "data/address/",
      phase1_shards: 1,
      phase1_replicas: 0,
      known_good_query: {
        kind: "address_contains",
        query: "9 ENDEAVOUR COURT COFFIN BAY SA 5607",
        expected_label_fragment: "9 ENDEAVOUR COURT",
      },
    },
  },
  abn: {
    alias: "abn-entities",
    description: "ABR business entity verification",
    retention_hours: 48,
    cache_ttl_seconds: 900,
    update_cadence: "daily",
  },
  lei: {
    alias: "lei-entities",
    description: "GLEIF Legal Entity Identifier lookup",
    retention_hours: 48,
    cache_ttl_seconds: 900,
    update_cadence: "daily",
  },
  cve: {
    alias: "cve-vulnerabilities",
    description: "NVD vulnerability intelligence",
    retention_hours: 24,
    cache_ttl_seconds: 300,
    update_cadence: "continuous",
  },
  patents: {
    alias: "au-patents",
    description: "IP Australia patent and trademark search",
    retention_hours: 168,
    cache_ttl_seconds: 3600,
    update_cadence: "periodic",
  },
} as const;

export interface PlanDefinition {
  stripePriceId: string | null;
  quotaPerProduct: number | null;
  rateLimit: number | null;
  products: string[];
  maxKeys: number;
  overagePerThousand: number | null;
}

export const PLANS: Record<Tier, PlanDefinition> = {
  free: {
    stripePriceId: null,
    quotaPerProduct: 5_000,
    rateLimit: 10,
    products: ["address"],
    maxKeys: 2,
    overagePerThousand: null,
  },
  starter: {
    stripePriceId: null,
    quotaPerProduct: 10_000,
    rateLimit: 50,
    products: ["address", "abn", "lei", "cve", "patents"],
    maxKeys: 5,
    overagePerThousand: 150,
  },
  growth: {
    stripePriceId: null,
    quotaPerProduct: 50_000,
    rateLimit: 100,
    products: ["address", "abn", "lei", "cve", "patents"],
    maxKeys: 20,
    overagePerThousand: 100,
  },
  enterprise: {
    stripePriceId: null,
    quotaPerProduct: null,
    rateLimit: null,
    products: ["address", "abn", "lei", "cve", "patents"],
    maxKeys: Number.MAX_SAFE_INTEGER,
    overagePerThousand: null,
  },
};

export const ERROR_CODES = {
  INVALID_API_KEY: { status: 401, message: "Invalid API key" },
  MISSING_API_KEY: { status: 401, message: "Missing X-Api-Key header" },
  RATE_LIMITED: { status: 429, message: "Rate limit exceeded" },
  QUOTA_EXCEEDED: { status: 429, message: "Monthly quota exceeded" },
  PRODUCT_NOT_ALLOWED: { status: 403, message: "Product not included in your plan" },
  INVALID_PARAMETERS: { status: 400, message: "Invalid request parameters" },
  NOT_FOUND: { status: 404, message: "Resource not found" },
  INTERNAL_ERROR: { status: 500, message: "Internal server error" },
} as const;
