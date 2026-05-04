import { expect, test } from "vitest";

import publicOpenApiSpec from "../../../../../packages/docs/openapi.json";
import { parsePublicOpenApiOperations } from "./openapi.js";
import {
  buildResponseSchemaIndex,
  getResponseSchemaIndex,
  selectResponseSchemaMetadata,
} from "./response-schema-index.js";

test("lazily returns cached response schema indexes for parsed operations", () => {
  const [operation] = parsePublicOpenApiOperations(publicOpenApiSpec);
  expect(operation).toBeDefined();

  const first = getResponseSchemaIndex(operation!);
  const second = getResponseSchemaIndex(operation!);

  expect(first).toBe(second);
  expect(first.byStatus.get("200")?.get("suggestions[].addressLabel")?.description).toBe(
    "Street address (number + street name).",
  );
});

test("schema registry tracks the current parsed spec only", () => {
  const [operation] = parsePublicOpenApiOperations(publicOpenApiSpec);
  expect(operation).toBeDefined();
  expect(getResponseSchemaIndex(operation!).byStatus.size).toBeGreaterThan(0);

  parsePublicOpenApiOperations({ openapi: "3.1.0", paths: {} });

  expect(getResponseSchemaIndex(operation!).byStatus.size).toBe(0);
});

test("returns an empty index for unknown operations without throwing", () => {
  const index = getResponseSchemaIndex({
    method: "GET",
    operationId: "missing",
    path: "/v1/missing",
  });

  expect(index.byStatus.size).toBe(0);
});

test("indexes nested arrays and objects", () => {
  const index = buildResponseSchemaIndex({
    componentsSchemas: {},
    schemasByStatus: {
      "200": {
        properties: {
          suggestions: {
            items: {
              properties: {
                addressLabel: { description: "Address label.", type: "string" },
              },
              type: "object",
            },
            type: "array",
          },
        },
        type: "object",
      },
    },
  });

  expect(index.byStatus.get("200")?.get("suggestions[].addressLabel")?.description).toBe(
    "Address label.",
  );
});

test("omits cycles and unsupported refs without throwing", () => {
  const index = buildResponseSchemaIndex({
    componentsSchemas: {
      Node: {
        properties: {
          child: { $ref: "#/components/schemas/Node" },
          remote: { $ref: "./remote.yaml" },
        },
        type: "object",
      },
    },
    schemasByStatus: {
      "200": { $ref: "#/components/schemas/Node" },
    },
  });

  expect(index.byStatus.get("200")?.get("child")).toBeUndefined();
  expect(index.byStatus.get("200")?.get("remote")).toBeUndefined();
});

test("handles composition conservatively", () => {
  const index = buildResponseSchemaIndex({
    componentsSchemas: {},
    schemasByStatus: {
      "200": {
        allOf: [
          {
            properties: {
              score: { description: "Base score.", minimum: 0, type: "number" },
            },
            type: "object",
          },
          {
            properties: {
              score: { description: "Restricted score.", maximum: 10, type: "number" },
            },
            type: "object",
          },
        ],
      },
      "202": {
        properties: {
          flexible: {
            oneOf: [{ type: "string" }, { type: "number" }],
            description: "Flexible value.",
          },
        },
        type: "object",
      },
    },
  });

  expect(index.byStatus.get("200")?.get("score")).toMatchObject({
    description: "Base score.\nRestricted score.",
    rows: expect.arrayContaining([
      { label: "minimum", value: "0" },
      { label: "maximum", value: "10" },
    ]),
  });
  expect(index.byStatus.get("202")?.get("flexible")).toEqual({
    description: "Flexible value.\nmultiple possible types",
    rows: [{ label: "presence", value: "optional" }],
  });
});

test("allOf conflicting property types keep descriptions but omit misleading constraints", () => {
  const index = buildResponseSchemaIndex({
    componentsSchemas: {},
    schemasByStatus: {
      "200": {
        allOf: [
          {
            properties: {
              value: { description: "String variant.", type: "string" },
            },
            type: "object",
          },
          {
            properties: {
              value: { description: "Numeric variant.", minimum: 1, type: "number" },
            },
            type: "object",
          },
        ],
      },
    },
  });

  expect(index.byStatus.get("200")?.get("value")).toEqual({
    description: "String variant.\nNumeric variant.",
    rows: [],
  });
});

test("selects exact status before same-category success fallback and default", () => {
  const index = buildResponseSchemaIndex({
    componentsSchemas: {},
    schemasByStatus: {
      "200": {
        properties: { ok: { description: "Success.", type: "boolean" } },
        type: "object",
      },
      "400": {
        properties: { error: { description: "Error.", type: "string" } },
        type: "object",
      },
      default: {
        properties: { fallback: { description: "Fallback.", type: "string" } },
        type: "object",
      },
    },
  });

  expect(selectResponseSchemaMetadata({ index, status: 201 })?.get("ok")?.description).toBe("Success.");
  expect(selectResponseSchemaMetadata({ index, status: 400 })?.get("error")?.description).toBe("Error.");
  expect(selectResponseSchemaMetadata({ index, status: 404 })?.get("fallback")?.description).toBe("Fallback.");
});
