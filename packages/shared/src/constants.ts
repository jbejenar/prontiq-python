import type { EnforcementMode, LegacyTier, ProductConfig } from "./types.js";

export interface BillingEndpointDefinition {
  creditCost: number;
  displayName: string;
  familyDisplayName: string;
  meterEventName: string;
  product: string;
}

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
  includedCreditsPerMonth: number | null;
  enforcementMode: EnforcementMode;
  quotaPerProduct: number | null;
  rateLimit: number | null;
  products: string[];
  maxKeys: number;
  overagePerThousandCredits: number | null;
}

export const PLANS: Record<LegacyTier, PlanDefinition> = {
  free: {
    includedCreditsPerMonth: 10_000,
    enforcementMode: "hard_cap",
    quotaPerProduct: 10_000,
    rateLimit: 10,
    products: ["address"],
    maxKeys: 2,
    overagePerThousandCredits: null,
  },
  payg: {
    includedCreditsPerMonth: 0,
    enforcementMode: "uncapped_tracked",
    quotaPerProduct: null,
    rateLimit: 25,
    products: ["address"],
    maxKeys: 3,
    overagePerThousandCredits: 150,
  },
  starter: {
    includedCreditsPerMonth: 25_000,
    enforcementMode: "soft_overage",
    quotaPerProduct: 25_000,
    rateLimit: 50,
    products: ["address", "abn", "lei", "cve", "patents"],
    maxKeys: 5,
    overagePerThousandCredits: 150,
  },
  growth: {
    includedCreditsPerMonth: 100_000,
    enforcementMode: "soft_overage",
    quotaPerProduct: 100_000,
    rateLimit: 100,
    products: ["address", "abn", "lei", "cve", "patents"],
    maxKeys: 20,
    overagePerThousandCredits: 100,
  },
  max: {
    includedCreditsPerMonth: 500_000,
    enforcementMode: "soft_overage",
    quotaPerProduct: 500_000,
    rateLimit: 250,
    products: ["address", "abn", "lei", "cve", "patents"],
    maxKeys: 50,
    overagePerThousandCredits: 75,
  },
  enterprise: {
    includedCreditsPerMonth: null,
    enforcementMode: "uncapped_tracked",
    quotaPerProduct: null,
    rateLimit: null,
    products: ["address", "abn", "lei", "cve", "patents"],
    maxKeys: Number.MAX_SAFE_INTEGER,
    overagePerThousandCredits: null,
  },
};

export const BILLING_ENDPOINTS: Record<string, BillingEndpointDefinition> = {
  "address.autocomplete": {
    creditCost: 1,
    displayName: "Address Autocomplete",
    familyDisplayName: "Address API",
    meterEventName: "prontiq_address_requests",
    product: "address",
  },
  "address.enrich": {
    creditCost: 3,
    displayName: "Address Enrich",
    familyDisplayName: "Address API",
    meterEventName: "prontiq_address_requests",
    product: "address",
  },
  "address.lookup_postcode": {
    creditCost: 1,
    displayName: "Address Postcode Lookup",
    familyDisplayName: "Address API",
    meterEventName: "prontiq_address_requests",
    product: "address",
  },
  "address.lookup_suburb": {
    creditCost: 1,
    displayName: "Address Suburb Lookup",
    familyDisplayName: "Address API",
    meterEventName: "prontiq_address_requests",
    product: "address",
  },
  "address.reverse": {
    creditCost: 2,
    displayName: "Address Reverse",
    familyDisplayName: "Address API",
    meterEventName: "prontiq_address_requests",
    product: "address",
  },
  "address.validate": {
    creditCost: 1,
    displayName: "Address Validate",
    familyDisplayName: "Address API",
    meterEventName: "prontiq_address_requests",
    product: "address",
  },
} as const;

export function getBillingEndpointsForProduct(product: string): BillingEndpointDefinition[] {
  return Object.values(BILLING_ENDPOINTS).filter((definition) => definition.product === product);
}

export function getMeterEventNameForProduct(product: string): string | null {
  const endpoints = getBillingEndpointsForProduct(product);
  if (endpoints.length === 0) {
    return null;
  }

  const meterEventNames = new Set(endpoints.map((definition) => definition.meterEventName));
  if (meterEventNames.size !== 1) {
    throw new Error(
      `Product ${product} has inconsistent meterEventName values in BILLING_ENDPOINTS`,
    );
  }

  return endpoints[0]?.meterEventName ?? null;
}

export const BILLING_GRACE_PERIOD_TOTAL_DAYS = 14;
export const BILLING_GRACE_PERIOD_PAST_DUE_DAYS_REMAINING = 7;
export const DEFAULT_ACCOUNT_URL = "https://console.prontiq.dev";
export const DEFAULT_BILLING_URL = "https://console.prontiq.dev/billing";
export const EMAIL_SUPPRESSION_SOFT_BOUNCE_THRESHOLD = 3;
export const EMAIL_SUPPRESSION_SOFT_BOUNCE_WINDOW_DAYS = 30;
export const EMAIL_SUPPRESSION_BOUNCE_TTL_DAYS = 90;
export const QUOTA_WARNING_THRESHOLD_FRACTION = 0.8;
export const QUOTA_EMAIL_PENDING_LEASE_MINUTES = 15;

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
