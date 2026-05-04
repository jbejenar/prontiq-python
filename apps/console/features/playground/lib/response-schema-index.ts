import type { PlaygroundOperation } from "../types.js";
import { getOperationSchemaCacheKey, getRegisteredResponseSchemas } from "./openapi.js";
import { formatSchemaMetadata, type SchemaMetadata } from "./schema-metadata.js";

type JsonObject = Record<string, unknown>;

export interface ResponseSchemaIndex {
  byStatus: ReadonlyMap<string, ReadonlyMap<string, SchemaMetadata>>;
}

const MAX_SCHEMA_DEPTH = 8;
const CONFLICTING_ALLOF_METADATA = "x-prontiq-conflicting-allof-metadata";
const EMPTY_RESPONSE_SCHEMA_INDEX: ResponseSchemaIndex = { byStatus: new Map() };
const responseSchemaIndexCache = new Map<
  string,
  { index: ResponseSchemaIndex; registered: NonNullable<ReturnType<typeof getRegisteredResponseSchemas>> }
>();

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getLocalComponentRefName(ref: string) {
  const prefix = "#/components/schemas/";
  return ref.startsWith(prefix) ? decodeURIComponent(ref.slice(prefix.length)) : null;
}

function asSchemaObject(value: unknown): JsonObject | null {
  return isObject(value) ? value : null;
}

function mergeAllOf(schemas: readonly JsonObject[]) {
  const merged: JsonObject = {};
  const descriptions: string[] = [];
  let typeConflict = false;
  let currentType: unknown;

  for (const schema of schemas) {
    if (typeof schema.description === "string") descriptions.push(schema.description);
    if (schema.type !== undefined) {
      if (currentType !== undefined && JSON.stringify(currentType) !== JSON.stringify(schema.type)) {
        typeConflict = true;
      }
      currentType = schema.type;
    }
    if (isObject(schema.properties)) {
      const mergedProperties = isObject(merged.properties) ? { ...merged.properties } : {};
      for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
        const currentProperty = mergedProperties[propertyName];
        mergedProperties[propertyName] =
          isObject(currentProperty) && isObject(propertySchema)
            ? mergeAllOf([currentProperty, propertySchema])
            : propertySchema;
      }
      merged.properties = mergedProperties;
    }
    if (Array.isArray(schema.required)) {
      const required = new Set([
        ...(Array.isArray(merged.required) ? merged.required.filter((item): item is string => typeof item === "string") : []),
        ...schema.required.filter((item): item is string => typeof item === "string"),
      ]);
      merged.required = [...required];
    }
    if (typeof schema.minimum === "number") {
      merged.minimum = typeof merged.minimum === "number" ? Math.max(merged.minimum, schema.minimum) : schema.minimum;
    }
    if (typeof schema.maximum === "number") {
      merged.maximum = typeof merged.maximum === "number" ? Math.min(merged.maximum, schema.maximum) : schema.maximum;
    }
    if (Array.isArray(schema.enum)) {
      const schemaEnum = schema.enum;
      merged.enum = Array.isArray(merged.enum)
        ? merged.enum.filter((item) => schemaEnum.some((candidate) => Object.is(candidate, item)))
        : schema.enum;
    }
    for (const [key, value] of Object.entries(schema)) {
      if (["description", "enum", "maximum", "minimum", "properties", "required", "type"].includes(key)) {
        continue;
      }
      if (merged[key] === undefined) merged[key] = value;
    }
  }

  if (descriptions.length > 0) merged.description = descriptions.join("\n");
  if (!typeConflict && currentType !== undefined) {
    merged.type = currentType;
  } else if (typeConflict) {
    return merged.description
      ? { [CONFLICTING_ALLOF_METADATA]: true, description: merged.description }
      : { [CONFLICTING_ALLOF_METADATA]: true };
  }
  return merged;
}

