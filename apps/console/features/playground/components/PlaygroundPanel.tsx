"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCcw, ShieldCheck } from "lucide-react";

import type { PlaygroundMode, PlaygroundOperation } from "../types.js";
import { usePlaygroundDemoStatus } from "../hooks/usePlaygroundDemoStatus.js";
import { usePlaygroundOpenApi } from "../hooks/usePlaygroundOpenApi.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card.js";
import { ApiKeyEntryPanel } from "./ApiKeyEntryPanel.js";
import { EndpointGroupList } from "./EndpointGroupList.js";
import { PlaygroundExecutionPanel } from "./PlaygroundExecutionPanel.js";
import { PlaygroundModeSwitch } from "./PlaygroundModeSwitch.js";
import { usePlaygroundKey } from "./playground-key-provider.js";

export function PlaygroundPanel({ apiBaseUrl }: { apiBaseUrl: string }) {
  const { clearHeldKey, heldKey, scopeVersion } = usePlaygroundKey();
  const [mode, setMode] = useState<PlaygroundMode>(heldKey ? "account" : "demo");
  const [manualKey, setManualKey] = useState("");
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const lastScopeVersion = useRef(scopeVersion);
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

  function updateManualKey(value: string) {
    if (heldKey) clearHeldKey();
    setManualKey(value);
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <Badge>p1c.06</Badge>
          <div>
            <h1 className="text-5xl leading-none tracking-tight sm:text-6xl">API playground</h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
              Explore the public API from the committed OpenAPI spec. Demo mode uses a server-side
              demo key; account mode uses an API key held only in memory.
            </p>
          </div>
        </div>
        <PlaygroundModeSwitch mode={mode} onModeChange={setMode} />
      </section>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" />
            Usage controls
          </CardTitle>
          <CardDescription>
            Demo requests are Clerk-authenticated, same-origin checked, OpenAPI path/method
            validated, and sent with a server-held demo key. Usage, quota, rate limits, billing
            events, and abuse controls are enforced by the backend policy attached to that demo key.
          </CardDescription>
        </CardHeader>
      </Card>

      {mode === "account" ? (
        <ApiKeyEntryPanel
          apiKey={apiKey}
          onApiKeyChange={updateManualKey}
          onClear={() => {
            clearHeldKey();
            setManualKey("");
          }}
        />
      ) : null}

      {openApiQuery.isPending ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading public API spec...
          </CardContent>
        </Card>
      ) : openApiQuery.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Could not load the playground</CardTitle>
            <CardDescription>{openApiQuery.error.message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={() => void openApiQuery.refetch()}>
              <RefreshCcw className="h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : operations.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No public endpoints available</CardTitle>
            <CardDescription>
              The committed OpenAPI spec did not expose any public `/v1` operations.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <EndpointGroupList
            operations={operations}
            selectedOperationId={selectedOperation?.operationId ?? null}
            onSelect={(operation: PlaygroundOperation) => setSelectedOperationId(operation.operationId)}
          />
          {selectedOperation ? (
            <PlaygroundExecutionPanel
              apiKey={apiKey}
              baseUrl={apiBaseUrl}
              demoStatus={demoStatusQuery.data ?? null}
              isDemoStatusLoading={demoStatusQuery.isPending}
              mode={mode}
              operation={selectedOperation}
            />
          ) : null}
        </section>
      )}
    </div>
  );
}
