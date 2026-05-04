import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import type {
  PlaygroundDemoStatus,
  PlaygroundHistoryEntry,
  PlaygroundMode,
  PlaygroundOperation,
  PlaygroundResponse,
} from "../types.js";
import type * as RequestModule from "../lib/request.js";

const requestMocks = vi.hoisted(() => ({
  executeAccountRequest: vi.fn(),
  executeDemoRequest: vi.fn(),
}));

const telemetryMocks = vi.hoisted(() => ({
  recordPlaygroundTelemetry: vi.fn(),
}));

vi.mock("../lib/request.js", async (importOriginal) => {
  const original = await importOriginal<typeof RequestModule>();
  return {
    ...original,
    executeAccountRequest: requestMocks.executeAccountRequest,
    executeDemoRequest: requestMocks.executeDemoRequest,
  };
});

vi.mock("../lib/telemetry.js", () => telemetryMocks);

import { PlaygroundExecutionPanel } from "./PlaygroundExecutionPanel.js";

beforeEach(() => {
  vi.clearAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

function operation(operationId: string, summary: string): PlaygroundOperation {
  return {
    operationId,
    method: "GET",
    path: `/v1/address/${operationId}`,
    tag: "Address",
    summary,
    parameters: [],
    hasJsonRequestBody: false,
    requiresApiKey: true,
  };
}

function operationWithQuery(operationId: string, summary: string): PlaygroundOperation {
  return {
    ...operation(operationId, summary),
    parameters: [
      {
        name: "q",
        in: "query",
        required: true,
        example: "2000",
      },
    ],
  };
}

const oldResponse: PlaygroundResponse = {
  bodyText: JSON.stringify({ stale: true }),
  durationMs: 120,
  headers: {},
  ok: true,
  status: 200,
  statusText: "OK",
};

test("ignores stale responses after the selected operation changes", async () => {
  const oldRequest = deferred<PlaygroundResponse>();
  requestMocks.executeDemoRequest.mockReturnValueOnce(oldRequest.promise);
  const { rerender } = render(
    <PlaygroundExecutionPanelHost operation={operation("autocomplete", "Autocomplete")} />,
  );

  await userEvent.click(screen.getByRole("button", { name: /send demo request/i }));
  expect(requestMocks.executeDemoRequest).toHaveBeenCalledTimes(1);

  rerender(<PlaygroundExecutionPanelHost operation={operation("validate", "Validate")} />);

  await act(async () => {
    oldRequest.resolve(oldResponse);
    await oldRequest.promise;
  });

  expect(screen.getByText("Validate")).toBeInTheDocument();
  expect(screen.queryByText(/stale/i)).not.toBeInTheDocument();
  expect(telemetryMocks.recordPlaygroundTelemetry).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /send demo request/i })).not.toBeDisabled(),
  );
});

test("disables demo execution while demo availability is loading", () => {
  render(
    <PlaygroundExecutionPanelHost
      demoStatus={null}
      isDemoStatusLoading={true}
      operation={operation("autocomplete", "Autocomplete")}
    />,
  );

  expect(screen.getByRole("button", { name: /checking demo availability/i })).toBeDisabled();
});

test("makes demo mode reference-only when demo execution is unavailable", async () => {
  render(
    <PlaygroundExecutionPanelHost
      demoStatus={{
        execution: "reference_only",
        reasonCode: "DEMO_KEY_NOT_CONFIGURED",
        message: "Demo execution is unavailable on this deployment because the demo key is not configured.",
      }}
      operation={operation("autocomplete", "Autocomplete")}
    />,
  );

  expect(screen.getByText(/Demo execution is unavailable on this deployment/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /send demo request/i })).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: /send demo request/i }));

  expect(requestMocks.executeDemoRequest).not.toHaveBeenCalled();
});

test("fails closed when demo status is unavailable after loading", () => {
  render(
    <PlaygroundExecutionPanelHost
      demoStatus={null}
      isDemoStatusLoading={false}
      operation={operation("autocomplete", "Autocomplete")}
    />,
  );

  expect(screen.getByText(/Demo execution availability could not be confirmed/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /send demo request/i })).toBeDisabled();
});

test("keeps account execution independent of demo reference-only status", async () => {
  requestMocks.executeAccountRequest.mockResolvedValueOnce({
    bodyText: JSON.stringify({ ok: true }),
    durationMs: 20,
    headers: {},
    ok: true,
    status: 200,
    statusText: "OK",
  });

  render(
    <PlaygroundExecutionPanelHost
      apiKey="pq_live_test"
      demoStatus={{
        execution: "reference_only",
        reasonCode: "DEMO_KEY_NOT_CONFIGURED",
        message: "Demo execution is unavailable on this deployment because the demo key is not configured.",
      }}
      mode="account"
      operation={operation("autocomplete", "Autocomplete")}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: /send account request/i }));

  expect(requestMocks.executeAccountRequest).toHaveBeenCalledTimes(1);
});

