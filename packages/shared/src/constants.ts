import type { ProductConfig, Tier } from "./types.js";

export const PRODUCT_REGISTRY: Record<string, ProductConfig> = {
  address: {
    alias: "addresses",
    description: "G-NAF Australian address validation",
    retention_hours: 168,
    cache_ttl_seconds: 3600,
    update_cadence: "quarterly",
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

export const TIER_LIMITS: Record<Tier, { monthlyQuotaPerProduct: number; products: string[] }> = {
  free: {
    monthlyQuotaPerProduct: 5_000,
    products: ["address", "abn"],
  },
  starter: {
    monthlyQuotaPerProduct: 10_000,
    products: ["address", "abn", "lei", "cve", "patents"],
  },
  growth: {
    monthlyQuotaPerProduct: 50_000,
    products: ["address", "abn", "lei", "cve", "patents"],
  },
  enterprise: {
    monthlyQuotaPerProduct: Number.MAX_SAFE_INTEGER,
    products: ["address", "abn", "lei", "cve", "patents"],
  },
};

export const ERROR_CODES = {
  INVALID_API_KEY: { status: 401, message: "Invalid API key" },
  MISSING_API_KEY: { status: 401, message: "Missing X-Api-Key header" },
  RATE_LIMIT_EXCEEDED: { status: 429, message: "Rate limit exceeded" },
  QUOTA_EXCEEDED: { status: 429, message: "Monthly quota exceeded" },
  PRODUCT_NOT_ALLOWED: { status: 403, message: "Product not included in your plan" },
  INVALID_PARAMETERS: { status: 400, message: "Invalid request parameters" },
  NOT_FOUND: { status: 404, message: "Resource not found" },
  INTERNAL_ERROR: { status: 500, message: "Internal server error" },
} as const;
