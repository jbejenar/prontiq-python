"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { toast } from "sonner";

import type {
  PlaygroundDemoStatus,
  PlaygroundExecutionControls,
  PlaygroundHistoryEntry,
  PlaygroundMode,
  PlaygroundOperation,
  PlaygroundRequestConfig,
  PlaygroundResponse,
} from "../types.js";
import { buildCurlCommand } from "../lib/curl.js";
import { executeAccountRequest, executeDemoRequest, PlaygroundRequestError } from "../lib/request.js";
import { recordPlaygroundTelemetry } from "../lib/telemetry.js";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import { OperationInputForm, makeInitialRequestConfig } from "./OperationInputForm.js";
import { PlaygroundDarkPanel } from "./PlaygroundDarkPanel.js";

export function PlaygroundExecutionPanel({
  apiKey,
  baseUrl,
  clearApiKey,
  demoStatus,
  historyEntries,
  historyOpen,
  isDemoStatusLoading,
  mode,
  operation,
  pendingHistoryEntry,
  onAppendHistory,
  onControlsChange,
  onClearHistory,
  onHistoryEntrySelect,
  onHistoryOpenChange,
  onOpenCommandPalette,
  onPendingHistoryApplied,
  updateApiKey,
}: {
  apiKey: string;
  baseUrl: string;
  clearApiKey: () => void;
  demoStatus: PlaygroundDemoStatus | null;
  historyEntries: readonly PlaygroundHistoryEntry[];
  historyOpen: boolean;
  isDemoStatusLoading: boolean;
  mode: PlaygroundMode;
  operation: PlaygroundOperation;
  pendingHistoryEntry: PlaygroundHistoryEntry | null;
  onAppendHistory: (entry: PlaygroundHistoryEntry) => void;
  onClearHistory: () => void;
  onControlsChange?: (controls: PlaygroundExecutionControls | null) => void;
  onHistoryEntrySelect: (entry: PlaygroundHistoryEntry) => void;
  onHistoryOpenChange: (open: boolean) => void;
  onOpenCommandPalette: () => void;
  onPendingHistoryApplied: () => void;
  updateApiKey: (value: string) => void;
}) {
  const [config, setConfig] = useState<PlaygroundRequestConfig>(() =>
    makeInitialRequestConfig(operation),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [requestDisplayId, setRequestDisplayId] = useState("000000");
  const [response, setResponse] = useState<PlaygroundResponse | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const languageTabsRef = useRef<HTMLButtonElement | null>(null);

  const cancelActiveRequest = useCallback(({ clearSending = true }: { clearSending?: boolean } = {}) => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (clearSending) setIsSending(false);
  }, []);

  useEffect(() => {
    cancelActiveRequest();
    startTransition(() => {
      setConfig(makeInitialRequestConfig(operation));
      setError(null);
      setResponse(null);
    });
  }, [cancelActiveRequest, operation]);

  useEffect(() => {
    cancelActiveRequest();
  }, [cancelActiveRequest, config, mode]);

  useEffect(() => () => cancelActiveRequest({ clearSending: false }), [cancelActiveRequest]);

  useEffect(() => {
    if (!pendingHistoryEntry || pendingHistoryEntry.operation.operationId !== operation.operationId) return;
    cancelActiveRequest();
    startTransition(() => {
      setConfig(pendingHistoryEntry.config);
      setError(null);
      setResponse(null);
      setRequestDisplayId(pendingHistoryEntry.requestDisplayId);
    });
    onPendingHistoryApplied();
  }, [cancelActiveRequest, onPendingHistoryApplied, operation.operationId, pendingHistoryEntry]);

  const demoChecking = mode === "demo" && isDemoStatusLoading;
  const demoReferenceOnly =
    mode === "demo" && !isDemoStatusLoading && demoStatus?.execution !== "enabled";
  const demoReferenceOnlyMessage =
    demoStatus?.execution === "reference_only"
      ? demoStatus.message
      : "Demo execution availability could not be confirmed for this deployment.";
  const runAriaLabel = demoChecking
    ? "Checking demo availability"
    : `Send ${mode === "demo" ? "demo" : "account"} request`;
  const command = buildCurlCommand({
    apiKey,
    baseUrl,
    config,
    includeRealKey: false,
    mode,
    operation,
  });

  const resetCurrentRequest = useCallback(() => {
    cancelActiveRequest();
    startTransition(() => {
      setConfig(makeInitialRequestConfig(operation));
      setError(null);
      setResponse(null);
    });
  }, [cancelActiveRequest, operation]);

  const copyCurl = useCallback(async () => {
    await navigator.clipboard.writeText(command);
    toast.success("Copied curl command");
  }, [command]);

  const focusLanguageTabs = useCallback(() => {
    languageTabsRef.current?.focus();
  }, []);

  const sendRequest = useCallback(async () => {
    if (demoChecking) return;
    if (demoReferenceOnly) {
      setError(demoReferenceOnlyMessage);
      return;
    }
    if (mode === "account" && !apiKey.trim()) {
      setError("Paste an API key or open from the Keys page before sending account requests.");
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    const displayId = makeRequestDisplayId();
    setRequestDisplayId(displayId);
    setIsSending(true);
    setError(null);
    setResponse(null);
    try {
      const nextResponse =
        mode === "demo"
          ? await executeDemoRequest({ config, operation, signal: abortController.signal })
          : await executeAccountRequest({
              apiKey,
              baseUrl,
              config,
              operation,
              signal: abortController.signal,
            });
      if (requestIdRef.current !== requestId) return;
      setResponse(nextResponse);
      onAppendHistory({
        config,
        id: makeHistoryEntryId(),
        latencyMs: nextResponse.durationMs,
        mode,
        operation: {
          method: operation.method,
          operationId: operation.operationId,
          path: operation.path,
          summary: operation.summary,
          tag: operation.tag,
        },
        requestDisplayId: displayId,
        status: nextResponse.status,
        timestamp: new Date().toISOString(),
      });
      recordPlaygroundTelemetry({
        latencyMs: nextResponse.durationMs,
        method: operation.method,
        mode,
        operationId: operation.operationId,
        pathTemplate: operation.path,
        source: "console_playground",
        status: nextResponse.status,
      });
    } catch (requestError) {
      if (requestIdRef.current !== requestId) return;
      const message =
        requestError instanceof PlaygroundRequestError
          ? requestError.message
          : requestError instanceof Error
            ? requestError.message
            : "The playground request failed.";
      setError(message);
      recordPlaygroundTelemetry({
        errorCategory:
          requestError instanceof PlaygroundRequestError ? requestError.code : "REQUEST_FAILED",
        method: operation.method,
        mode,
        operationId: operation.operationId,
        pathTemplate: operation.path,
        source: "console_playground",
      });
    } finally {
      if (requestIdRef.current === requestId) {
        abortRef.current = null;
        setIsSending(false);
      }
    }
  }, [
    apiKey,
    baseUrl,
    config,
    demoChecking,
    demoReferenceOnly,
    demoReferenceOnlyMessage,
    mode,
    onAppendHistory,
    operation,
  ]);

  useEffect(() => {
    if (!onControlsChange) return;
    onControlsChange({
      canCopyCurl: true,
      canRun: !demoChecking && !demoReferenceOnly && !isSending,
      copyCurl,
      focusLanguageTabs,
      reset: resetCurrentRequest,
      run: () => void sendRequest(),
    });
  }, [
    copyCurl,
    demoChecking,
    demoReferenceOnly,
    focusLanguageTabs,
    isSending,
    onControlsChange,
    resetCurrentRequest,
    sendRequest,
  ]);

  useEffect(() => () => onControlsChange?.(null), [onControlsChange]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <section className="border-b border-border px-4 pb-3 pt-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-[3px] bg-primary/10 px-[7px] py-0.5 font-mono text-[10px] font-medium text-primary">
            {operation.method}
          </span>
          <div className="min-w-0 truncate font-mono text-[13px] font-medium text-foreground">
            <HighlightedPath path={operation.path} />
          </div>
        </div>
        <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{operation.summary}</p>
      </section>

      <section className="border-b border-border px-4 py-3">
        <div className="space-y-4">
          {mode === "account" ? (
            <div className="rounded-md border border-border bg-surface/40 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                <KeyRound className="h-4 w-4 text-primary" />
                API key
              </div>
              <div className="flex gap-2">
                <Input
                  autoComplete="off"
                  className="h-7 rounded-[5px] px-2 font-mono text-[12px]"
                  placeholder="pq_live_..."
                  type="password"
                  value={apiKey}
                  onChange={(event) => updateApiKey(event.target.value)}
                />
                <Button size="sm" type="button" variant="outline" onClick={clearApiKey}>
                  <X className="h-4 w-4" />
                  Clear
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Stored in memory only. It clears on sign-out, org switch, or manual clear.
              </p>
            </div>
          ) : null}
          <OperationInputForm config={config} operation={operation} onConfigChange={setConfig} />
        </div>
      </section>

      <PlaygroundDarkPanel
        command={command}
        demoUnavailableMessage={demoReferenceOnly && !demoChecking ? demoReferenceOnlyMessage : undefined}
        error={error}
        historyEntries={historyEntries}
        historyOpen={historyOpen}
        isSending={isSending || demoChecking}
        mode={mode}
        onClearHistory={onClearHistory}
        onCopyCurl={copyCurl}
        onHistoryEntrySelect={onHistoryEntrySelect}
        onHistoryOpenChange={onHistoryOpenChange}
        onOpenCommandPalette={onOpenCommandPalette}
        requestDisplayId={requestDisplayId}
        response={response}
        runAriaLabel={runAriaLabel}
        tabFocusRef={languageTabsRef}
        onRun={() => void sendRequest()}
      />
    </div>
  );
}

function HighlightedPath({ path }: { path: string }) {
  const parts = path.split(/(\{[^}]+\})/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("{") && part.endsWith("}") ? (
          <span
            className="mx-0.5 rounded-[3px] bg-warn/10 px-1 text-warn"
            key={`${part}-${index}`}
          >
            {part}
          </span>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

function makeRequestDisplayId() {
  return Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
}

function makeHistoryEntryId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `hist_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
