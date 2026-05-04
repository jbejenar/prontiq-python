import { expect, test } from "vitest";

import { formatSchemaMetadata } from "./schema-metadata.js";

test("formats schema descriptions, constraints, enum, defaults, and examples", () => {
  const metadata = formatSchemaMetadata(
    {
      default: 10,
      description: "Australian 4-digit postcode.",
      enum: ["2000", "3000"],
      maxLength: 4,
      minLength: 4,
      pattern: "^\\d{4}$",
      type: "string",
    },
    { example: "3000", required: true },
  );

  expect(metadata?.description).toBe("Australian 4-digit postcode.");
  expect(metadata?.rows).toEqual([
    { label: "type", value: "string" },
    { label: "presence", value: "required" },
    { label: "min length", value: "4" },
    { label: "max length", value: "4" },
    { label: "pattern", value: "^\\d{4}$" },
    { label: "enum", value: "2000, 3000" },
    { label: "default", value: "10" },
    { label: "example", value: "3000" },
  ]);
});

test("returns null for schemas without displayable metadata", () => {
  expect(formatSchemaMetadata({ type: undefined })).toBeNull();
});
