export interface BillingPlan {
  code: string;
  name: string;
  description: string | null;
  interval: string | null;
  currency: string | null;
  amountCents: number | null;
  charges: BillingPlanCharge[];
}

export interface BillingPlanCharge {
  billableMetricCode: string | null;
  name: string | null;
  chargeModel: string | null;
  amountCents: number | null;
  amountDecimal: string | null;
  freeUnits: number | null;
  packageSize: number | null;
  pricingDescription: string | null;
}

export interface BillingSubscription {
  externalId: string;
  externalCustomerId: string;
  status: string;
  planCode: string;
  planName: string | null;
  currentBillingPeriodStartedAt: string | null;
  currentBillingPeriodEndingAt: string | null;
}

export interface BillingUsage {
  amountCents: number | null;
  currency: string | null;
  fromDatetime: string | null;
  toDatetime: string | null;
  chargesUsage: Array<{
    billableMetricCode: string | null;
    units: number | null;
    amountCents: number | null;
    freeUnits: number | null;
  }>;
}

export interface BillingInvoice {
  id: string;
  number: string | null;
  status: string;
  paymentStatus: string | null;
  totalAmountCents: number | null;
  currency: string | null;
  issuingDate: string | null;
  invoiceUrl: string | null;
}

export interface BillingInvoicePaymentUrl {
  paymentUrl: string;
  externalCustomerId: string | null;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class LagoBillingError extends Error {
  readonly code: string | null;
  readonly details: Readonly<Record<string, readonly string[]>>;
  readonly status: number;

  constructor(input: {
    code?: string | null;
    details?: Record<string, string[]>;
    message: string;
    status: number;
  }) {
    super(input.message);
    this.name = "LagoBillingError";
    this.code = input.code ?? null;
    this.details = input.details ?? {};
    this.status = input.status;
  }

  hasDetail(value: string) {
    return Object.values(this.details).some((items) => items.includes(value));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function getNumber(value: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    let cursor = value;
    for (const segment of path) {
      cursor = isRecord(cursor) ? cursor[segment] : undefined;
    }
    if (typeof cursor === "number" && Number.isFinite(cursor)) return cursor;
    if (typeof cursor === "string" && cursor.trim().length > 0) {
      const parsed = Number(cursor);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function getObject(value: unknown, paths: string[][]): Record<string, unknown> | null {
  for (const path of paths) {
    let cursor = value;
    for (const segment of path) {
      cursor = isRecord(cursor) ? cursor[segment] : undefined;
    }
    if (isRecord(cursor)) return cursor;
  }
  return null;
}

function getBoolean(metadata: Record<string, unknown>, key: string): boolean {
  const value = metadata[key];
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

function getArray(value: unknown, paths: string[][]): unknown[] {
  for (const path of paths) {
    let cursor = value;
    for (const segment of path) {
      cursor = isRecord(cursor) ? cursor[segment] : undefined;
    }
    if (Array.isArray(cursor)) return cursor;
  }
  return [];
}

function normalizeDecimalString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  return trimmed;
}

function decimalCurrencyToCents(value: unknown): number | null {
  const decimal = normalizeDecimalString(value);
  if (!decimal) return null;
  const isNegative = decimal.startsWith("-");
  const unsigned = isNegative ? decimal.slice(1) : decimal;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const paddedFraction = `${fraction}00`.slice(0, 3);
  const roundedCents =
    Number.parseInt(whole, 10) * 100 +
    Number.parseInt(paddedFraction.slice(0, 2), 10) +
    (Number.parseInt(paddedFraction[2] ?? "0", 10) >= 5 ? 1 : 0);
  return isNegative ? -roundedCents : roundedCents;
}

function tierDescription(chargeModel: string | null, value: unknown): string | null {
  const volumeRanges = getArray(value, [["properties", "volume_ranges"], ["properties", "volumeRanges"]]);
  if (volumeRanges.length > 0) return `${volumeRanges.length} volume pricing tiers configured in Lago`;

  const graduatedRanges = getArray(value, [
    ["properties", "graduated_ranges"],
    ["properties", "graduatedRanges"],
  ]);
  if (graduatedRanges.length > 0) return `${graduatedRanges.length} graduated pricing tiers configured in Lago`;

  if (chargeModel === "percentage") return "Percentage charge configured in Lago";
  return null;
}

function normalizeLagoApiUrl(value: string): string {
  const base = value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/v1$/, "");
  if (!base.startsWith("https://") && !base.startsWith("http://")) {
    throw new Error("LAGO_API_URL must include http:// or https://");
  }
  return `${base}/api/v1`;
}

function requireHttpsUrl(value: string, fieldName: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error(`Lago ${fieldName} response must be an https URL`);
  }
  return value;
}

function parseJsonPayload(text: string): unknown {
  if (text.length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Lago response was not valid JSON");
  }
}

function parseLagoErrorDetails(payload: unknown): Record<string, string[]> {
  const rawDetails = getObject(payload, [["error_details"]]);
  if (!rawDetails) return {};
  const details: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(rawDetails)) {
    if (Array.isArray(value)) {
      const items = value.filter((item): item is string => typeof item === "string");
      if (items.length > 0) details[key] = items;
      continue;
    }
    if (typeof value === "string" && value.length > 0) details[key] = [value];
  }
  return details;
}

function buildLagoBillingError(status: number, text: string) {
  let payload: unknown = {};
  if (text.length > 0) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      return new LagoBillingError({
        message: `Lago request failed with HTTP ${status}`,
        status,
      });
    }
  }
  const code = getString(payload, [["code"]]);
  const details = parseLagoErrorDetails(payload);
  return new LagoBillingError({
    code,
    details,
    message: `Lago request failed with HTTP ${status}${code ? ` (${code})` : ""}`,
    status,
  });
}

