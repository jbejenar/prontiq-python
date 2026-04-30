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

export interface BillingPlanChangeResult {
  currentPlanCode: string | null;
  downgradePlanDate: string | null;
  nextPlanCode: string | null;
  reconciliationState: "not_required" | "pending_lago_webhook";
  status: "accepted" | "noop" | "pending";
  targetPlanCode: string;
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

export async function changeBillingPlan(input: {
  orgId: string;
  targetPlanCode: string;
  client?: LagoBillingClient;
}): Promise<BillingPlanChangeResult> {
  const client = input.client ?? createBillingClient();
  const externalSubscriptionId = externalSubscriptionIdForOrg(input.orgId);
  const [subscription, plans] = await Promise.all([
    client.getSubscription(externalSubscriptionId),
    client.listVisiblePlans(),
  ]);
  if (!plans.some((plan) => plan.code === input.targetPlanCode)) {
    throw new Error("TARGET_PLAN_NOT_AVAILABLE");
  }
  if (!subscription) {
    throw new Error("SUBSCRIPTION_NOT_FOUND");
  }
  if (subscription.nextPlanCode && subscription.nextPlanCode !== input.targetPlanCode) {
    throw new Error("PLAN_CHANGE_ALREADY_PENDING");
  }
  if (subscription.nextPlanCode === input.targetPlanCode) {
    return {
      currentPlanCode: subscription.planCode,
      downgradePlanDate: subscription.downgradePlanDate,
      nextPlanCode: subscription.nextPlanCode,
      reconciliationState: "pending_lago_webhook",
      status: "pending",
      targetPlanCode: input.targetPlanCode,
    };
  }
  if (subscription.planCode === input.targetPlanCode) {
    return {
      currentPlanCode: subscription.planCode,
      downgradePlanDate: subscription.downgradePlanDate,
      nextPlanCode: subscription.nextPlanCode,
      reconciliationState: "not_required",
      status: "noop",
      targetPlanCode: input.targetPlanCode,
    };
  }

  const changed = await client.changeSubscriptionPlan({
    externalCustomerId: input.orgId,
    externalSubscriptionId,
    targetPlanCode: input.targetPlanCode,
  });
  return {
    currentPlanCode: changed.planCode,
    downgradePlanDate: changed.downgradePlanDate,
    nextPlanCode: changed.nextPlanCode,
    reconciliationState: "pending_lago_webhook",
    status: changed.nextPlanCode ? "pending" : "accepted",
    targetPlanCode: input.targetPlanCode,
  };
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
