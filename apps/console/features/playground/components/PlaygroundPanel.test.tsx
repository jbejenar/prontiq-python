import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import type { PlaygroundOperation } from "../types.js";

const playgroundKeyMocks = vi.hoisted(() => ({
  clearHeldKey: vi.fn(),
  usePlaygroundKey: vi.fn(),
}));

const queryMocks = vi.hoisted(() => ({
  usePlaygroundDemoStatus: vi.fn(),
  usePlaygroundOpenApi: vi.fn(),
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

  await userEvent.click(screen.getByRole("button", { name: /open command palette/i }));
  await userEvent.click(screen.getByText("Focus operation filter"));

  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/filter operations/i)).toHaveFocus();
  });
});

test("focus language tabs palette action leaves focus on curl tab after dialog close", async () => {
  render(<PlaygroundPanel apiBaseUrl="https://api.prontiq.dev" />);

  await userEvent.click(screen.getByRole("button", { name: /open command palette/i }));
  await userEvent.click(screen.getByText("Focus language tabs"));

  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "curl" })).toHaveFocus();
  });
});
