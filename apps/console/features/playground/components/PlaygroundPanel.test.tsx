import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import type { PlaygroundOperation } from "../types.js";
import type * as RequestModule from "../lib/request.js";

const playgroundKeyMocks = vi.hoisted(() => ({
  clearHeldKey: vi.fn(),
  usePlaygroundKey: vi.fn(),
}));

const queryMocks = vi.hoisted(() => ({
  usePlaygroundDemoStatus: vi.fn(),
  usePlaygroundOpenApi: vi.fn(),
}));

const requestMocks = vi.hoisted(() => ({
  executeDemoRequest: vi.fn(),
}));

const telemetryMocks = vi.hoisted(() => ({
  recordPlaygroundInteractionTelemetry: vi.fn(),
  recordPlaygroundTelemetry: vi.fn(),
}));

vi.mock("./playground-key-provider.js", () => ({
  usePlaygroundKey: playgroundKeyMocks.usePlaygroundKey,
}));

vi.mock("../hooks/usePlaygroundDemoStatus.js", () => ({
  usePlaygroundDemoStatus: queryMocks.usePlaygroundDemoStatus,
}));

vi.mock("../hooks/usePlaygroundOpenApi.js", () => ({
  usePlaygroundOpenApi: queryMocks.usePlaygroundOpenApi,
}));

vi.mock("../lib/request.js", async (importOriginal) => {
  const original = await importOriginal<typeof RequestModule>();
  return {
    ...original,
    executeDemoRequest: requestMocks.executeDemoRequest,
  };
});

vi.mock("../lib/telemetry.js", () => telemetryMocks);

import { PlaygroundPanel } from "./PlaygroundPanel.js";

const operations: PlaygroundOperation[] = [
  {
    operationId: "addressAutocomplete",
    method: "GET",
    path: "/v1/address/autocomplete",
    tag: "Address",
    summary: "Autocomplete addresses",
    parameters: [
      {
        name: "q",
        in: "query",
        required: true,
        example: "2000",
      },
    ],
    hasJsonRequestBody: false,
    requiresApiKey: true,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  requestMocks.executeDemoRequest.mockResolvedValue({
    bodyText: JSON.stringify({ ok: true }),
    durationMs: 20,
    headers: {},
    ok: true,
    status: 200,
    statusText: "OK",
  });
  playgroundKeyMocks.usePlaygroundKey.mockReturnValue({
    clearHeldKey: playgroundKeyMocks.clearHeldKey,
    heldKey: null,
    scopeVersion: 0,
  });
  queryMocks.usePlaygroundDemoStatus.mockReturnValue({
    data: { execution: "enabled" },
    isPending: false,
  });
  queryMocks.usePlaygroundOpenApi.mockReturnValue({
    data: operations,
    error: null,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  });
});

test("focus operation filter palette action leaves focus on the filter after dialog close", async () => {
  render(<PlaygroundPanel apiBaseUrl="https://api.prontiq.dev" />);

  await userEvent.keyboard("{Meta>}k{/Meta}");
  await userEvent.click(screen.getByText("Focus operation filter"));

  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/filter operations/i)).toHaveFocus();
  });
});

test("opens command palette from the visible footer affordance", async () => {
  render(<PlaygroundPanel apiBaseUrl="https://api.prontiq.dev" />);

  await userEvent.click(screen.getByRole("button", { name: /open command palette/i }));

  expect(screen.getByRole("dialog", { name: /playground command palette/i })).toBeInTheDocument();
});

test("focus language tabs palette action leaves focus on curl tab after dialog close", async () => {
  render(<PlaygroundPanel apiBaseUrl="https://api.prontiq.dev" />);

  await userEvent.keyboard("{Meta>}k{/Meta}");
  await userEvent.click(screen.getByText("Focus language tabs"));

  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "curl" })).toHaveFocus();
  });
});

test("clears memory-only request history on key scope changes", async () => {
  const { rerender } = render(<PlaygroundPanel apiBaseUrl="https://api.prontiq.dev" />);

  await userEvent.click(screen.getByRole("button", { name: /send demo request/i }));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: /open request history/i })).toHaveTextContent("history 1"),
  );

  playgroundKeyMocks.usePlaygroundKey.mockReturnValue({
    clearHeldKey: playgroundKeyMocks.clearHeldKey,
    heldKey: null,
    scopeVersion: 1,
  });
  rerender(<PlaygroundPanel apiBaseUrl="https://api.prontiq.dev" />);

  await waitFor(() =>
    expect(screen.getByRole("button", { name: /open request history/i })).toHaveTextContent("history 0"),
  );
});

test("records history interaction telemetry with allowlisted fields only", async () => {
  render(<PlaygroundPanel apiBaseUrl="https://api.prontiq.dev" />);

  await userEvent.click(screen.getByRole("button", { name: /open request history/i }));

  const event = telemetryMocks.recordPlaygroundInteractionTelemetry.mock.calls.at(-1)?.[0];
  expect(event).toEqual({
    eventName: "history_opened",
    mode: "demo",
    source: "console_playground",
  });
  expect(Object.keys(event ?? {}).sort()).toEqual(["eventName", "mode", "source"]);
});
