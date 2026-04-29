import { PLANS, type PlanDefinition } from "./constants.js";
import type { EnforcementMode, LegacyTier, Tier } from "./types.js";

export interface CommercialProjectionInput {
  tier: Tier;
  products?: string[];
  quotaPerProduct?: number | null;
  enforcementMode?: EnforcementMode;
  rateLimit?: number | null;
  maxKeys?: number;
}

export interface EffectiveCommercialProjection {
  products: string[];
  quotaPerProduct: number | null;
  enforcementMode: EnforcementMode;
  rateLimit: number | null;
  maxKeys: number;
}

export function isLegacyTier(value: string): value is LegacyTier {
  return Object.prototype.hasOwnProperty.call(PLANS, value);
}

function fallbackPlan(tier: Tier): PlanDefinition {
  return isLegacyTier(tier) ? PLANS[tier] : PLANS.free;
}

function hasOwn(input: CommercialProjectionInput, key: keyof CommercialProjectionInput): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

export function resolveEffectiveCommercialProjection(
  input: CommercialProjectionInput,
): EffectiveCommercialProjection {
  const fallback = fallbackPlan(input.tier);
  return {
    products: Array.isArray(input.products) ? input.products : fallback.products,
    quotaPerProduct: hasOwn(input, "quotaPerProduct")
      ? (input.quotaPerProduct ?? null)
      : fallback.quotaPerProduct,
    enforcementMode: input.enforcementMode ?? fallback.enforcementMode,
    rateLimit: hasOwn(input, "rateLimit") ? (input.rateLimit ?? null) : fallback.rateLimit,
    maxKeys:
      typeof input.maxKeys === "number" && Number.isFinite(input.maxKeys) && input.maxKeys >= 0
        ? input.maxKeys
        : fallback.maxKeys,
  };
}
