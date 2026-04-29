import { createHash } from "node:crypto";
import { PRODUCT_REGISTRY, getMeterEventNameForProduct, type EnforcementMode } from "@prontiq/shared";

export interface LagoSubscriptionProjectionSnapshot {
  externalCustomerId: string;
  externalSubscriptionId: string;
  planCode: string;
  status: string;
  previousPlanCode?: string | null;
  nextPlanCode?: string | null;
  downgradePlanDate?: string | null;
  billingPeriodStartedAt: string | null;
  billingPeriodEndingAt: string | null;
  metadata?: Record<string, unknown>;
}

export interface LagoSubscriptionCharge {
  code?: string;
  billableMetricCode?: string;
  chargeModel?: string;
  properties?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface LagoSubscriptionEntitlement {
  featureCode: string;
  privileges: Record<string, unknown>;
}

export interface LagoEntitlementProjection {
  products: string[];
  quotaPerProduct: number | null;
  enforcementMode: EnforcementMode;
  rateLimit: number | null;
  maxKeys: number;
  lagoEntitlementsHash: string;
}

export type LagoEntitlementProjectionResult =
  | { status: "projected"; projection: LagoEntitlementProjection }
  | { status: "drift"; reason: string };

export interface LagoEntitlementsClient {
  getSubscription(externalSubscriptionId: string): Promise<LagoSubscriptionProjectionSnapshot | null>;
  getSubscriptionCharges(externalSubscriptionId: string): Promise<LagoSubscriptionCharge[]>;
  getSubscriptionEntitlements(
    externalSubscriptionId: string,
  ): Promise<LagoSubscriptionEntitlement[]>;
}

const ADDRESS_PRODUCT = "address";
const ADDRESS_FEATURE = "address_api";
const API_KEYS_FEATURE = "api_keys";
const ADDRESS_METRIC = getMeterEventNameForProduct(ADDRESS_PRODUCT) ?? "prontiq_address_requests";
const DEFAULT_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLagoApiUrl(value: string): string {
  const trimmed = value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/v1$/, "");
  if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) {
    throw new Error("LAGO_API_URL must include http:// or https://");
  }
  return `${trimmed}/api/v1`;
}

function getString(value: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    let cursor = value;
    for (const segment of path) {
      cursor = isRecord(cursor) ? cursor[segment] : undefined;
    }
    if (typeof cursor === "string" && cursor.length > 0) return cursor;
  }
  return null;
}

function getObject(value: unknown, paths: string[][]): Record<string, unknown> | undefined {
  for (const path of paths) {
    let cursor = value;
    for (const segment of path) {
      cursor = isRecord(cursor) ? cursor[segment] : undefined;
    }
    if (isRecord(cursor)) return cursor;
  }
  return undefined;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toInteger(value: unknown): number | null {
  const numberValue = toFiniteNumber(value);
  if (numberValue == null || !Number.isInteger(numberValue) || numberValue < 0) return null;
  return numberValue;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
}

function readPrivilege(
  entitlements: LagoSubscriptionEntitlement[],
  featureCode: string,
  privilegeCode: string,
): unknown {
  return entitlements.find((item) => item.featureCode === featureCode)?.privileges[privilegeCode];
}

function readMetadataValue(metadata: Record<string, unknown> | undefined, key: string): unknown {
  return metadata?.[key] ?? metadata?.[`prontiq_${key}`];
}

function readRequiredPositiveIntegerEntitlementOrMetadata(input: {
  entitlements: LagoSubscriptionEntitlement[];
  featureCode: string;
  privilegeCode: string;
  metadata?: Record<string, unknown>;
  metadataKey: string;
}): number | null {
  const privilegeValue = readPrivilege(input.entitlements, input.featureCode, input.privilegeCode);
  const metadataValue = readMetadataValue(input.metadata, input.metadataKey);
  const rawValue = privilegeValue ?? metadataValue;
  const numberValue = toFiniteNumber(rawValue);
  if (numberValue == null || !Number.isInteger(numberValue) || numberValue <= 0) return null;
  return numberValue;
}

function readIntegerEntitlementOrMetadata(input: {
  entitlements: LagoSubscriptionEntitlement[];
  featureCode: string;
  privilegeCode: string;
  metadata?: Record<string, unknown>;
  metadataKey: string;
}): number | null {
  return (
    toInteger(readPrivilege(input.entitlements, input.featureCode, input.privilegeCode)) ??
    toInteger(readMetadataValue(input.metadata, input.metadataKey))
  );
}

function chargeMetricCode(charge: LagoSubscriptionCharge): string | null {
  return charge.billableMetricCode ?? charge.code ?? null;
}

function includedUnitsFromPackageCharge(charge: LagoSubscriptionCharge): number | null {
  const props = charge.properties ?? {};
  return (
    toInteger(props.free_units) ??
    toInteger(props.freeUnits) ??
    toInteger(props.package_size) ??
    toInteger(props.packageSize) ??
    toInteger(props.units)
  );
}

function normalizeEnforcementMode(value: unknown): EnforcementMode | null {
  if (value === "hard_cap" || value === "soft_overage" || value === "uncapped_tracked") {
    return value;
  }
  return null;
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(normalizeForHash)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeForHash(entry)]),
  );
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(normalizeForHash(value))).digest("hex");
}

