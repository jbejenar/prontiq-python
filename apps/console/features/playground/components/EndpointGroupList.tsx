"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { PlaygroundOperation } from "../types.js";
import { cn } from "../../../lib/utils.js";

function getVerbClass(method: string, selected: boolean) {
  switch (method) {
    case "GET":
      return selected ? "text-teal-900 dark:text-teal-200" : "text-teal-700 dark:text-teal-300";
    case "POST":
      return selected ? "text-blue-900 dark:text-blue-200" : "text-blue-700 dark:text-blue-300";
    case "PUT":
    case "PATCH":
      return selected ? "text-amber-900 dark:text-amber-200" : "text-amber-700 dark:text-amber-300";
    case "DELETE":
      return selected ? "text-red-900 dark:text-red-200" : "text-red-700 dark:text-red-300";
    default:
      return selected ? "text-foreground" : "text-muted-foreground";
  }
}

function stripAddressPrefix(path: string) {
  return path.replace(/^\/v1\/address\/?/, "") || path;
}

export function EndpointGroupList({
  operations,
  selectedOperationId,
  onSelect,
}: {
  operations: PlaygroundOperation[];
  selectedOperationId: string | null;
  onSelect: (operation: PlaygroundOperation) => void;
}) {
  const [filter, setFilter] = useState("");
  const normalizedFilter = filter.trim().toLowerCase();
  const groups = useMemo(() => {
    const nextGroups = new Map<string, PlaygroundOperation[]>();
    for (const operation of operations) {
      const searchable = `${operation.method} ${operation.path} ${operation.summary} ${operation.tag}`.toLowerCase();
      if (normalizedFilter && !searchable.includes(normalizedFilter)) continue;
      nextGroups.set(operation.tag, [...(nextGroups.get(operation.tag) ?? []), operation]);
    }
    return nextGroups;
  }, [normalizedFilter, operations]);

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-border bg-surface/30">
      <div className="border-b border-border px-3 py-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Filter operations"
            className="h-[26px] w-full rounded-[5px] border border-border bg-background pl-7 pr-10 font-mono text-[11px] text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-2">
            ⌘K
          </span>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
      {[...groups.entries()].map(([tag, groupedOperations]) => (
        <section className="mb-4 space-y-1" key={tag}>
          <div className="flex items-center justify-between px-1 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-muted-2">
            <span>{tag}</span>
            <span>{groupedOperations.length}</span>
          </div>
          <div className="space-y-0.5">
            {groupedOperations.map((operation) => (
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selectedOperationId === operation.operationId &&
                    "border border-border bg-background shadow-sm",
                )}
                key={operation.operationId}
                type="button"
                onClick={() => onSelect(operation)}
              >
                <span
                  className={cn(
                    "w-[26px] shrink-0 font-mono text-[9px] font-medium uppercase tracking-[0.04em]",
                    getVerbClass(operation.method, selectedOperationId === operation.operationId),
                  )}
                >
                  {operation.method}
                </span>
                <span
                  className={cn(
                    "min-w-0 truncate font-mono text-[11px] text-muted-foreground",
                    selectedOperationId === operation.operationId && "font-medium text-foreground",
                  )}
                >
                  {stripAddressPrefix(operation.path)}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      </div>
    </aside>
  );
}
