"use client";

import type { PlaygroundMode } from "../types.js";
import { Button } from "../../../components/ui/button.js";

export function PlaygroundModeSwitch({
  mode,
  onModeChange,
}: {
  mode: PlaygroundMode;
  onModeChange: (mode: PlaygroundMode) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-card/80 p-1">
      <Button
        size="sm"
        type="button"
        variant={mode === "demo" ? "default" : "ghost"}
        onClick={() => onModeChange("demo")}
      >
        Demo data
      </Button>
      <Button
        size="sm"
        type="button"
        variant={mode === "account" ? "default" : "ghost"}
        onClick={() => onModeChange("account")}
      >
        Your account
      </Button>
    </div>
  );
}