function readLagoPrivileges(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (!Array.isArray(value)) return undefined;
  const privileges = Object.fromEntries(
    value
      .filter(isRecord)
      .flatMap((privilege) => {
        const code = getString(privilege, [["code"]]);
        return code ? [[code, privilege.value]] : [];
      }),
  );
  return Object.keys(privileges).length > 0 ? privileges : undefined;
}

export function buildBillingPeriodKeyFromProjection(
  snapshot: LagoSubscriptionProjectionSnapshot,
): string | null {
  if (!snapshot.billingPeriodStartedAt || !snapshot.billingPeriodEndingAt) return null;
  return `${snapshot.billingPeriodStartedAt.slice(0, 10)}_${snapshot.billingPeriodEndingAt.slice(0, 10)}`;
}

export function projectLagoEntitlements(input: {
  snapshot: LagoSubscriptionProjectionSnapshot;
  charges: LagoSubscriptionCharge[];
  entitlements: LagoSubscriptionEntitlement[];
}): LagoEntitlementProjectionResult {
  const addressCharges = input.charges.filter((charge) => chargeMetricCode(charge) === ADDRESS_METRIC);
  if (addressCharges.length !== 1) {
    return {
      status: "drift",
      reason: `expected exactly one ${ADDRESS_METRIC} charge, found ${addressCharges.length}`,
    };
  }

  const addressEnabled =
    readBoolean(readPrivilege(input.entitlements, ADDRESS_FEATURE, "enabled")) ??
    readBoolean(readMetadataValue(input.snapshot.metadata, "address_api_enabled")) ??
    true;
  const products = addressEnabled ? [ADDRESS_PRODUCT] : [];
  const unknownProducts = products.filter((product) => PRODUCT_REGISTRY[product] === undefined);
  if (unknownProducts.length > 0) {
    return { status: "drift", reason: `unknown projected products: ${unknownProducts.join(",")}` };
  }

  const maxKeys = readIntegerEntitlementOrMetadata({
    entitlements: input.entitlements,
    featureCode: API_KEYS_FEATURE,
    privilegeCode: "max",
    metadata: input.snapshot.metadata,
    metadataKey: "max_keys",
  });
  if (maxKeys == null || maxKeys < 0) {
    return { status: "drift", reason: "missing api_keys.max entitlement" };
  }

  const rateLimit = addressEnabled
    ? readRequiredPositiveIntegerEntitlementOrMetadata({
        entitlements: input.entitlements,
        featureCode: ADDRESS_FEATURE,
        privilegeCode: "rate_limit_per_second",
        metadata: input.snapshot.metadata,
        metadataKey: "rate_limit_per_second",
      })
    : null;
  if (addressEnabled && rateLimit == null) {
    return {
      status: "drift",
      reason: "missing or invalid address_api.rate_limit_per_second entitlement",
    };
  }

  const explicitQuota = readIntegerEntitlementOrMetadata({
    entitlements: input.entitlements,
    featureCode: ADDRESS_FEATURE,
    privilegeCode: "monthly_quota",
    metadata: input.snapshot.metadata,
    metadataKey: "monthly_quota",
  });
  const explicitMode =
    normalizeEnforcementMode(
      readPrivilege(input.entitlements, ADDRESS_FEATURE, "enforcement_mode") ??
        readMetadataValue(input.snapshot.metadata, "enforcement_mode"),
    ) ?? undefined;

  const charge = addressCharges[0];
  if (!charge) return { status: "drift", reason: "missing address charge" };
  const chargeModel = charge.chargeModel;
  if (chargeModel !== "package" && chargeModel !== "standard") {
    return { status: "drift", reason: `unsupported charge model ${chargeModel ?? "unknown"}` };
  }

  const packageIncludedUnits = chargeModel === "package" ? includedUnitsFromPackageCharge(charge) : null;
  const quotaPerProduct = explicitQuota ?? packageIncludedUnits;
  const enforcementMode: EnforcementMode =
    explicitMode ?? (chargeModel === "standard" && quotaPerProduct == null ? "uncapped_tracked" : "hard_cap");

  if (enforcementMode !== "uncapped_tracked" && (quotaPerProduct == null || quotaPerProduct < 0)) {
    return { status: "drift", reason: "capped plan is missing monthly quota" };
  }
  if (enforcementMode === "uncapped_tracked" && quotaPerProduct != null) {
    return { status: "drift", reason: "uncapped plan unexpectedly has monthly quota" };
  }

  return {
    status: "projected",
    projection: {
      products,
      quotaPerProduct: enforcementMode === "uncapped_tracked" ? null : quotaPerProduct,
      enforcementMode,
      rateLimit,
      maxKeys,
      lagoEntitlementsHash: stableHash({
        planCode: input.snapshot.planCode,
        charges: input.charges,
        entitlements: input.entitlements,
        metadata: input.snapshot.metadata,
      }),
    },
  };
}

