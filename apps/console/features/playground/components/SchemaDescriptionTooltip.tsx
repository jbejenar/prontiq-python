"use client";

import type { ReactNode } from "react";

import type { SchemaMetadata } from "../lib/schema-metadata.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../components/ui/tooltip.js";
import { cn } from "../../../lib/utils.js";

export function SchemaDescriptionTooltip({
  children,
  className,
  metadata,
  panel = false,
}: {
  children: ReactNode;
  className?: string;
  metadata: SchemaMetadata | null;
  panel?: boolean;
}) {
  if (!metadata) return <>{children}</>;

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              panel &&
                "decoration-playground-panel-accent-light/80 hover:underline hover:decoration-dotted focus-visible:ring-playground-panel-accent focus-visible:underline focus-visible:decoration-dotted",
              className,
            )}
            role="button"
            tabIndex={0}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent
          className={cn(
            "max-w-[320px] space-y-2 text-left",
            panel && "border-playground-panel-border bg-playground-panel-bg-footer text-playground-panel-text",
          )}
        >
          {metadata.description ? (
            <p className="whitespace-pre-wrap text-xs leading-relaxed">{metadata.description}</p>
          ) : null}
          {metadata.rows.length > 0 ? (
            <dl className="space-y-1">
              {metadata.rows.map((row) => (
                <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2" key={`${row.label}-${row.value}`}>
                  <dt className={cn("font-mono text-[10px] uppercase text-muted-foreground", panel && "text-playground-panel-muted")}>
                    {row.label}
                  </dt>
                  <dd className="break-words font-mono text-[10px]">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
