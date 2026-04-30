"use client";

import { useMemo, useState } from "react";
import { useAuth, useOrganization } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Loader2, RefreshCcw } from "lucide-react";

import {
  accountApi,
  AccountApiError,
  type AccountUsage,
  type AccountUsageProduct,
  type UsageGranularity,
} from "../../../lib/account-api.js";
import { accountUsageQueryKey } from "../../../lib/account-query-keys.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card.js";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs.js";

const granularities: UsageGranularity[] = ["daily", "weekly", "monthly"];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-AU").format(value);
}

function formatPeriod(usage: AccountUsage) {
  if (!usage.period.startedAt || !usage.period.endingAt) return usage.period.key;
  const formatter = new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  return `${formatter.format(new Date(usage.period.startedAt))} - ${formatter.format(new Date(usage.period.endingAt))}`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof AccountApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Could not load usage.";
}

function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(usage: AccountUsage) {
  const rows = [["bucket", "product", "credits", "kind"]];
  for (const product of usage.products) {
    for (const point of product.series) {
      rows.push([point.bucket, product.product, String(point.credits), point.kind]);
    }
  }
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `prontiq-usage-${usage.period.key}-${usage.granularity}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function UsageStat({ product }: { product: AccountUsageProduct }) {
  const quotaCopy =
    product.quotaCredits == null
      ? "Uncapped tracked usage"
      : `${formatNumber(product.remainingCredits ?? 0)} credits remaining`;
  return (
    <Card>
      <CardHeader>
        <CardDescription>{product.displayName}</CardDescription>
        <CardTitle>{formatNumber(product.usedCredits)} credits</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>{quotaCopy}</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant={product.includedInCurrentPlan ? "default" : "outline"}>
            {product.includedInCurrentPlan ? "In plan" : "Historical"}
          </Badge>
          <Badge variant="outline">{product.enforcementMode.replace(/_/g, " ")}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function UsageChart({ products }: { products: AccountUsageProduct[] }) {
  const data = useMemo(() => {
    const buckets = new Map<string, Record<string, string | number>>();
    for (const product of products) {
      for (const point of product.series) {
        const row = buckets.get(point.bucket) ?? {
          bucket: point.bucket,
          label: point.label,
          sortKey: point.sortKey,
        };
        row[product.product] = point.credits;
        buckets.set(point.bucket, row);
      }
    }
    return [...buckets.values()].sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
  }, [products]);

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-background/70 p-8 text-sm text-muted-foreground">
        No projected chart buckets yet. Make an API call and wait for the billing-event worker to
        process it.
      </div>
    );
  }

  return (
    <div className="h-[360px]">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart data={data} margin={{ bottom: 8, left: 0, right: 16, top: 12 }}>
          <defs>
            <linearGradient id="usage-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} />
          <YAxis tickFormatter={formatNumber} tickLine={false} />
          <Tooltip />
          {products.map((product) => (
            <Area
              dataKey={product.product}
              fill="url(#usage-fill)"
              key={product.product}
              name={product.displayName}
              stroke="hsl(var(--primary))"
              type="monotone"
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function hasBaselineSeries(products: AccountUsageProduct[]) {
  return products.some((product) => product.series.some((point) => point.kind === "baseline"));
}

export function UsagePanel() {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const [granularity, setGranularity] = useState<UsageGranularity>("daily");
  const orgId = organization?.id ?? "no-org";

  const usage = useQuery({
    enabled: Boolean(organization?.id),
    queryKey: accountUsageQueryKey(orgId, granularity),
    queryFn: () => accountApi.getUsage(getToken, granularity),
    staleTime: 30_000,
  });

  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <Badge>P1C.04</Badge>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">Usage</h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
              Current-period usage is counted by Prontiq and reconciled to Lago for billing.
              Charts are projected asynchronously from the billing-event stream.
            </p>
          </div>
          <Tabs value={granularity} onValueChange={(value) => setGranularity(value as UsageGranularity)}>
            <TabsList>
              {granularities.map((item) => (
                <TabsTrigger key={item} value={item}>
                  {item}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {!organization?.id ? (
        <Card>
          <CardHeader>
            <CardTitle>Select an organization</CardTitle>
            <CardDescription>Usage is scoped to the active Clerk organization.</CardDescription>
          </CardHeader>
        </Card>
      ) : usage.isPending ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading usage...
          </CardContent>
        </Card>
      ) : usage.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Could not load usage</CardTitle>
            <CardDescription>{getErrorMessage(usage.error)}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" onClick={() => void usage.refetch()}>
              <RefreshCcw className="h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {usage.data.products.map((product) => (
              <UsageStat key={product.product} product={product} />
            ))}
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Consumption trend</CardTitle>
                <CardDescription>
                  {formatPeriod(usage.data)} · {usage.data.period.source === "lago" ? "Lago period" : "Calendar fallback"}
                </CardDescription>
                {usage.data.period.scopeConsistency === "mixed_key_periods" ? (
                  <p className="mt-2 text-xs text-amber-700">
                    Some key counters are still on a different period. Totals are shown, but chart
                    comparison may be temporarily uneven.
                  </p>
                ) : null}
              </div>
              <Button type="button" variant="outline" onClick={() => downloadCsv(usage.data)}>
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </CardHeader>
            <CardContent>
              {hasBaselineSeries(usage.data.products) ? (
                <p className="mb-4 text-xs text-muted-foreground">
                  Some usage predates detailed chart buckets, so it is shown as a baseline total.
                </p>
              ) : null}
              <UsageChart products={usage.data.products} />
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
