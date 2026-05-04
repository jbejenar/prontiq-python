import type { OpenApiParameter, PlaygroundOperation } from "../types.js";
import { findJsonContentEntry } from "./json-media.js";

type JsonObject = Record<string, unknown>;

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const responseSchemaRegistry = new Map<string, ResponseSchemaRegistryEntry>();

export interface ResponseSchemaRegistryEntry {
  componentsSchemas: Record<string, unknown>;
  schemasByStatus: Record<string, unknown>;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function getFirstTag(operation: JsonObject) {
  const [tag] = asArray(operation.tags).filter((item): item is string => typeof item === "string");
  return tag ?? "API";
}

function parseParameter(value: unknown): OpenApiParameter | null {
  if (!isObject(value)) return null;
  const name = asString(value.name);
  const location = asString(value.in);
  if (!name || !location) return null;
  if (!["path", "query", "header", "cookie"].includes(location)) return null;
  return {
    name,
    in: location as OpenApiParameter["in"],
    ...(typeof value.required === "boolean" ? { required: value.required } : {}),
    ...(value.schema !== undefined ? { schema: value.schema } : {}),
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(value.example !== undefined ? { example: value.example } : {}),
  };
}

function findJsonExample(operation: JsonObject) {
  const requestBody = isObject(operation.requestBody) ? operation.requestBody : null;
  const content = requestBody && isObject(requestBody.content) ? requestBody.content : null;
  const jsonEntry = findJsonContentEntry(content);
  const json = jsonEntry && isObject(jsonEntry.value) ? jsonEntry.value : null;
  if (!json) return undefined;
  if (json.example !== undefined) return json.example;
  const examples = isObject(json.examples) ? Object.values(json.examples) : [];
  for (const example of examples) {
    if (isObject(example) && example.value !== undefined) return example.value;
  }
  return undefined;
}

function hasJsonRequestBody(operation: JsonObject) {
  const requestBody = isObject(operation.requestBody) ? operation.requestBody : null;
  const content = requestBody && isObject(requestBody.content) ? requestBody.content : null;
  return Boolean(findJsonContentEntry(content));
}

function requiresApiKey(operation: JsonObject, root: JsonObject) {
  const security = operation.security ?? root.security;
  if (!Array.isArray(security)) return false;
  return security.some((entry) => isObject(entry) && Object.hasOwn(entry, "ApiKeyAuth"));
}

export function getOperationSchemaCacheKey(operation: Pick<PlaygroundOperation, "method" | "operationId" | "path">) {
  return operation.operationId || `${operation.method}:${operation.path}`;
}

function getComponentsSchemas(spec: JsonObject): Record<string, unknown> {
  const components = isObject(spec.components) ? spec.components : null;
  const schemas = components && isObject(components.schemas) ? components.schemas : null;
  return schemas ?? {};
}

function findJsonResponseSchemas(operation: JsonObject) {
  const schemasByStatus: Record<string, unknown> = {};
  const responses = isObject(operation.responses) ? operation.responses : null;
  if (!responses) return schemasByStatus;

  for (const [status, response] of Object.entries(responses)) {
    if (!isObject(response)) continue;
    const content = isObject(response.content) ? response.content : null;
    const jsonEntry = findJsonContentEntry(content);
    const json = jsonEntry && isObject(jsonEntry.value) ? jsonEntry.value : null;
    if (json && json.schema !== undefined) schemasByStatus[status] = json.schema;
  }
  return schemasByStatus;
}

export function getRegisteredResponseSchemas(
  operation: Pick<PlaygroundOperation, "method" | "operationId" | "path">,
) {
  return responseSchemaRegistry.get(getOperationSchemaCacheKey(operation));
}

export function parsePublicOpenApiOperations(spec: unknown): PlaygroundOperation[] {
  responseSchemaRegistry.clear();
  if (!isObject(spec) || !isObject(spec.paths)) return [];

  const operations: PlaygroundOperation[] = [];
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!path.startsWith("/v1/") || path.startsWith("/v1/account/")) continue;
    if (!isObject(pathItem)) continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      const normalizedMethod = method.toLowerCase();
      if (!HTTP_METHODS.has(normalizedMethod) || !isObject(operation)) continue;

      const parameters = [
        ...asArray(pathItem.parameters),
        ...asArray(operation.parameters),
      ]
        .map(parseParameter)
        .filter((parameter): parameter is OpenApiParameter => parameter !== null);
      const operationId =
        asString(operation.operationId) ?? `${normalizedMethod}_${path.replace(/[^a-zA-Z0-9]+/g, "_")}`;
      const parsedOperation = {
        operationId,
        method: normalizedMethod.toUpperCase(),
        path,
        tag: getFirstTag(operation),
        summary: asString(operation.summary) ?? `${normalizedMethod.toUpperCase()} ${path}`,
        ...(asString(operation.description) ? { description: asString(operation.description) } : {}),
        parameters,
        hasJsonRequestBody: hasJsonRequestBody(operation),
        ...(findJsonExample(operation) !== undefined
          ? { requestBodyExample: findJsonExample(operation) }
          : {}),
        requiresApiKey: requiresApiKey(operation, spec),
      };
      responseSchemaRegistry.set(getOperationSchemaCacheKey(parsedOperation), {
        componentsSchemas: getComponentsSchemas(spec),
        schemasByStatus: findJsonResponseSchemas(operation),
      });
      operations.push(parsedOperation);
    }
  }

  return operations.sort((left, right) => {
    const tagOrder = left.tag.localeCompare(right.tag);
    if (tagOrder !== 0) return tagOrder;
    return `${left.path} ${left.method}`.localeCompare(`${right.path} ${right.method}`);
  });
}

export function findPublicOperation(
  operations: PlaygroundOperation[],
  method: string,
  path: string,
) {
  return operations.find(
    (operation) => operation.method === method.toUpperCase() && operation.path === path,
  );
}
