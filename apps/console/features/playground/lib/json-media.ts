type JsonContentEntry = {
  mediaType: string;
  value: unknown;
};

export function isJsonMediaType(mediaType: string | undefined) {
  if (!mediaType) return true;
  const [type = ""] = mediaType.toLowerCase().split(";");
  const normalized = type.trim();
  if (normalized === "application/json") return true;
  const [, subtype = ""] = normalized.split("/");
  return subtype.endsWith("+json");
}

export function findJsonContentEntry(content: Record<string, unknown> | null): JsonContentEntry | null {
  if (!content) return null;
  const entries = Object.entries(content);
  const exactJson = entries.find(([mediaType]) => mediaType.toLowerCase().trim() === "application/json");
  const jsonEntry = exactJson ?? entries.find(([mediaType]) => isJsonMediaType(mediaType));
  return jsonEntry ? { mediaType: jsonEntry[0], value: jsonEntry[1] } : null;
}
