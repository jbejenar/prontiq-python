import type { ReactNode } from "react";

import { cn } from "../../lib/utils.js";

interface MetricCardProps {
  children: ReactNode;
  className?: string;
  heading: string;
  meta?: ReactNode;
}

export function MetricCard({ children, className, heading, meta }: MetricCardProps) {
  return (
    <section
      className={cn(
        "rounded-md border border-border bg-card text-card-foreground shadow-base",
        className,
      )}
    >
      <header className="flex items-center gap-3 border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-[0.04em] text-foreground">
        <span aria-hidden="true" className="text-accent">
          /
        </span>
        <span>{heading}</span>
        {meta ? (
          <span className="ml-auto text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
            {meta}
          </span>
        ) : null}
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}
