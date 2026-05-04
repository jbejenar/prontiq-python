"use client";

import { memo, type ReactNode } from "react";

import type { SchemaMetadata } from "../lib/schema-metadata.js";
import { isJsonMediaType } from "../lib/json-media.js";
import { SchemaDescriptionTooltip } from "./SchemaDescriptionTooltip.js";

type JsonNode =
  | { kind: "array"; items: JsonNode[] }
  | { kind: "boolean"; raw: "false" | "true" }
  | { kind: "null"; raw: "null" }
  | { kind: "number"; raw: string }
  | { kind: "object"; entries: Array<{ key: string; value: JsonNode }> }
  | { kind: "string"; raw: string };

const INDENT = "  ";

export const AnnotatedJsonBlock = memo(function AnnotatedJsonBlock({
  bodyText,
  contentType,
  schemaMetadata,
}: {
  bodyText: string;
  contentType?: string;
  schemaMetadata: ReadonlyMap<string, SchemaMetadata> | null;
}) {
  if (!bodyText.trim()) {
    return <FallbackBody note="response body is empty" />;
  }

  if (!isJsonMediaType(contentType)) {
    return <FallbackBody bodyText={bodyText} />;
  }

  const parsed = parseJson(bodyText);
  if (!parsed) {
    return <FallbackBody bodyText={bodyText} note="response body is not valid JSON" />;
  }

  return (
    <pre className="whitespace-pre-wrap break-words">
      <code>{renderNode(parsed, schemaMetadata, "", 0)}</code>
    </pre>
  );
});

function FallbackBody({ bodyText, note }: { bodyText?: string; note?: string }) {
  return (
    <div>
      {note ? <p className="mb-2 font-mono text-[11px] text-playground-panel-muted">{note}</p> : null}
      {bodyText ? <pre className="whitespace-pre-wrap break-words"><code>{bodyText}</code></pre> : null}
    </div>
  );
}

function renderNode(
  node: JsonNode,
  schemaMetadata: ReadonlyMap<string, SchemaMetadata> | null,
  path: string,
  depth: number,
): ReactNode {
  switch (node.kind) {
    case "array":
      return renderArray(node, schemaMetadata, path, depth);
    case "object":
      return renderObject(node, schemaMetadata, path, depth);
    case "string":
      return <span className="text-playground-panel-string">{node.raw}</span>;
    case "number":
    case "boolean":
      return <span className="text-playground-panel-number">{node.raw}</span>;
    case "null":
      return <span className="text-playground-panel-muted">{node.raw}</span>;
  }
}

function renderArray(
  node: Extract<JsonNode, { kind: "array" }>,
  schemaMetadata: ReadonlyMap<string, SchemaMetadata> | null,
  path: string,
  depth: number,
) {
  if (node.items.length === 0) return <span className="text-playground-panel-muted">[]</span>;
  const itemPath = path ? `${path}[]` : "[]";
  return (
    <>
      <span className="text-playground-panel-muted">[</span>
      {"\n"}
      {node.items.map((item, index) => (
        <span key={index}>
          {INDENT.repeat(depth + 1)}
          {renderNode(item, schemaMetadata, itemPath, depth + 1)}
          {index < node.items.length - 1 ? <span className="text-playground-panel-muted">,</span> : null}
          {"\n"}
        </span>
      ))}
      {INDENT.repeat(depth)}
      <span className="text-playground-panel-muted">]</span>
    </>
  );
}

function renderObject(
  node: Extract<JsonNode, { kind: "object" }>,
  schemaMetadata: ReadonlyMap<string, SchemaMetadata> | null,
  path: string,
  depth: number,
) {
  if (node.entries.length === 0) return <span className="text-playground-panel-muted">{"{}"}</span>;
  return (
    <>
      <span className="text-playground-panel-muted">{"{"}</span>
      {"\n"}
      {node.entries.map((entry, index) => {
        const keyPath = path ? `${path}.${entry.key}` : entry.key;
        const metadata = schemaMetadata?.get(keyPath) ?? null;
        return (
          <span key={`${entry.key}-${index}`}>
            {INDENT.repeat(depth + 1)}
            <SchemaDescriptionTooltip metadata={metadata} panel>
              <span className="text-playground-panel-key">{JSON.stringify(entry.key)}</span>
            </SchemaDescriptionTooltip>
            <span className="text-playground-panel-muted">: </span>
            {renderNode(entry.value, schemaMetadata, keyPath, depth + 1)}
            {index < node.entries.length - 1 ? <span className="text-playground-panel-muted">,</span> : null}
            {"\n"}
          </span>
        );
      })}
      {INDENT.repeat(depth)}
      <span className="text-playground-panel-muted">{"}"}</span>
    </>
  );
}

