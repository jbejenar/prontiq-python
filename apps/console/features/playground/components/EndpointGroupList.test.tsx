import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { PlaygroundOperation } from "../types.js";
import { EndpointGroupList } from "./EndpointGroupList.js";

const operations: PlaygroundOperation[] = [
  {
    operationId: "autocomplete",
    method: "GET",
    path: "/v1/address/autocomplete",
    tag: "Address",
    summary: "Autocomplete addresses",
    parameters: [],
    hasJsonRequestBody: false,
    requiresApiKey: true,
  },
  {
    operationId: "validate",
    method: "POST",
    path: "/v1/address/validate",
    tag: "Address",
    summary: "Validate an address",
    parameters: [],
    hasJsonRequestBody: true,
    requiresApiKey: true,
  },
  {
    operationId: "future",
    method: "DELETE",
    path: "/v1/future/{id}",
    tag: "Future",
    summary: "Future operation",
    parameters: [],
    hasJsonRequestBody: false,
    requiresApiKey: true,
  },
];

test("renders operations grouped by OpenAPI tag with stripped address paths", () => {
  render(
    <EndpointGroupList operations={operations} selectedOperationId="autocomplete" onSelect={vi.fn()} />,
  );

  expect(screen.getByText("Address")).toBeInTheDocument();
  expect(screen.getByText("Future")).toBeInTheDocument();
  expect(screen.getByText("autocomplete")).toBeInTheDocument();
  expect(screen.getByText("/v1/future/{id}")).toBeInTheDocument();
});

test("filters operations and selects through button semantics", async () => {
  const onSelect = vi.fn();
  render(<EndpointGroupList operations={operations} selectedOperationId={null} onSelect={onSelect} />);

  await userEvent.type(screen.getByLabelText(/filter operations/i), "validate");

  expect(screen.queryByText("autocomplete")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /post validate/i }));

  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ operationId: "validate" }));
});
