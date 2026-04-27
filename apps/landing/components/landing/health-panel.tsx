import type { ReactNode } from "react";

interface HealthPanelRow {
  label: string;
  value: ReactNode;
  caption?: string;
}

interface HealthPanelProps {
  rows: readonly HealthPanelRow[];
}

export function HealthPanel({ rows }: HealthPanelProps) {
  return (
    <dl className="flex flex-col gap-4">
      {rows.map((row) => (
        <div
          className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-dashed border-border pb-3 last:border-b-0 last:pb-0"
          key={row.label}
        >
          <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {row.label}
          </dt>
          <dd className="break-all text-right font-display text-lg leading-tight tracking-tight text-foreground">
            {row.value}
          </dd>
          {row.caption ? (
            <span className="col-span-2 text-[11px] text-muted-foreground">{row.caption}</span>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
