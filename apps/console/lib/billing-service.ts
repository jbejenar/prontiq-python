import { LagoBillingClient, type BillingInvoice } from "./billing-lago.js";
import { getBillingServerEnv } from "./server-env.js";

export interface BillingSummary {
  orgId: string;
  canManageBilling: boolean;
  generatedAt: string;
  subscription: Awaited<ReturnType<LagoBillingClient["getSubscription"]>>;
  usage: Awaited<ReturnType<LagoBillingClient["getCurrentUsage"]>>;
  plans: Awaited<ReturnType<LagoBillingClient["listVisiblePlans"]>>;
  invoices: BillingInvoice[];
}

export function externalSubscriptionIdForOrg(orgId: string) {
  return `lago_sub_${orgId}`;
}

export function createBillingClient() {
  const env = getBillingServerEnv();
  return new LagoBillingClient({
    apiKey: env.lagoApiKey,
    baseUrl: env.lagoApiUrl,
    catalogEnv: env.billingCatalogEnv,
  });
}

export async function buildBillingSummary(input: {
  orgId: string;
  canManageBilling: boolean;
  client?: LagoBillingClient;
}): Promise<BillingSummary> {
  const client = input.client ?? createBillingClient();
  const externalSubscriptionId = externalSubscriptionIdForOrg(input.orgId);
  const [subscription, plans, invoices] = await Promise.all([
    client.getSubscription(externalSubscriptionId),
    client.listVisiblePlans(),
    client.listInvoices(input.orgId),
  ]);
  const usage = subscription
    ? await client.getCurrentUsage({
        externalCustomerId: input.orgId,
        externalSubscriptionId,
      })
    : null;

  return {
    orgId: input.orgId,
    canManageBilling: input.canManageBilling,
    generatedAt: new Date().toISOString(),
    subscription,
    usage,
    plans,
    invoices,
  };
}

export async function createCheckoutUrl(input: { orgId: string; client?: LagoBillingClient }) {
  const client = input.client ?? createBillingClient();
  return client.createCheckoutUrl(input.orgId);
}

export async function createInvoicePaymentUrl(input: {
  orgId: string;
  invoiceId: string;
  client?: LagoBillingClient;
}) {
  const client = input.client ?? createBillingClient();
  const invoices = await client.listInvoices(input.orgId);
  const invoice = invoices.find((item) => item.id === input.invoiceId);
  if (!invoice) {
    return null;
  }
  const payment = await client.createInvoicePaymentUrl(input.invoiceId);
  if (payment.externalCustomerId && payment.externalCustomerId !== input.orgId) {
    throw new Error("Lago invoice payment URL did not belong to the active organization.");
  }
  return payment.paymentUrl;
}