test("appends history only after a real HTTP response", async () => {
  const onAppendHistory = vi.fn();
  requestMocks.executeDemoRequest.mockResolvedValueOnce({
    bodyText: JSON.stringify({ ok: true }),
    durationMs: 33,
    headers: {},
    ok: true,
    status: 200,
    statusText: "OK",
  });

  render(
    <PlaygroundExecutionPanelHost
      onAppendHistory={onAppendHistory}
      operation={operation("autocomplete", "Autocomplete")}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: /send demo request/i }));

  await waitFor(() => expect(onAppendHistory).toHaveBeenCalledTimes(1));
  expect(onAppendHistory).toHaveBeenCalledWith(
    expect.objectContaining({
      latencyMs: 33,
      mode: "demo",
      operation: expect.objectContaining({ operationId: "autocomplete" }),
      status: 200,
    }),
  );
});

test("does not append history for network failures without HTTP status", async () => {
  const onAppendHistory = vi.fn();
  requestMocks.executeDemoRequest.mockRejectedValueOnce(new Error("Failed to fetch"));

  render(
    <PlaygroundExecutionPanelHost
      onAppendHistory={onAppendHistory}
      operation={operation("autocomplete", "Autocomplete")}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: /send demo request/i }));

  await waitFor(() => expect(screen.getByText(/failed to fetch/i)).toBeInTheDocument());
  expect(onAppendHistory).not.toHaveBeenCalled();
});

test("restores pending history config without refiring the request", async () => {
  const onPendingHistoryApplied = vi.fn();
  const pendingEntry: PlaygroundHistoryEntry = {
    config: {
      bodyText: "",
      pathParams: {},
      queryParams: { q: "3000" },
    },
    id: "hist_pending",
    latencyMs: 44,
    mode: "demo",
    operation: {
      method: "GET",
      operationId: "autocomplete",
      path: "/v1/address/autocomplete",
      summary: "Autocomplete",
      tag: "Address",
    },
    requestDisplayId: "fedcba",
    status: 200,
    timestamp: "2026-05-04T00:00:00.000Z",
  };

  render(
    <PlaygroundExecutionPanelHost
      onPendingHistoryApplied={onPendingHistoryApplied}
      pendingHistoryEntry={pendingEntry}
      operation={operationWithQuery("autocomplete", "Autocomplete")}
    />,
  );

  await waitFor(() => expect(screen.getByRole("textbox", { name: /q required/i })).toHaveValue("3000"));
  expect(screen.getByText(/request #fedcba/i)).toBeInTheDocument();
  expect(requestMocks.executeDemoRequest).not.toHaveBeenCalled();
  expect(onPendingHistoryApplied).toHaveBeenCalledTimes(1);
});

test("does not render the raw account key in the redesigned curl panel", () => {
  render(
    <PlaygroundExecutionPanelHost
      apiKey="pq_live_secret_value"
      mode="account"
      operation={operation("autocomplete", "Autocomplete")}
    />,
  );

  expect(screen.getByText(/X-Api-Key: \{\{YOUR_API_KEY\}\}/i)).toBeInTheDocument();
  expect(screen.queryByText(/pq_live_secret_value/i)).not.toBeInTheDocument();
});

function PlaygroundExecutionPanelHost({
  apiKey = "",
  demoStatus = { execution: "enabled" },
  historyEntries = [],
  historyOpen = false,
  isDemoStatusLoading = false,
  mode = "demo",
  onAppendHistory = vi.fn(),
  onClearHistory = vi.fn(),
  onHistoryEntrySelect = vi.fn(),
  onHistoryOpenChange = vi.fn(),
  onPendingHistoryApplied = vi.fn(),
  pendingHistoryEntry = null,
  operation: selectedOperation,
}: {
  apiKey?: string;
  demoStatus?: PlaygroundDemoStatus | null;
  historyEntries?: readonly PlaygroundHistoryEntry[];
  historyOpen?: boolean;
  isDemoStatusLoading?: boolean;
  mode?: PlaygroundMode;
  onAppendHistory?: (entry: PlaygroundHistoryEntry) => void;
  onClearHistory?: () => void;
  onHistoryEntrySelect?: (entry: PlaygroundHistoryEntry) => void;
  onHistoryOpenChange?: (open: boolean) => void;
  onPendingHistoryApplied?: () => void;
  pendingHistoryEntry?: PlaygroundHistoryEntry | null;
  operation: PlaygroundOperation;
}) {
  return (
    <PlaygroundExecutionPanel
      apiKey={apiKey}
      baseUrl="https://api.prontiq.dev"
      clearApiKey={() => undefined}
      demoStatus={demoStatus}
      historyEntries={historyEntries}
      historyOpen={historyOpen}
      isDemoStatusLoading={isDemoStatusLoading}
      mode={mode}
      operation={selectedOperation}
      pendingHistoryEntry={pendingHistoryEntry}
      onAppendHistory={onAppendHistory}
      onClearHistory={onClearHistory}
      onHistoryEntrySelect={onHistoryEntrySelect}
      onHistoryOpenChange={onHistoryOpenChange}
      onOpenCommandPalette={() => undefined}
      onPendingHistoryApplied={onPendingHistoryApplied}
      updateApiKey={() => undefined}
    />
  );
}
