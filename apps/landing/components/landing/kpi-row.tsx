import type { SiteKpi } from "@prontiq/shared/content";

import { cn } from "../../lib/utils.js";

interface KpiRowProps {
  className?: string;
  kpis: readonly SiteKpi[];
}

function buildSparklinePoints(values: readonly number[]): string {
  if (values.length === 0) {
    return "";
  }
  const maxX = 96;
  const maxY = 24;
  const stepX = values.length > 1 ? maxX / (values.length - 1) : 0;
  const maxValue = Math.max(...values, 1);
  return values
    .map((value, index) => {
      const x = (index * stepX).toFixed(2);
      const normalized = Math.max(0, Math.min(value, maxValue));
      const y = (maxY - (normalized / maxValue) * maxY).toFixed(2);
      return `${x},${y}`;
    })
    .join(" ");
}

export function KpiRow({ className, kpis }: KpiRowProps) {
  if (kpis.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-md border border-border bg-border shadow-base",
        "grid-cols-1 sm:grid-cols-2 xl:[grid-template-columns:1.2fr_1fr_1fr_1fr]",
        className,
      )}
      role="list"
    >
      {kpis.map((kpi) => (
        <article
          className="pq-rise flex min-w-0 flex-col gap-2 bg-card px-5 py-4 text-card-foreground"
          key={kpi.label}
          role="listitem"
        >
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {kpi.label}
          </div>
          <div className="flex items-baseline gap-2 font-display text-4xl leading-none tracking-tight">
            <span>{kpi.value}</span>
            {kpi.unit ? (
              <span className="font-body text-xs font-normal text-muted-foreground">
                {kpi.unit}
              </span>
            ) : null}
          </div>
          <div className="mt-auto flex items-center justify-between gap-2 pt-2">
            {kpi.delta ? (
              <span className="whitespace-nowrap text-[11px] text-accent">{kpi.delta}</span>
            ) : (
              <span aria-hidden="true" />
            )}
            {kpi.sparkline ? (
              <svg
                aria-hidden="true"
                className="h-6 w-24 flex-none text-accent"
                preserveAspectRatio="none"
                viewBox="0 0 96 24"
              >
                <polyline
                  fill="none"
                  points={buildSparklinePoints(kpi.sparkline)}
                  stroke="currentColor"
                  strokeWidth={1.2}
                />
              </svg>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
