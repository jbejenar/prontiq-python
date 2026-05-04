import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";

import type { PlaygroundOperation, PlaygroundRequestConfig } from "../types.js";
import { OperationInputForm, makeInitialRequestConfig } from "./OperationInputForm.js";

const operation: PlaygroundOperation = {
  operationId: "postcode",
  method: "GET",
  path: "/v1/address/lookup/postcode",
  tag: "Address",
  summary: "Lookup postcode",
  parameters: [
    {
      name: "postcode",
      in: "query",
      required: true,
      description: "Australian 4-digit postcode.",
      example: 3000,
      schema: { pattern: "^\\d{4}$", type: "string" },
    },
    {
      name: "limit",
      in: "query",
      required: false,
      example: 5,
      schema: { default: 5, maximum: 50, minimum: 1, type: "integer" },
    },
  ],
  hasJsonRequestBody: false,
  requiresApiKey: true,
};

test("initializes parameter fields from OpenAPI examples", () => {
  const config = makeInitialRequestConfig(operation);

  expect(config.queryParams).toEqual({ postcode: "3000", limit: "5" });
});

test("renders compact parameter fields and updates config", async () => {
  render(<OperationInputFormHost />);

  await userEvent.clear(screen.getByDisplayValue("3000"));
  await userEvent.type(screen.getByRole("textbox", { name: /postcode/i }), "2000");

  expect(screen.getByText("Query")).toBeInTheDocument();
  expect(screen.getByLabelText("required")).toBeInTheDocument();
  expect(screen.getByDisplayValue("2000")).toBeInTheDocument();
});

test("shows OpenAPI metadata for parameter names", async () => {
  render(<OperationInputFormHost />);

  await userEvent.hover(screen.getByText("postcode"));

  expect(await screen.findAllByText("Australian 4-digit postcode.")).not.toHaveLength(0);
  expect(screen.getAllByText("pattern")).not.toHaveLength(0);
  expect(screen.getAllByText("^\\d{4}$")).not.toHaveLength(0);
});

function OperationInputFormHost() {
  const [config, setConfig] = useState<PlaygroundRequestConfig>(() =>
    makeInitialRequestConfig(operation),
  );
  return <OperationInputForm config={config} operation={operation} onConfigChange={setConfig} />;
}
