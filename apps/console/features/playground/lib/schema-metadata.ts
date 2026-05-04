import { useMemo } from "react";

type JsonObject = Record<string, unknown>;

export interface SchemaMetadata {
  description?: string;
  rows: readonly SchemaMetadataRow[];
}

export interface SchemaMetadataRow {
  label: string;
  value: string;
}

export interface SchemaMetadataOptions {
  example?: unknown;
  required?: boolean;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function stringifyValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function formatType(schema: JsonObject) {
  const type = schema.type;
  const typeText = Array.isArray(type)
    ? type.filter((item): item is string => typeof item === "string").join(" | ")
    : asString(type);
  const format = asString(schema.format);
  if (!typeText && !format) return undefined;
  return [typeText, format ? `format: ${format}` : undefined].filter(Boolean).join(" · ");
}

function formatEnum(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const values = value.map(stringifyValue).filter((item): item is string => item !== undefined);
  return values.length > 0 ? values.join(", ") : undefined;
}

export function formatSchemaMetadata(
  schema: unknown,
  options: SchemaMetadataOptions = {},
): SchemaMetadata | null {
  if (!isObject(schema)) {
    return options.example !== undefined
      ? { rows: [{ label: "example", value: stringifyValue(options.example) ?? "" }] }
      : null;
  }

  const rows: SchemaMetadataRow[] = [];
  const type = formatType(schema);
  if (type) rows.push({ label: "type", value: type });
  if (options.required !== undefined) {
    rows.push({ label: "presence", value: options.required ? "required" : "optional" });
  }
  if (typeof schema.minimum === "number") rows.push({ label: "minimum", value: String(schema.minimum) });
  if (typeof schema.maximum === "number") rows.push({ label: "maximum", value: String(schema.maximum) });
  if (typeof schema.minLength === "number") rows.push({ label: "min length", value: String(schema.minLength) });
  if (typeof schema.maxLength === "number") rows.push({ label: "max length", value: String(schema.maxLength) });
  if (typeof schema.pattern === "string") rows.push({ label: "pattern", value: schema.pattern });
  const enumValue = formatEnum(schema.enum);
  if (enumValue) rows.push({ label: "enum", value: enumValue });
  const defaultValue = stringifyValue(schema.default);
  if (defaultValue !== undefined) rows.push({ label: "default", value: defaultValue });
  const exampleValue = stringifyValue(options.example ?? schema.example);
  if (exampleValue !== undefined) rows.push({ label: "example", value: exampleValue });

  const description = asString(schema.description);
  if (!description && rows.length === 0) return null;
  return {
    ...(description ? { description } : {}),
    rows,
  };
}

export function useSchemaMetadata(schema: unknown, options: SchemaMetadataOptions = {}) {
  return useMemo(
    () => formatSchemaMetadata(schema, options),
    [options.example, options.required, schema],
  );
}
