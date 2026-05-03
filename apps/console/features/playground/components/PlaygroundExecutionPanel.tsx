"use client";

import { useEffect, useRef, useState, startTransition } from "react";
import { Loader2, Send } from "lucide-react";

import type {
  PlaygroundDemoStatus,
  PlaygroundMode,
  PlaygroundOperation,
  PlaygroundRequestConfig,
  PlaygroundResponse,
} from "../types.js";
import { executeAccountRequest, executeDemoRequest, PlaygroundRequestError } from "../lib/request.js";
import { recordPlaygroundTelemetry } from "../lib/telemetry.js";
import { Button } from "../../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card.js";
import { CurlPreviewPanel } from "./CurlPreviewPanel.js";
import { OperationInputForm, makeInitialRequestConfig } from "./OperationInputForm.js";
import { ResponseViewer } from "./ResponseViewer.js";
import { ScalarAdvancedModal } from "./ScalarAdvancedModal.js";

export function PlaygroundExecutionPanel({
  apiKey,
  baseUrl,
  demoStatus,
  isDemoStatusLoading,
  mode,
  operation,
}: {
  apiKey: string;
  baseUrl: string;
  demoStatus: PlaygroundDemoStatus | null;
  isDemoStatusLoading: boolean;
  mode: PlaygroundMode;
  operation: PlaygroundOperation;
}) {
  const [config, setConfig] = useState<PlaygroundRequestConfig>(() =>
    makeInitialRequestConfig(operation),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [response, setResponse] = useState<PlaygroundResponse | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  function cancelActiveRequest({ clearSending = true }: { clearSending?: boolean } = {}) {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (clearSending) setIsSending(false);
  }

  useEffect(() => {
    cancelActiveRequest();
    startTransition(() => {
      setConfig(makeInitialRequestConfig(operation));
      setError(null);
      setResponse(null);
    });
  }, [operation]);

  useEffect(() => {
    cancelActiveRequest();
  }, [config, mode]);

  useEffect(() => () => cancelActiveRequest({ clearSending: false }), []);

  const demoChecking = mode === "demo" && isDemoStatusLoading;
  const demoReferenceOnly =
    mode === "demo" && !isDemoStatusLoading && demoStatus?.execution !== "enabled";
  const demoReferenceOnlyMessage =
    demoStatus?.execution === "reference_only"
      ? demoStatus.message
      : "Demo execution availability could not be confirmed for this deployment.";
  const sendDisabled = isSending || demoChecking || demoReferenceOnly;
  const sendLabel = demoChecking
    ? "Checking demo availability..."
    : `Send ${mode === "demo" ? "demo" : "account"} request`;

  async function sendRequest() {
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
    setIsSending(true);
    setError(null);
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
  }

  return (
    <div className="space-y-4">
      <Card className="bg-card/80">
        <CardHeader>
          <CardTitle>{operation.summary}</CardTitle>
          <CardDescription className="font-mono text-xs">
            {operation.method} {operation.path}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <OperationInputForm config={config} operation={operation} onConfigChange={setConfig} />
          {demoReferenceOnly ? (
            <div className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-muted-foreground">
              {demoReferenceOnlyMessage} Curl and endpoint docs remain available; use Your
              account mode with an API key to execute requests.
            </div>
          ) : null}
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <Button disabled={sendDisabled} type="button" onClick={() => void sendRequest()}>
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sendLabel}
          </Button>
        </CardContent>
      </Card>

      <CurlPreviewPanel
        apiKey={apiKey}
        baseUrl={baseUrl}
        config={config}
        mode={mode}
        operation={operation}
      />
      <ResponseViewer response={response} />
      <ScalarAdvancedModal baseUrl={baseUrl} operation={operation} />
    </div>
  );
}