function parseJson(source: string): JsonNode | null {
  let index = 0;

  function skipWhitespace() {
    while (/\s/.test(source[index] ?? "")) index += 1;
  }

  function parseString(): { raw: string; value: string } | null {
    const start = index;
    if (source[index] !== "\"") return null;
    index += 1;
    while (index < source.length) {
      const char = source[index];
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === "\"") {
        index += 1;
        const raw = source.slice(start, index);
        try {
          return { raw, value: JSON.parse(raw) as string };
        } catch {
          return null;
        }
      }
      index += 1;
    }
    return null;
  }

  function parseNumber(): JsonNode | null {
    const start = index;
    if (source[index] === "-") index += 1;
    const integerStart = index;
    if (source[index] === "0") {
      index += 1;
      if (/\d/.test(source[index] ?? "")) return null;
    } else {
      while (/\d/.test(source[index] ?? "")) index += 1;
    }
    if (index === integerStart) return null;
    if (source[index] === ".") {
      index += 1;
      const fractionStart = index;
      while (/\d/.test(source[index] ?? "")) index += 1;
      if (index === fractionStart) return null;
    }
    if (source[index] === "e" || source[index] === "E") {
      index += 1;
      if (source[index] === "+" || source[index] === "-") index += 1;
      const exponentStart = index;
      while (/\d/.test(source[index] ?? "")) index += 1;
      if (index === exponentStart) return null;
    }
    return index > start ? { kind: "number", raw: source.slice(start, index) } : null;
  }

  function parseLiteral(literal: "false" | "null" | "true"): JsonNode | null {
    if (!source.startsWith(literal, index)) return null;
    index += literal.length;
    if (literal === "null") return { kind: "null", raw: "null" };
    return { kind: "boolean", raw: literal };
  }

  function parseArray(): JsonNode | null {
    if (source[index] !== "[") return null;
    index += 1;
    skipWhitespace();
    const items: JsonNode[] = [];
    if (source[index] === "]") {
      index += 1;
      return { kind: "array", items };
    }
    while (index < source.length) {
      const value = parseValue();
      if (!value) return null;
      items.push(value);
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        return { kind: "array", items };
      }
      if (source[index] !== ",") return null;
      index += 1;
      skipWhitespace();
    }
    return null;
  }

  function parseObject(): JsonNode | null {
    if (source[index] !== "{") return null;
    index += 1;
    skipWhitespace();
    const entries: Array<{ key: string; value: JsonNode }> = [];
    if (source[index] === "}") {
      index += 1;
      return { kind: "object", entries };
    }
    while (index < source.length) {
      const key = parseString();
      if (!key) return null;
      skipWhitespace();
      if (source[index] !== ":") return null;
      index += 1;
      const value = parseValue();
      if (!value) return null;
      entries.push({ key: key.value, value });
      skipWhitespace();
      if (source[index] === "}") {
        index += 1;
        return { kind: "object", entries };
      }
      if (source[index] !== ",") return null;
      index += 1;
      skipWhitespace();
    }
    return null;
  }

  function parseValue(): JsonNode | null {
    skipWhitespace();
    const char = source[index];
    if (char === "{") return parseObject();
    if (char === "[") return parseArray();
    if (char === "\"") {
      const string = parseString();
      return string ? { kind: "string", raw: string.raw } : null;
    }
    if (char === "t") return parseLiteral("true");
    if (char === "f") return parseLiteral("false");
    if (char === "n") return parseLiteral("null");
    return parseNumber();
  }

  const value = parseValue();
  skipWhitespace();
  return value && index === source.length ? value : null;
}