export class HttpLagoEntitlementsClient implements LagoEntitlementsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(input: {
    apiKey: string;
    baseUrl: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.apiKey = input.apiKey;
    this.baseUrl = normalizeLagoApiUrl(input.baseUrl);
    this.fetchImpl = input.fetchImpl ?? fetch;
    this.timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async get(path: string): Promise<unknown | null> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      method: "GET",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status === 404) return null;
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : {};
    if (!response.ok) throw new Error(`Lago request failed with HTTP ${response.status}`);
    return payload;
  }

  private async getSubscriptionPayload(externalSubscriptionId: string): Promise<Record<string, unknown> | null> {
    const payload = await this.get(`/subscriptions/${encodeURIComponent(externalSubscriptionId)}`);
    if (!payload) return null;
    const subscription =
      isRecord(payload) && isRecord(payload.subscription) ? payload.subscription : payload;
    return isRecord(subscription) ? subscription : null;
  }

  async getSubscription(
    externalSubscriptionId: string,
  ): Promise<LagoSubscriptionProjectionSnapshot | null> {
    const subscription = await this.getSubscriptionPayload(externalSubscriptionId);
    if (!subscription) return null;
    const externalCustomerId = getString(subscription, [["customer", "external_id"], ["external_customer_id"]]);
    const externalSubscriptionIdFromResponse = getString(subscription, [["external_id"], ["external_subscription_id"]]);
    const planCode = getString(subscription, [["plan_code"], ["plan", "code"]]);
    if (!externalCustomerId || !externalSubscriptionIdFromResponse || !planCode) {
      throw new Error("Lago subscription response is missing required identifiers");
    }
    return {
      externalCustomerId,
      externalSubscriptionId: externalSubscriptionIdFromResponse,
      planCode,
      status: getString(subscription, [["status"]]) ?? "unknown",
      previousPlanCode: getString(subscription, [["previous_plan", "code"], ["previous_plan_code"]]),
      nextPlanCode: getString(subscription, [["next_plan", "code"], ["next_plan_code"]]),
      downgradePlanDate: getString(subscription, [["downgrade_plan_date"]]),
      billingPeriodStartedAt: getString(subscription, [
        ["current_billing_period_started_at"],
        ["current_billing_period_starts_at"],
      ]),
      billingPeriodEndingAt: getString(subscription, [
        ["current_billing_period_ending_at"],
        ["current_billing_period_ends_at"],
      ]),
      metadata: getObject(subscription, [["metadata"], ["plan", "metadata"]]),
    };
  }

  async getSubscriptionCharges(externalSubscriptionId: string): Promise<LagoSubscriptionCharge[]> {
    const subscription = await this.getSubscriptionPayload(externalSubscriptionId);
    const rawCharges =
      subscription && isRecord(subscription.plan) && Array.isArray(subscription.plan.charges)
        ? subscription.plan.charges
        : subscription && Array.isArray(subscription.charges)
          ? subscription.charges
          : [];
    return rawCharges.filter(isRecord).map((charge) => ({
      code: getString(charge, [["billable_metric", "code"], ["billable_metric_code"], ["code"]]) ?? undefined,
      billableMetricCode: getString(charge, [["billable_metric", "code"], ["billable_metric_code"]]) ?? undefined,
      chargeModel: getString(charge, [["charge_model"], ["model"]]) ?? undefined,
      properties: getObject(charge, [["properties"]]),
      metadata: getObject(charge, [["metadata"]]),
    }));
  }

  async getSubscriptionEntitlements(
    externalSubscriptionId: string,
  ): Promise<LagoSubscriptionEntitlement[]> {
    const payload = await this.get(`/subscriptions/${encodeURIComponent(externalSubscriptionId)}/entitlements`);
    const raw = isRecord(payload) && Array.isArray(payload.entitlements) ? payload.entitlements : [];
    return raw.filter(isRecord).flatMap((item): LagoSubscriptionEntitlement[] => {
      const featureCode = getString(item, [["feature", "code"], ["feature_code"], ["code"]]);
      const privileges =
        readLagoPrivileges(item.privileges) ??
        getObject(item, [["values"]]) ??
        getObject(item, [["metadata"]]) ??
        {};
      return featureCode ? [{ featureCode, privileges }] : [];
    });
  }
}
