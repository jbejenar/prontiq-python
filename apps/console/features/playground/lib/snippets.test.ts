import { expect, test } from "vitest";

import type { PlaygroundOperation, PlaygroundRequestConfig } from "../types.js";
import {
  buildPlaygroundSnippetHarRequest,
  compactSnippetWhitespace,
  generatePlaygroundSnippet,
  getSnippetPrismLanguage,
  playgroundSnippetLanguages,
} from "./snippets.js";

const getOperation: PlaygroundOperation = {
  operationId: "addressAutocomplete",
  method: "GET",
  path: "/v1/address/autocomplete",
  tag: "Address",
  summary: "Autocomplete addresses",
  parameters: [{ name: "q", in: "query", required: true }],
  hasJsonRequestBody: false,
  requiresApiKey: true,
};

const postOperation: PlaygroundOperation = {
  operationId: "addressVerify",
  method: "POST",
  path: "/v1/address/verify/{postcode}",
  tag: "Address",
  summary: "Verify an address",
  parameters: [{ name: "postcode", in: "path", required: true }],
  hasJsonRequestBody: true,
  requiresApiKey: true,
};

const getConfig: PlaygroundRequestConfig = {
  bodyText: "",
  pathParams: {},
  queryParams: { q: "10 downing" },
};

test("exports the six playground snippet languages in tab order", () => {
  expect(playgroundSnippetLanguages).toEqual(["curl", "node.js", "python", "java", "go", "ruby"]);
  expect(getSnippetPrismLanguage("curl")).toBe("bash");
  expect(getSnippetPrismLanguage("node.js")).toBe("javascript");
  expect(getSnippetPrismLanguage("python")).toBe("python");
  expect(getSnippetPrismLanguage("java")).toBe("java");
});

test("builds HAR request input with production URL and placeholder auth", () => {
  const har = buildPlaygroundSnippetHarRequest({
    baseUrl: "https://api.prontiq.dev",
    config: getConfig,
    operation: getOperation,
  });

  expect(har).toEqual({
    headers: [
      { name: "Accept", value: "application/json" },
      { name: "X-Api-Key", value: "{{YOUR_API_KEY}}" },
    ],
    method: "GET",
    url: "https://api.prontiq.dev/v1/address/autocomplete?q=10+downing",
  });
});

test("builds HAR request input with validated JSON body", () => {
  const har = buildPlaygroundSnippetHarRequest({
    baseUrl: "https://api.prontiq.dev",
    config: {
      bodyText: '{ "address": "1 Example Street" }',
      pathParams: { postcode: "2000" },
      queryParams: {},
    },
    operation: postOperation,
  });

  expect(har).toMatchObject({
    headers: [
      { name: "Accept", value: "application/json" },
      { name: "X-Api-Key", value: "{{YOUR_API_KEY}}" },
      { name: "Content-Type", value: "application/json" },
    ],
    method: "POST",
    postData: { mimeType: "application/json", text: '{ "address": "1 Example Street" }' },
    url: "https://api.prontiq.dev/v1/address/verify/2000",
  });
});

test("rejects invalid JSON bodies before snippet generation", async () => {
  await expect(
    generatePlaygroundSnippet({
      baseUrl: "https://api.prontiq.dev",
      config: {
        bodyText: "{ invalid",
        pathParams: { postcode: "2000" },
        queryParams: {},
      },
      language: "python",
      mode: "demo",
      operation: postOperation,
    }),
  ).rejects.toMatchObject({ code: "INVALID_JSON_BODY" });
});

test("generates production-shaped snippets without raw account keys", async () => {
  const common = {
    apiKey: "pq_live_000000000000000000000000000000000000000000000000",
    baseUrl: "https://api.prontiq.dev",
    config: getConfig,
    mode: "account" as const,
    operation: getOperation,
  };

  const nodeSnippet = await generatePlaygroundSnippet({ ...common, language: "node.js" });
  const pythonSnippet = await generatePlaygroundSnippet({ ...common, language: "python" });
  const javaSnippet = await generatePlaygroundSnippet({ ...common, language: "java" });
  const goSnippet = await generatePlaygroundSnippet({ ...common, language: "go" });
  const rubySnippet = await generatePlaygroundSnippet({ ...common, language: "ruby" });

  for (const snippet of [nodeSnippet, pythonSnippet, javaSnippet, goSnippet, rubySnippet]) {
    expect(snippet).toContain("https://api.prontiq.dev/v1/address/autocomplete");
    expect(snippet).toContain("{{YOUR_API_KEY}}");
    expect(snippet).not.toContain("pq_live_000000000000000000000000000000000000000000000000");
  }

  expect(nodeSnippet).toContain("fetch(");
  expect(nodeSnippet).not.toContain("node-fetch");
  expect(pythonSnippet).toContain("requests.get");
  expect(javaSnippet).toContain("HttpRequest");
  expect(goSnippet).toContain("http.NewRequest");
  expect(rubySnippet).toContain("Net::HTTP");
});

test("compacts excessive generated snippet blank lines", () => {
  expect(compactSnippetWhitespace("one\n\n\ntwo\n\n\n\nthree")).toBe("one\n\ntwo\n\nthree");
});

test("curl snippet delegates to the existing curl command builder", async () => {
  const snippet = await generatePlaygroundSnippet({
    baseUrl: "https://api.prontiq.dev",
    config: getConfig,
    language: "curl",
    mode: "demo",
    operation: getOperation,
  });

  expect(snippet).toContain("curl 'https://api.prontiq.dev/v1/address/autocomplete?q=10+downing'");
  expect(snippet).toContain("X-Api-Key: {{YOUR_API_KEY}}");
  expect(snippet).not.toContain("/api/playground/demo");
});
