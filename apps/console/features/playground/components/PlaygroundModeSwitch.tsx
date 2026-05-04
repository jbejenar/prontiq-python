"use client";

import type { PlaygroundMode } from "../types.js";
import { cn } from "../../../lib/utils.js";

export function PlaygroundModeSwitch({
  mode,
  onModeChange,
}: {
  mode: PlaygroundMode;
  onModeChange: (mode: PlaygroundMode) => void;
}) {
  return (
    <div className="inline-flex rounded-[6px] border border-border bg-surface p-0.5">
      <button
        className={cn(
          "h-7 rounded-[5px] px-3 text-sm text-muted-foreground transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          mode === "demo" && "border border-border bg-background font-medium text-foreground shadow-sm",
        )}
        type="button"
        onClick={() => onModeChange("demo")}
      >
        Demo
      </button>
      <button
        className={cn(
          "h-7 rounded-[5px] px-3 text-sm text-muted-foreground transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          mode === "account" && "border border-border bg-background font-medium text-foreground shadow-sm",
        )}
        type="button"
        onClick={() => onModeChange("account")}
      >
        Your account
      </button>
    </div>
  );
}
