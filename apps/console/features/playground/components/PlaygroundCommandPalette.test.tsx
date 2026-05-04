import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { PlaygroundCommandActionId, PlaygroundOperation } from "../types.js";
import { PlaygroundCommandPalette } from "./PlaygroundCommandPalette.js";

const operations: PlaygroundOperation[] = [
  {
    operationId: "addressAutocomplete",
    method: "GET",
    path: "/v1/address/autocomplete",
    tag: "Address",
    summary: "Autocomplete addresses",
    description: "Search address suggestions",
    parameters: [],
    hasJsonRequestBody: false,
    requiresApiKey: true,
  },
  {
    operationId: "addressValidate",
    method: "POST",
    path: "/v1/address/validate",
    tag: "Address",
    summary: "Validate an address",
    parameters: [],
    hasJsonRequestBody: true,
    requiresApiKey: true,
  },
];

test("searches OpenAPI operations and selects one", async () => {
  const onOperationSelected = vi.fn();
  render(<PaletteHost onOperationSelected={onOperationSelected} />);

  await userEvent.type(screen.getByPlaceholderText(/search operations/i), "validate");
  await userEvent.click(screen.getByText("Validate an address"));

  expect(onOperationSelected).toHaveBeenCalledWith(
    expect.objectContaining({ operationId: "addressValidate" }),
  );
});

test("runs allowlisted command actions", async () => {
  const onActionSelected = vi.fn();
  render(<PaletteHost onActionSelected={onActionSelected} />);

  await userEvent.click(screen.getByText("Run request"));

  expect(onActionSelected).toHaveBeenCalledWith("run_request");
});

test("disables run action when execution controls cannot run", () => {
  render(<PaletteHost canRun={false} />);

  expect(screen.getByText("Run request").closest("[cmdk-item]")).toHaveAttribute("aria-disabled", "true");
});

function PaletteHost({
  canRun = true,
  onActionSelected = vi.fn(),
  onOperationSelected = vi.fn(),
}: {
  canRun?: boolean;
  onActionSelected?: (actionId: PlaygroundCommandActionId) => void;
  onOperationSelected?: (operation: PlaygroundOperation) => void;
}) {
  return (
    <PlaygroundCommandPalette
      canCopyCurl
      canRun={canRun}
      mode="demo"
      open
      operations={operations}
      onActionSelected={onActionSelected}
      onOpenChange={() => undefined}
      onOperationSelected={onOperationSelected}
    />
  );
}
