import { expect, test } from "vitest";

import type { PlaygroundOperation } from "../types.js";
import {
  assertSafeTemplatePath,
  parseDemoProxyPayload,
  validateDemoProxyPayloadForOperation,
} from "./demo-proxy.js";

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

test("parses a valid demo proxy payload", () => {
  expect(
    parseDemoProxyPayload({
      bodyText: "",
      method: "get",
      path: "/v1/address/autocomplete",
      pathParams: {},
      queryParams: { q: "melbourne" },
    }),
  ).toMatchObject({
    method: "GET",
    path: "/v1/address/autocomplete",
    queryParams: { q: "melbourne" },
  });
});

test("rejects payload-level forwarded headers and unknown fields", () => {
  expect(
    parseDemoProxyPayload({
      bodyText: "",
      headers: { "x-api-key": "customer_key" },
      method: "GET",
      path: "/v1/address/autocomplete",
      pathParams: {},
      queryParams: { q: "melbourne" },
    }),
  ).toBeNull();
  expect(
    parseDemoProxyPayload({
      bodyText: "",
      method: "GET",
      path: "/v1/address/autocomplete",
      pathParams: {},
      queryParams: { q: "melbourne" },
      url: "https://api.prontiq.dev/v1/address/autocomplete",
    }),
  ).toBeNull();
});

test("rejects unsafe proxy path templates", () => {
  expect(assertSafeTemplatePath("/v1/address/autocomplete")).toBe(true);
  expect(assertSafeTemplatePath("/v1/example/{id}")).toBe(true);
  expect(assertSafeTemplatePath("https://api.prontiq.dev/v1/address/autocomplete")).toBe(false);
  expect(assertSafeTemplatePath("//api.prontiq.dev/v1/address/autocomplete")).toBe(false);
  expect(assertSafeTemplatePath("/v1/account/keys")).toBe(false);
  expect(assertSafeTemplatePath("/v1/../account/keys")).toBe(false);
  expect(assertSafeTemplatePath("/v1/%2e%2e/account/keys")).toBe(false);
  expect(assertSafeTemplatePath("/v1/%")).toBe(false);
});

test("validates supplied parameters against the operation contract", () => {
  expect(
    validateDemoProxyPayloadForOperation(operation, {
      bodyText: "",
      method: "GET",
      path: "/v1/address/autocomplete",
      pathParams: {},
      queryParams: { q: "melbourne" },
    }),
  ).toBeNull();
  expect(
    validateDemoProxyPayloadForOperation(operation, {
      bodyText: "",
      method: "GET",
      path: "/v1/address/autocomplete",
      pathParams: {},
      queryParams: { extra: "value", q: "melbourne" },
    }),
  ).toMatchObject({ code: "UNDECLARED_DEMO_PARAMETER" });
  expect(
    validateDemoProxyPayloadForOperation(operation, {
      bodyText: "",
      method: "GET",
      path: "/v1/address/autocomplete",
      pathParams: {},
      queryParams: {},
    }),
  ).toMatchObject({ code: "MISSING_DEMO_PARAMETER" });
});

test("rejects oversized demo payload fields before proxying", () => {
  expect(
    validateDemoProxyPayloadForOperation(operation, {
      bodyText: "",
      method: "GET",
      path: "/v1/address/autocomplete",
      pathParams: {},
      queryParams: { q: "x".repeat(2_049) },
    }),
  ).toMatchObject({ code: "DEMO_REQUEST_TOO_LARGE" });
});
