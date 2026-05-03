import { expect, test } from "vitest";

import type { PlaygroundOperation } from "../types.js";
import { buildCurlCommand } from "./curl.js";

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

test("demo curl is production-shaped and never points at the console proxy", () => {
  const command = buildCurlCommand({
    baseUrl: "https://api.prontiq.dev",
    config: { bodyText: "", pathParams: {}, queryParams: { q: "10 downing" } },
    mode: "demo",
    operation,
  });

  expect(command).toContain("https://api.prontiq.dev/v1/address/autocomplete?q=10+downing");
  expect(command).toContain("X-Api-Key: {{YOUR_API_KEY}}");
  expect(command).not.toContain("/api/playground/demo");
});

test("account curl hides the real key unless explicitly requested", () => {
  const hidden = buildCurlCommand({
    apiKey: "pq_secret",
    baseUrl: "https://api.prontiq.dev",
    config: { bodyText: "", pathParams: {}, queryParams: {} },
    mode: "account",
    operation,
  });
  const revealed = buildCurlCommand({
    apiKey: "pq_secret",
    baseUrl: "https://api.prontiq.dev",
    config: { bodyText: "", pathParams: {}, queryParams: {} },
    includeRealKey: true,
    mode: "account",
    operation,
  });

  expect(hidden).toContain("{{YOUR_API_KEY}}");
  expect(hidden).not.toContain("pq_secret");
  expect(revealed).toContain("pq_secret");
});
