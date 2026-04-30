"use client";

import { useAuth, useReverification } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, ExternalLink, Loader2, ReceiptText, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import { accountBillingQueryKey } from "../../../lib/account-query-keys.js";
import { billingApi, BillingApiError, type BillingSummary } from "../../../lib/billing-api.js";
import type { BillingInvoice, BillingPlan, BillingPlanCharge } from "../../../lib/billing-lago.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.js";

function formatMoney(amountCents: number | null, currency: string | null) {
  if (amountCents == null) return "Not available";
  try {
    return new Intl.NumberFormat("en-AU", {
      currency: currency ?? "AUD",
      style: "currency",
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency ?? "AUD"}`;
  }
}

function formatDecimalMoney(amountDecimal: string | null, currency: string | null) {
  if (!amountDecimal) return null;
  try {
    return `${new Intl.NumberFormat("en-AU", {
      currency: currency ?? "AUD",
      currencyDisplay: "narrowSymbol",
      style: "currency",
    }).format(0).replace(/0(?:\.00)?$/, "")}${amountDecimal}`;
  } catch {
    return `${amountDecimal} ${currency ?? "AUD"}`;
  }
}

function formatDate(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getErrorMessage(error: unknown) {
  if (error instanceof BillingApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

function metricLabel(charge: BillingPlanCharge) {
  return charge.name ?? charge.billableMetricCode ?? "Usage";
}

function chargeCopy(charge: BillingPlanCharge, currency: string | null) {
  if (charge.pricingDescription) return charge.pricingDescription;
  const exactAmount = formatDecimalMoney(charge.amountDecimal, currency);
  if (charge.chargeModel === "package") {
    const units = charge.packageSize ?? charge.freeUnits;
    return `${exactAmount ?? formatMoney(charge.amountCents, currency)} per ${units ?? "package"} requests${
      charge.freeUnits ? `, ${charge.freeUnits} included` : ""
    }`;
  }
  if (exactAmount) return `${exactAmount} per unit`;
  if (charge.amountCents != null) return `${formatMoney(charge.amountCents, currency)} per unit`;
  if (charge.freeUnits != null) return `${charge.freeUnits.toLocaleString("en-AU")} included units`;
  return charge.chargeModel ?? "Usage-based";
}

function PlanCard({
  canManageBilling,
  currentPlanCode,
  hasPendingTransition,
  isPending,
  onChangePlan,
  onCheckout,
  plan,
  pendingPlanCode,
}: {
  canManageBilling: boolean;
  currentPlanCode: string | null;
  hasPendingTransition: boolean;
  isPending: boolean;
  onChangePlan: (plan: BillingPlan) => void;
  onCheckout: (plan: BillingPlan) => void;
  pendingPlanCode: string | null;
  plan: BillingPlan;
}) {
  const isCurrent = currentPlanCode === plan.code;
  const isPendingPlan = pendingPlanCode === plan.code;
  const isActionDisabled = isPending || hasPendingTransition;
  let primaryActionLabel = "Admin required";
  if (isCurrent) {
    primaryActionLabel = "Current plan";
  } else if (isPendingPlan) {
    primaryActionLabel = "Pending plan";
  } else if (hasPendingTransition) {
    primaryActionLabel = "Plan change pending";
  } else if (canManageBilling) {
    primaryActionLabel = `Change to ${plan.name}`;
  }

  return (
    <Card className={isCurrent ? "border-primary/60 bg-primary/5" : isPendingPlan ? "border-amber-500/60" : undefined}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardDescription>{plan.code}</CardDescription>
            <CardTitle>{plan.name}</CardTitle>
          </div>
          {isCurrent ? <Badge>Current</Badge> : null}
          {!isCurrent && isPendingPlan ? <Badge variant="outline">Pending</Badge> : null}
        </div>
        {plan.description ? <CardDescription>{plan.description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-3xl font-semibold">
            {formatMoney(plan.amountCents, plan.currency)}
          </div>
          <p className="text-sm text-muted-foreground">{plan.interval ?? "Billing interval not set"}</p>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          {plan.charges.length === 0 ? (
            <p>No usage charges exposed by Lago for this plan.</p>
          ) : (
            plan.charges.map((charge, index) => (
              <p key={`${charge.billableMetricCode ?? "charge"}-${index}`}>
                <span className="font-medium text-foreground">{metricLabel(charge)}:</span>{" "}
                {chargeCopy(charge, plan.currency)}
              </p>
            ))
          )}
        </div>
        <Button
          className="w-full"
          disabled={isCurrent || isPendingPlan || !canManageBilling || isActionDisabled}
          type="button"
          variant={isCurrent ? "outline" : "default"}
          onClick={() => onChangePlan(plan)}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          {primaryActionLabel}
        </Button>
        {!isCurrent ? (
          <p className="text-xs leading-5 text-muted-foreground">
            Plan changes are sent to Lago. API enforcement updates after Lago reconciliation.
          </p>
        ) : null}
        {canManageBilling ? (
          <Button
            className="w-full"
            disabled={isActionDisabled}
            type="button"
            variant="outline"
            onClick={() => onCheckout(plan)}
          >
            <ExternalLink className="h-4 w-4" />
            Set up payment method
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InvoiceTable({
  canManageBilling,
  invoices,
  isPaymentPending,
  onPay,
}: {
  canManageBilling: boolean;
  invoices: BillingInvoice[];
  isPaymentPending: boolean;
  onPay: (invoice: BillingInvoice) => void;
}) {
  if (invoices.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-background/70 p-4 text-sm text-muted-foreground">
        No invoices returned by Lago yet.
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Issued</TableHead>
          <TableHead>Total</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((invoice) => {
          const canPay =
            canManageBilling &&
            ["failed", "pending", "payment_failed"].includes(invoice.paymentStatus ?? invoice.status);
          return (
            <TableRow key={invoice.id}>
              <TableCell className="font-mono text-sm">{invoice.number ?? invoice.id}</TableCell>
              <TableCell>
                <Badge variant="outline">{invoice.paymentStatus ?? invoice.status}</Badge>
              </TableCell>
              <TableCell>{formatDate(invoice.issuingDate)}</TableCell>
              <TableCell>{formatMoney(invoice.totalAmountCents, invoice.currency)}</TableCell>
              <TableCell className="text-right">
                {canPay ? (
                  <Button
                    disabled={isPaymentPending}
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => onPay(invoice)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Pay invoice
                  </Button>
                ) : invoice.invoiceUrl ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={invoice.invoiceUrl} rel="noreferrer" target="_blank">
                      <ExternalLink className="h-3.5 w-3.5" />
                      View
                    </a>
                  </Button>
                ) : (
                  <span className="text-sm text-muted-foreground">No action</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function BillingLoaded({ summary, onRetry }: { summary: BillingSummary; onRetry: () => void }) {
  const queryClient = useQueryClient();
  const changePlanWithReverification = useReverification((input: {
    idempotencyKey: string;
    plan: BillingPlan;
  }) =>
    billingApi.changePlan({
      idempotencyKey: input.idempotencyKey,
      targetPlanCode: input.plan.code,
    }),
  );
  const checkout = useMutation({
    mutationFn: (plan: BillingPlan) => billingApi.createCheckout({ intendedPlanCode: plan.code }),
    onSuccess: (result) => {
      window.location.assign(result.checkoutUrl);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  const invoicePayment = useMutation({
    mutationFn: (invoiceId: string) => billingApi.createInvoicePaymentUrl(invoiceId),
    onSuccess: (result) => {
      window.location.assign(result.paymentUrl);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  const planChange = useMutation({
    mutationFn: (plan: BillingPlan) =>
      changePlanWithReverification({
        idempotencyKey: crypto.randomUUID(),
        plan,
      }),
    onSuccess: async (result) => {
      if (typeof result === "object" && result !== null && "clerk_error" in result) return;
      toast.success("Plan change accepted. Lago reconciliation will update API enforcement.");
      await queryClient.invalidateQueries({ queryKey: accountBillingQueryKey(summary.orgId) });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const currentPlanCode = summary.subscription?.planCode ?? null;
  const pendingPlanCode = summary.subscription?.nextPlanCode ?? null;
  const hasPendingTransition = pendingPlanCode !== null;
  return (
    <>
      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Current plan</CardDescription>
            <CardTitle>{summary.subscription?.planName ?? currentPlanCode ?? "Not provisioned"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Status: {summary.subscription?.status ?? "No Lago subscription returned"}</p>
            {pendingPlanCode ? (
              <p>
                Pending plan: {pendingPlanCode}
                {summary.subscription?.downgradePlanDate
                  ? ` on ${formatDate(summary.subscription.downgradePlanDate)}`
                  : ""}
              </p>
            ) : null}
            <p>
              Billing period: {formatDate(summary.subscription?.currentBillingPeriodStartedAt ?? null)}
              {" - "}
              {formatDate(summary.subscription?.currentBillingPeriodEndingAt ?? null)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Current billing usage</CardDescription>
            <CardTitle>{formatMoney(summary.usage?.amountCents ?? null, summary.usage?.currency ?? null)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Lago estimate for {formatDate(summary.usage?.fromDatetime ?? null)} -{" "}
              {formatDate(summary.usage?.toDatetime ?? null)}.
            </p>
            <Button type="button" variant="outline" onClick={onRetry}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Billing role</CardDescription>
            <CardTitle>{summary.canManageBilling ? "Admin" : "Member"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {summary.canManageBilling
              ? "You can create payment setup and invoice payment links."
              : "You can view billing state. Ask an org admin to manage payment links."}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">Plans</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Plans are rendered dynamically from Lago metadata. Test and internal plans are hidden.
          </p>
        </div>
        {summary.plans.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No public plans configured</CardTitle>
              <CardDescription>
                Lago returned no plans with prontiq_console_visible=true for this environment.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-3">
            {summary.plans.map((plan) => (
              <PlanCard
                canManageBilling={summary.canManageBilling}
                currentPlanCode={currentPlanCode}
                hasPendingTransition={hasPendingTransition}
                isPending={checkout.isPending || planChange.isPending}
                key={plan.code}
                pendingPlanCode={pendingPlanCode}
                plan={plan}
                onChangePlan={(selectedPlan) => planChange.mutate(selectedPlan)}
                onCheckout={(selectedPlan) => checkout.mutate(selectedPlan)}
              />
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4" />
            Invoices
          </CardTitle>
          <CardDescription>Recent Lago invoices for the active organization.</CardDescription>
        </CardHeader>
        <CardContent>
          <InvoiceTable
            canManageBilling={summary.canManageBilling}
            invoices={summary.invoices}
            isPaymentPending={invoicePayment.isPending}
            onPay={(invoice) => invoicePayment.mutate(invoice.id)}
          />
        </CardContent>
      </Card>
    </>
  );
}

export function BillingPanel() {
  const { isLoaded, orgId } = useAuth();
  const hasActiveOrg = isLoaded && typeof orgId === "string" && orgId.length > 0;
  const billing = useQuery({
    enabled: hasActiveOrg,
    queryKey: accountBillingQueryKey(orgId ?? "no-active-org"),
    queryFn: () => billingApi.getSummary(),
    staleTime: 30_000,
  });

  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <Badge>P1C.05</Badge>
        <div>
          <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">Billing</h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
            Lago is the billing source of truth. The console calls a Vercel server-side BFF so Lago
            and Stripe credentials never reach the browser.
          </p>
        </div>
      </div>

      {!isLoaded ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading billing session...
          </CardContent>
        </Card>
      ) : !hasActiveOrg ? (
        <Card>
          <CardHeader>
            <CardTitle>Select an organization</CardTitle>
            <CardDescription>Billing is scoped to the active Clerk organization.</CardDescription>
          </CardHeader>
        </Card>
      ) : billing.isPending ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading billing...
          </CardContent>
        </Card>
      ) : billing.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Could not load billing</CardTitle>
            <CardDescription>{getErrorMessage(billing.error)}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" onClick={() => void billing.refetch()}>
              <RefreshCcw className="h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <BillingLoaded summary={billing.data} onRetry={() => void billing.refetch()} />
      )}
    </section>
  );
}