function parsePlanCharge(value: unknown): BillingPlanCharge {
  const chargeModel = getString(value, [["charge_model"], ["model"]]);
  const amountDecimal = normalizeDecimalString(getObject(value, [["properties"]])?.amount);
  return {
    billableMetricCode: getString(value, [["billable_metric", "code"], ["billable_metric_code"], ["code"]]),
    name: getString(value, [
      ["invoice_display_name"],
      ["billable_metric", "name"],
      ["name"],
    ]),
    chargeModel,
    amountCents:
      getNumber(value, [["amount_cents"], ["properties", "amount_cents"]]) ??
      decimalCurrencyToCents(amountDecimal),
    amountDecimal,
    freeUnits: getNumber(value, [["properties", "free_units"], ["properties", "freeUnits"]]),
    packageSize: getNumber(value, [
      ["properties", "package_size"],
      ["properties", "packageSize"],
      ["properties", "units"],
    ]),
    pricingDescription: tierDescription(chargeModel, value),
  };
}

function parsePlan(value: unknown): BillingPlan | null {
  const code = getString(value, [["code"]]);
  const name = getString(value, [["name"]]);
  if (!code || !name) return null;
  const charges = isRecord(value) ? asArray(value.charges) : [];
  return {
    code,
    name,
    description: getString(value, [["description"]]),
    interval: getString(value, [["interval"]]),
    currency: getString(value, [["amount_currency"], ["currency"]]),
    amountCents: getNumber(value, [["amount_cents"], ["amountCents"]]),
    charges: charges.map(parsePlanCharge),
  };
}

function planMetadata(value: unknown): Record<string, unknown> {
  return getObject(value, [["metadata"]]) ?? {};
}

function isVisiblePlan(value: unknown, catalogEnv: "dev" | "prod" | "all") {
  const metadata = planMetadata(value);
  if (!getBoolean(metadata, "prontiq_console_visible")) return false;
  if (getBoolean(metadata, "prontiq_test") || getBoolean(metadata, "prontiq_internal")) return false;

  const metadataEnv = metadata.prontiq_environment;
  if (typeof metadataEnv !== "string" || metadataEnv.length === 0) return true;
  return metadataEnv === "all" || metadataEnv === catalogEnv || catalogEnv === "all";
}

function parseSubscription(payload: unknown): BillingSubscription | null {
  const subscription = isRecord(payload) && isRecord(payload.subscription) ? payload.subscription : payload;
  const externalId = getString(subscription, [["external_id"], ["external_subscription_id"]]);
  const externalCustomerId = getString(subscription, [
    ["external_customer_id"],
    ["customer", "external_id"],
  ]);
  const planCode = getString(subscription, [["plan_code"], ["plan", "code"]]);
  if (!externalId || !externalCustomerId || !planCode) return null;
  return {
    externalId,
    externalCustomerId,
    status: getString(subscription, [["status"]]) ?? "unknown",
    planCode,
    planName: getString(subscription, [["plan", "name"]]),
    currentBillingPeriodStartedAt: getString(subscription, [
      ["current_billing_period_started_at"],
      ["current_billing_period_starts_at"],
    ]),
    currentBillingPeriodEndingAt: getString(subscription, [
      ["current_billing_period_ending_at"],
      ["current_billing_period_ends_at"],
    ]),
  };
}

function parseUsage(payload: unknown): BillingUsage | null {
  const usage = isRecord(payload) && isRecord(payload.customer_usage) ? payload.customer_usage : payload;
  if (!isRecord(usage)) return null;
  const chargesUsage = asArray(usage.charges_usage).filter(isRecord).map((charge) => ({
    billableMetricCode: getString(charge, [
      ["billable_metric", "code"],
      ["billable_metric_code"],
      ["code"],
    ]),
    units: getNumber(charge, [["units"], ["current_usage_units"]]),
    amountCents: getNumber(charge, [["amount_cents"], ["current_usage_amount_cents"]]),
    freeUnits: getNumber(charge, [["free_units"], ["properties", "free_units"]]),
  }));
  return {
    amountCents: getNumber(usage, [["amount_cents"], ["total_amount_cents"]]),
    currency: getString(usage, [["currency"]]),
    fromDatetime: getString(usage, [["from_datetime"], ["fromDateTime"]]),
    toDatetime: getString(usage, [["to_datetime"], ["toDateTime"]]),
    chargesUsage,
  };
}

