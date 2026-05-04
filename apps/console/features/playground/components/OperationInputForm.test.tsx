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
    { name: "postcode", in: "query", required: true, example: 3000 },
    { name: "limit", in: "query", required: false, example: 5 },
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

function OperationInputFormHost() {
  const [config, setConfig] = useState<PlaygroundRequestConfig>(() =>
    makeInitialRequestConfig(operation),
  );
  return <OperationInputForm config={config} operation={operation} onConfigChange={setConfig} />;
}
