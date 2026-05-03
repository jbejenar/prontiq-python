import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { PlaygroundOperation, PlaygroundResponse } from "../types.js";
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

function PlaygroundExecutionPanelHost({
  operation: selectedOperation,
}: {
  operation: PlaygroundOperation;
}) {
  return (
    <PlaygroundExecutionPanel
      apiKey=""
      baseUrl="https://api.prontiq.dev"
      mode="demo"
      operation={selectedOperation}
    />
  );
}
