import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import type { PlaygroundOperation } from "../types.js";
import { CurlPreviewPanel } from "./CurlPreviewPanel.js";

const operation: PlaygroundOperation = {
  operationId: "autocomplete",
  method: "GET",
  path: "/v1/address/autocomplete",
  tag: "Address",
  summary: "Autocomplete",
  parameters: [{ name: "q", in: "query", required: true }],
  hasJsonRequestBody: false,
  requiresApiKey: true,
};

test("requires explicit approval per raw key before rendering it in curl", async () => {
  const { rerender } = render(
    <CurlPreviewPanel
      apiKey="pq_first"
      baseUrl="https://api.prontiq.dev"
      config={{ bodyText: "", pathParams: {}, queryParams: {} }}
      mode="account"
      operation={operation}
    />,
  );

  expect(screen.getByText(/X-Api-Key: \{\{YOUR_API_KEY\}\}/i)).toBeInTheDocument();
  expect(screen.queryByText(/pq_first/i)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /use real key in curl/i }));
  expect(screen.getByText(/pq_first/i)).toBeInTheDocument();

  rerender(
    <CurlPreviewPanel
      apiKey="pq_second"
      baseUrl="https://api.prontiq.dev"
      config={{ bodyText: "", pathParams: {}, queryParams: {} }}
      mode="account"
      operation={operation}
    />,
  );

  await waitFor(() => {
    expect(screen.queryByText(/pq_second/i)).not.toBeInTheDocument();
  });
  expect(screen.getByText(/X-Api-Key: \{\{YOUR_API_KEY\}\}/i)).toBeInTheDocument();
});
