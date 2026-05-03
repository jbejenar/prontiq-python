const SAFE_RESPONSE_HEADERS = new Set([
  "content-type",
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-request-id",
]);

export function filterSafeResponseHeaders(headers: Headers): Record<string, string> {
  const filtered: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (SAFE_RESPONSE_HEADERS.has(key.toLowerCase())) filtered[key.toLowerCase()] = value;
  });
  return filtered;
}
