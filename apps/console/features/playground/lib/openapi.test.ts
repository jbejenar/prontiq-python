import { test, expect } from "vitest";

import publicOpenApiSpec from "../../../../../packages/docs/openapi.json";
import { parsePublicOpenApiOperations } from "./openapi.js";

test("parses the six public address operations from the committed spec", () => {
  const operations = parsePublicOpenApiOperations(publicOpenApiSpec);

  expect(operations.map((operation) => `${operation.method} ${operation.path}`)).toEqual([
    "GET /v1/address/autocomplete",
    "GET /v1/address/enrich",
    "GET /v1/address/lookup/postcode",
    "GET /v1/address/lookup/suburb",
    "GET /v1/address/reverse",
    "GET /v1/address/validate",
  ]);
  expect(operations.every((operation) => operation.requiresApiKey)).toBe(true);
});

test("does not expose private account operations", () => {
  const operations = parsePublicOpenApiOperations({
    openapi: "3.1.0",
    paths: {
      "/v1/account/keys": {
        get: { operationId: "listKeys", summary: "List keys" },
      },
      "/v1/example": {
        get: { operationId: "example", summary: "Example" },
      },
    },
  });

  expect(operations).toHaveLength(1);
  expect(operations[0]?.path).toBe("/v1/example");
});

test("fixture-added public paths appear without hard-coded component changes", () => {
  const operations = parsePublicOpenApiOperations({
    openapi: "3.1.0",
    security: [{ ApiKeyAuth: [] }],
    paths: {
      "/v1/new-capability/{id}": {
        get: {
          operationId: "getNewCapability",
          summary: "Get new capability",
          tags: ["Future"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        },
      },
    },
  });

  expect(operations[0]).toMatchObject({
    method: "GET",
    path: "/v1/new-capability/{id}",
    operationId: "getNewCapability",
    tag: "Future",
  });
});