function parseInvoice(value: unknown): BillingInvoice | null {
  const id = getString(value, [["lago_id"], ["id"]]);
  if (!id) return null;
  return {
    id,
    number: getString(value, [["number"]]),
    status: getString(value, [["status"]]) ?? "unknown",
    paymentStatus: getString(value, [["payment_status"], ["paymentStatus"]]),
    totalAmountCents: getNumber(value, [["total_amount_cents"], ["totalAmountCents"]]),
    currency: getString(value, [["currency"]]),
    issuingDate: getString(value, [["issuing_date"], ["created_at"]]),
    invoiceUrl: getString(value, [["file_url"], ["invoice_url"]]),
  };
}

export class LagoBillingClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly catalogEnv: "dev" | "prod" | "all";
  private readonly fetchImpl: typeof fetch;

  constructor(input: {
    apiKey: string;
    baseUrl: string;
    catalogEnv: "dev" | "prod" | "all";
    fetchImpl?: typeof fetch;
  }) {
    this.apiKey = input.apiKey;
    this.baseUrl = normalizeLagoApiUrl(input.baseUrl);
    this.catalogEnv = input.catalogEnv;
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  private async request(path: string, init: RequestInit = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    const text = await response.text();
    if (!response.ok) {
      throw buildLagoBillingError(response.status, text);
    }
    return parseJsonPayload(text);
  }

  async listVisiblePlans(): Promise<BillingPlan[]> {
    const payload = await this.request("/plans");
    const rawPlans = isRecord(payload) ? asArray(payload.plans) : [];
    return rawPlans.filter((plan) => isVisiblePlan(plan, this.catalogEnv)).flatMap((plan) => {
      const parsed = parsePlan(plan);
      return parsed ? [parsed] : [];
    });
  }

  async getSubscription(externalSubscriptionId: string): Promise<BillingSubscription | null> {
    const payload = await this.request(`/subscriptions/${encodeURIComponent(externalSubscriptionId)}`);
    return payload ? parseSubscription(payload) : null;
  }

  async getCurrentUsage(input: {
    externalCustomerId: string;
    externalSubscriptionId: string;
  }): Promise<BillingUsage | null> {
    const params = new URLSearchParams({
      external_subscription_id: input.externalSubscriptionId,
    });
    const payload = await this.request(
      `/customers/${encodeURIComponent(input.externalCustomerId)}/current_usage?${params.toString()}`,
    );
    return payload ? parseUsage(payload) : null;
  }

  async listInvoices(externalCustomerId: string): Promise<BillingInvoice[]> {
    const params = new URLSearchParams({
      external_customer_id: externalCustomerId,
      per_page: "10",
    });
    const payload = await this.request(`/invoices?${params.toString()}`);
    const rawInvoices = isRecord(payload) ? asArray(payload.invoices) : [];
    return rawInvoices.flatMap((invoice) => {
      const parsed = parseInvoice(invoice);
      return parsed ? [parsed] : [];
    });
  }

  async createCheckoutUrl(externalCustomerId: string): Promise<string> {
    const payload = await this.request(
      `/customers/${encodeURIComponent(externalCustomerId)}/checkout_url`,
      { method: "POST" },
    );
    const checkoutUrl = getString(payload, [["checkout_url"], ["customer", "checkout_url"]]);
    if (!checkoutUrl) throw new Error("Lago checkout URL response was missing checkout_url");
    return requireHttpsUrl(checkoutUrl, "checkout_url");
  }

  async createInvoicePaymentUrl(invoiceId: string): Promise<BillingInvoicePaymentUrl> {
    const payload = await this.request(`/invoices/${encodeURIComponent(invoiceId)}/payment_url`, {
      method: "POST",
    });
    const paymentUrl = getString(payload, [
      ["invoice_payment_details", "payment_url"],
      ["payment_url"],
      ["invoice", "payment_url"],
    ]);
    if (!paymentUrl) throw new Error("Lago invoice payment URL response was missing payment_url");
    return {
      paymentUrl: requireHttpsUrl(paymentUrl, "payment_url"),
      externalCustomerId: getString(payload, [
        ["invoice_payment_details", "external_customer_id"],
        ["external_customer_id"],
        ["invoice", "external_customer_id"],
        ["invoice", "customer", "external_id"],
      ]),
    };
  }
}
