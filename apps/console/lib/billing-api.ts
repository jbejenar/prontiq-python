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
  createInvoicePaymentUrl: (invoiceId: string) =>
    fetchJson<{ paymentUrl: string }>("/api/billing/invoices/payment-url", {
      method: "POST",
      body: JSON.stringify({ invoiceId }),
    }),
};
