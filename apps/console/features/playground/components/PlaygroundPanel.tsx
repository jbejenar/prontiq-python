"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, RefreshCcw, SquareTerminal } from "lucide-react";

import type {
  PlaygroundCommandActionId,
  PlaygroundExecutionControls,
  PlaygroundMode,
  PlaygroundOperation,
} from "../types.js";
import { usePlaygroundDemoStatus } from "../hooks/usePlaygroundDemoStatus.js";
import { usePlaygroundHotkeys } from "../hooks/usePlaygroundHotkeys.js";
import { usePlaygroundOpenApi } from "../hooks/usePlaygroundOpenApi.js";
import { recordPlaygroundInteractionTelemetry } from "../lib/telemetry.js";
import { Button } from "../../../components/ui/button.js";
import { PlaygroundCommandPalette } from "./PlaygroundCommandPalette.js";
import { EndpointGroupList } from "./EndpointGroupList.js";
import { PlaygroundExecutionPanel } from "./PlaygroundExecutionPanel.js";
import { PlaygroundModeSwitch } from "./PlaygroundModeSwitch.js";
import { usePlaygroundKey } from "./playground-key-provider.js";

type PendingFocusTarget = "filter" | "language_tabs";

export function PlaygroundPanel({ apiBaseUrl }: { apiBaseUrl: string }) {
  const { clearHeldKey, heldKey, scopeVersion } = usePlaygroundKey();
  const [mode, setMode] = useState<PlaygroundMode>(heldKey ? "account" : "demo");
  const [manualKey, setManualKey] = useState("");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [executionControls, setExecutionControls] = useState<PlaygroundExecutionControls | null>(null);
  const [pendingFocusTarget, setPendingFocusTarget] = useState<PendingFocusTarget | null>(null);
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const lastScopeVersion = useRef(scopeVersion);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const demoStatusQuery = usePlaygroundDemoStatus();
  const openApiQuery = usePlaygroundOpenApi();
  const apiKey = heldKey?.raw ?? manualKey;

  const operations = openApiQuery.data ?? [];
  const selectedOperation = useMemo(
    () =>
      operations.find((operation) => operation.operationId === selectedOperationId) ??
      operations[0] ??
      null,
    [operations, selectedOperationId],
  );

  useEffect(() => {
    if (heldKey) {
      setMode("account");
      setManualKey("");
    }
  }, [heldKey]);

  useEffect(() => {
    if (lastScopeVersion.current === scopeVersion) return;
    lastScopeVersion.current = scopeVersion;
    setManualKey("");
    setMode("demo");
  }, [scopeVersion]);

  const updateManualKey = useCallback((value: string) => {
    if (heldKey) clearHeldKey();
    setManualKey(value);
  }, [clearHeldKey, heldKey]);

  const clearApiKey = useCallback(() => {
    clearHeldKey();
    setManualKey("");
  }, [clearHeldKey]);

  const focusFilter = useCallback(() => {
    filterInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (commandPaletteOpen || !pendingFocusTarget) return;
    const frame = window.requestAnimationFrame(() => {
      if (pendingFocusTarget === "filter") {
        focusFilter();
      } else {
        executionControls?.focusLanguageTabs();
      }
      setPendingFocusTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [commandPaletteOpen, executionControls, focusFilter, pendingFocusTarget]);

  const openCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
    recordPlaygroundInteractionTelemetry({
      eventName: "palette_opened",
      mode,
      source: "console_playground",
    });
  }, [mode]);

  const selectOperation = useCallback((operation: PlaygroundOperation) => {
    setSelectedOperationId(operation.operationId);
  }, []);

  const selectOperationFromPalette = useCallback(
    (operation: PlaygroundOperation) => {
      selectOperation(operation);
      setCommandPaletteOpen(false);
      recordPlaygroundInteractionTelemetry({
        eventName: "palette_operation_selected",
        mode,
        operationId: operation.operationId,
        source: "console_playground",
      });
    },
    [mode, selectOperation],
  );

  const handlePaletteAction = useCallback(
    (actionId: PlaygroundCommandActionId) => {
      recordPlaygroundInteractionTelemetry({
        actionId,
        eventName: "palette_action_selected",
        mode,
        source: "console_playground",
      });
      switch (actionId) {
        case "switch_to_demo":
          setMode("demo");
          break;
        case "switch_to_account":
          setMode("account");
          break;
        case "run_request":
          executionControls?.run();
          break;
        case "copy_curl":
          void executionControls?.copyCurl();
          break;
        case "clear_api_key":
          clearApiKey();
          break;
        case "open_docs":
          window.open("https://docs.prontiq.dev", "_blank", "noopener,noreferrer");
          break;
        case "reset_playground":
          executionControls?.reset();
          break;
        case "focus_filter":
          setPendingFocusTarget("filter");
          break;
        case "focus_language_tabs":
          setPendingFocusTarget("language_tabs");
          break;
      }
      setCommandPaletteOpen(false);
    },
    [clearApiKey, executionControls, mode],
  );

  usePlaygroundHotkeys({
    onFocusFilter: focusFilter,
    onOpenPalette: openCommandPalette,
    onRun: () => executionControls?.run(),
    paletteOpen: commandPaletteOpen,
    rootRef,
  });

  return (
    <section
      className="flex h-[calc(100vh-8.5rem)] min-h-[720px] flex-col overflow-hidden border border-border bg-background"
      ref={rootRef}
    >
      <PlaygroundCommandPalette
        canCopyCurl={executionControls?.canCopyCurl ?? false}
        canRun={executionControls?.canRun ?? false}
        mode={mode}
        open={commandPaletteOpen}
        operations={operations}
        onActionSelected={handlePaletteAction}
        onOpenChange={setCommandPaletteOpen}
        onOperationSelected={selectOperationFromPalette}
      />
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background px-3">
        <div className="flex h-[18px] w-[18px] items-center justify-center rounded-sm bg-primary/10 text-primary">
          <SquareTerminal className="h-3.5 w-3.5" />
        </div>
        <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
          <span>prontiq</span>
          <span className="text-muted-2">/</span>
          <span>console</span>
          <span className="text-muted-2">/</span>
          <span className="font-medium text-foreground">playground</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="inline-flex items-center gap-1.5 rounded-[5px] bg-secondary px-2 py-1 font-mono text-[11px] text-secondary-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            live
          </div>
          <PlaygroundModeSwitch mode={mode} onModeChange={setMode} />
        </div>
      </header>

      {openApiQuery.isPending ? (
        <PlaygroundCenteredState icon={<Loader2 className="h-4 w-4 animate-spin" />}>
          Loading public API spec...
        </PlaygroundCenteredState>
      ) : openApiQuery.isError ? (
        <PlaygroundCenteredState>
          <div className="space-y-3 text-center">
            <p>Could not load the playground.</p>
            <p className="text-xs text-muted-foreground">{openApiQuery.error.message}</p>
            <Button type="button" variant="outline" onClick={() => void openApiQuery.refetch()}>
              <RefreshCcw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        </PlaygroundCenteredState>
      ) : operations.length === 0 ? (
        <PlaygroundCenteredState>No public endpoints available.</PlaygroundCenteredState>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
          <EndpointGroupList
            filterInputRef={filterInputRef}
            onOpenCommandPalette={openCommandPalette}
            operations={operations}
            selectedOperationId={selectedOperation?.operationId ?? null}
            onSelect={selectOperation}
          />
          {selectedOperation ? (
            <PlaygroundExecutionPanel
              apiKey={apiKey}
              baseUrl={apiBaseUrl}
              clearApiKey={clearApiKey}
              demoStatus={demoStatusQuery.data ?? null}
              isDemoStatusLoading={demoStatusQuery.isPending}
              mode={mode}
              operation={selectedOperation}
              onControlsChange={setExecutionControls}
              updateApiKey={updateManualKey}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}

function PlaygroundCenteredState({
  children,
  icon,
}: {
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-3 font-mono text-sm text-muted-foreground">
      {icon}
      {children}
    </div>
  );
}
