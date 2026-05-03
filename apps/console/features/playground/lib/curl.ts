import type { PlaygroundMode, PlaygroundOperation, PlaygroundRequestConfig } from "../types.js";
import { buildPublicApiUrl } from "./request.js";

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildCurlCommand(options: {
  apiKey?: string;
  baseUrl: string;
  config: PlaygroundRequestConfig;
  includeRealKey?: boolean;
  mode: PlaygroundMode;
  operation: PlaygroundOperation;
}) {
  const url = buildPublicApiUrl(options.baseUrl, options.operation, options.config);
  const key =
    options.mode === "account" && options.includeRealKey && options.apiKey
      ? options.apiKey
      : "{{YOUR_API_KEY}}";
  const lines = [
    `curl ${shellQuote(url)}`,
    `  -H ${shellQuote("Accept: application/json")}`,
    `  -H ${shellQuote(`X-Api-Key: ${key}`)}`,
  ];
  if (options.operation.method !== "GET") lines.push(`  -X ${options.operation.method}`);
  const bodyText = options.config.bodyText.trim();
  if (options.operation.hasJsonRequestBody && bodyText) {
    lines.push(`  -H ${shellQuote("Content-Type: application/json")}`);
    lines.push(`  --data ${shellQuote(bodyText)}`);
  }
  return lines.join(" \\\n");
}
