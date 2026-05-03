import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import type { PlaygroundDemoStatus, PlaygroundMode, PlaygroundOperation, PlaygroundResponse } from "../types.js";
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

vi.mock("./ScalarAdvancedModal.js", () => ({
  ScalarAdvancedModal: ({ operation }: { operation: PlaygroundOperation }) => (
    <div>Scalar {operation.operationId}</div>
  ),
}));

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

function PlaygroundExecutionPanelHost({
  apiKey = "",
  demoStatus = { execution: "enabled" },
  isDemoStatusLoading = false,
  mode = "demo",
  operation: selectedOperation,
}: {
  apiKey?: string;
  demoStatus?: PlaygroundDemoStatus | null;
  isDemoStatusLoading?: boolean;
  mode?: PlaygroundMode;
  operation: PlaygroundOperation;
}) {
  return (
    <PlaygroundExecutionPanel
      apiKey={apiKey}
      baseUrl="https://api.prontiq.dev"
      demoStatus={demoStatus}
      isDemoStatusLoading={isDemoStatusLoading}
      mode={mode}
      operation={selectedOperation}
    />
  );
}