function normalizeSchema(
  schema: unknown,
  componentsSchemas: Record<string, unknown>,
  seenRefs: Set<string>,
  depth: number,
): unknown {
  if (depth > MAX_SCHEMA_DEPTH) return undefined;
  const schemaObject = asSchemaObject(schema);
  if (!schemaObject) return schema;

  if (typeof schemaObject.$ref === "string") {
    const refName = getLocalComponentRefName(schemaObject.$ref);
    if (!refName || seenRefs.has(refName)) return undefined;
    const nextSeenRefs = new Set(seenRefs);
    nextSeenRefs.add(refName);
    return normalizeSchema(componentsSchemas[refName], componentsSchemas, nextSeenRefs, depth + 1);
  }

  if (Array.isArray(schemaObject.allOf)) {
    const normalized = schemaObject.allOf
      .map((item) => normalizeSchema(item, componentsSchemas, seenRefs, depth + 1))
      .filter(isObject);
    return mergeAllOf([schemaObject, ...normalized]);
  }

  if (Array.isArray(schemaObject.oneOf) || Array.isArray(schemaObject.anyOf)) {
    return {
      ...schemaObject,
      description: [
        typeof schemaObject.description === "string" ? schemaObject.description : undefined,
        "multiple possible types",
      ].filter(Boolean).join("\n"),
    };
  }

  return schemaObject;
}

function getRequiredSet(schema: JsonObject) {
  return new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [],
  );
}

function indexSchemaNode(options: {
  componentsSchemas: Record<string, unknown>;
  index: Map<string, SchemaMetadata>;
  path: string;
  required?: boolean;
  schema: unknown;
  seenRefs: Set<string>;
  seenSchemas: Set<JsonObject>;
  depth: number;
}) {
  const normalized = normalizeSchema(
    options.schema,
    options.componentsSchemas,
    options.seenRefs,
    options.depth,
  );
  if (!isObject(normalized)) return;
  if (options.seenSchemas.has(normalized)) return;
  const seenSchemas = new Set(options.seenSchemas);
  seenSchemas.add(normalized);

  if (options.path) {
    const metadata = formatSchemaMetadata(normalized, {
      required: normalized[CONFLICTING_ALLOF_METADATA] === true ? undefined : options.required,
    });
    if (metadata) options.index.set(options.path, metadata);
  }

  const type = normalized.type;
  const isArray = type === "array" || (Array.isArray(type) && type.includes("array"));
  if (isArray && normalized.items !== undefined) {
    indexSchemaNode({
      ...options,
      path: `${options.path}[]`,
      schema: normalized.items,
      seenSchemas,
      depth: options.depth + 1,
    });
    return;
  }

  const properties = isObject(normalized.properties) ? normalized.properties : null;
  if (!properties) return;
  const required = getRequiredSet(normalized);
  for (const [propertyName, propertySchema] of Object.entries(properties)) {
    indexSchemaNode({
      ...options,
      path: options.path ? `${options.path}.${propertyName}` : propertyName,
      required: required.has(propertyName),
      schema: propertySchema,
      seenSchemas,
      depth: options.depth + 1,
    });
  }
}

export function buildResponseSchemaIndex(options: {
  componentsSchemas: Record<string, unknown>;
  schemasByStatus: Record<string, unknown>;
}): ResponseSchemaIndex {
  const byStatus = new Map<string, ReadonlyMap<string, SchemaMetadata>>();
  for (const [status, schema] of Object.entries(options.schemasByStatus)) {
    const index = new Map<string, SchemaMetadata>();
    indexSchemaNode({
      componentsSchemas: options.componentsSchemas,
      depth: 0,
      index,
      path: "",
      schema,
      seenRefs: new Set(),
      seenSchemas: new Set(),
    });
    byStatus.set(status, index);
  }
  return { byStatus };
}

export function getResponseSchemaIndex(
  operation: Pick<PlaygroundOperation, "method" | "operationId" | "path">,
) {
  const cacheKey = getOperationSchemaCacheKey(operation);
  const registered = getRegisteredResponseSchemas(operation);
  if (!registered) {
    return EMPTY_RESPONSE_SCHEMA_INDEX;
  }
  const cached = responseSchemaIndexCache.get(cacheKey);
  if (cached && cached.registered === registered) return cached.index;

  const index = buildResponseSchemaIndex(registered);
  responseSchemaIndexCache.set(cacheKey, { index, registered });
  return index;
}

export function selectResponseSchemaMetadata(options: {
  index: ResponseSchemaIndex;
  status: number;
}) {
  const exact = options.index.byStatus.get(String(options.status));
  if (exact) return exact;

  if (options.status >= 200 && options.status < 300) {
    const firstSuccessStatus = [...options.index.byStatus.keys()]
      .filter((status) => /^\d+$/.test(status))
      .map((status) => Number(status))
      .filter((status) => status >= 200 && status < 300)
      .sort((left, right) => left - right)[0];
    if (firstSuccessStatus !== undefined) {
      return options.index.byStatus.get(String(firstSuccessStatus)) ?? null;
    }
  }

  return options.index.byStatus.get("default") ?? null;
}
