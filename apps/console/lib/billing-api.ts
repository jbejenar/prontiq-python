import type {
  BillingInvoice,
  BillingPlan,
  BillingSubscription,
  BillingUsage,
} from "./billing-lago.js";

export interface BillingSummary {
  orgId: string;
  canManageBilling: boolean;
  generatedAt: string;
  subscription: BillingSubscription | null;
  usage: BillingUsage | null;
  plans: BillingPlan[];
  invoices: BillingInvoice[];
}

export interface BillingPlanChangeResult {
  currentPlanCode: string | null;
  downgradePlanDate: string | null;
  nextPlanCode: string | null;
  reconciliationState: "not_required" | "pending_lago_webhook";
  status: "accepted" | "noop" | "pending";
  targetPlanCode: string;
}

export class BillingApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "BillingApiError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isClerkReverificationHint(value: unknown) {
  if (!isRecord(value) || !isRecord(value.clerk_error)) return false;
  const clerkError = value.clerk_error;
  if (clerkError.type !== "forbidden" || clerkError.reason !== "reverification-error") {
    return false;
  }
  if (!isRecord(clerkError.metadata) || !isRecord(clerkError.metadata.reverification)) {
    return false;
  }
  const reverification = clerkError.metadata.reverification;
  return (
    typeof reverification.level === "string" && typeof reverification.afterMinutes === "number"
  );
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok && isClerkReverificationHint(body)) {
    return body as T;
  }
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : {};
    throw new BillingApiError(
      typeof error.message === "string" ? error.message : "Billing request failed.",
      typeof error.code === "string" ? error.code : "BILLING_API_ERROR",
      typeof error.status === "number" ? error.status : response.status,
    );
  }
  return body as T;
}

export const billingApi = {
  getSummary: () => fetchJson<BillingSummary>("/api/billing/summary"),
  createCheckout: (input: { intendedPlanCode?: string }) =>
    fetchJson<{ checkoutUrl: string; intendedPlanCode: string | null }>("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  changePlan: (input: { idempotencyKey: string; targetPlanCode: string }) =>
    fetchJson<BillingPlanChangeResult>("/api/billing/plan-change", {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ targetPlanCode: input.targetPlanCode }),
    }),
  createInvoicePaymentUrl: (invoiceId: string) =>
    fetchJson<{ paymentUrl: string }>("/api/billing/invoices/payment-url", {
      method: "POST",
      body: JSON.stringify({ invoiceId }),
    }),
};
