import { test, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import publicOpenApiSpec from "../../../../../packages/docs/openapi.json";
import { parsePublicOpenApiOperations } from "./openapi.js";
import { getResponseSchemaIndex } from "./response-schema-index.js";

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
  const postcode = operations
    .find((operation) => operation.path === "/v1/address/lookup/postcode")
    ?.parameters.find((parameter) => parameter.name === "postcode");
  expect(postcode).toMatchObject({
    description: "Australian 4-digit postcode.",
    schema: { pattern: "^\\d{4}$", type: "string" },
  });
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

test("JSON-compatible OpenAPI media types drive request body and response schema extraction", () => {
  const operations = parsePublicOpenApiOperations({
    openapi: "3.1.0",
    paths: {
      "/v1/problem": {
        post: {
          operationId: "createProblem",
          summary: "Create problem",
          requestBody: {
            content: {
              "application/problem+json": {
                example: { title: "Invalid request" },
              },
            },
          },
          responses: {
            "400": {
              content: {
                "application/problem+json": {
                  schema: {
                    properties: {
                      title: { description: "Problem title.", type: "string" },
                    },
                    type: "object",
                  },
                },
              },
            },
          },
        },
      },
      "/v1/vendor": {
        get: {
          operationId: "getVendor",
          summary: "Get vendor",
          responses: {
            "200": {
              content: {
                "application/vnd.prontiq.address+json": {
                  schema: {
                    properties: {
                      value: { description: "Vendor JSON value.", type: "string" },
                    },
                    type: "object",
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const problem = operations.find((operation) => operation.operationId === "createProblem");
  const vendor = operations.find((operation) => operation.operationId === "getVendor");

  expect(problem).toMatchObject({
    hasJsonRequestBody: true,
    requestBodyExample: { title: "Invalid request" },
  });
  expect(getResponseSchemaIndex(problem!).byStatus.get("400")?.get("title")?.description).toBe("Problem title.");
  expect(getResponseSchemaIndex(vendor!).byStatus.get("200")?.get("value")?.description).toBe(
    "Vendor JSON value.",
  );
});

test("runtime playground code does not hard-code spec field descriptions", async () => {
  const descriptions = collectDescriptions(publicOpenApiSpec)
    .filter((description) => description.length > 18)
    .slice(0, 200);
  const files = await listRuntimePlaygroundFiles(join(process.cwd(), "features/playground"));

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const description of descriptions) {
      expect(source.includes(description), `${file} hard-codes "${description}"`).toBe(false);
    }
  }
});

function collectDescriptions(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectDescriptions);
  if (typeof value !== "object" || value === null) return [];
  const entries = Object.entries(value);
  return entries.flatMap(([key, entryValue]) => [
    ...(key === "description" && typeof entryValue === "string" ? [entryValue] : []),
    ...collectDescriptions(entryValue),
  ]);
}

async function listRuntimePlaygroundFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listRuntimePlaygroundFiles(path);
      if (!/\.(ts|tsx)$/.test(entry.name)) return [];
      if (entry.name.includes(".test.") || entry.name.includes(".fixtures.")) return [];
      if (path.includes(`${join("lib", "schema-metadata")}`)) return [];
      if (path.includes(`${join("lib", "response-schema-index")}`)) return [];
      return [path];
    }),
  );
  return files.flat();
}
