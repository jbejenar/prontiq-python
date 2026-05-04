import type { PlaygroundHistoryEntry } from "../types.js";

export type PlaygroundHistoryAction =
  | { type: "APPEND"; entry: PlaygroundHistoryEntry }
  | { type: "CLEAR" };

export const PLAYGROUND_HISTORY_LIMIT = 50;

// Keep this display-only redaction predicate aligned with backend key issuance formats.
const keyLikeSubstringPattern = /\bpq_(live|test)_[A-Za-z0-9_-]{8,}\b/g;

export function playgroundHistoryReducer(
  entries: readonly PlaygroundHistoryEntry[],
  action: PlaygroundHistoryAction,
): PlaygroundHistoryEntry[] {
  switch (action.type) {
    case "APPEND":
      return [action.entry, ...entries].slice(0, PLAYGROUND_HISTORY_LIMIT);
    case "CLEAR":
      return [];
  }
}

export function redactKeyLikeValue(value: string) {
  return value.replace(keyLikeSubstringPattern, (match) => `${match.slice(0, 7)}•••••••••`);
}

export function displayHistoryParameterSummary(entry: PlaygroundHistoryEntry) {
  const pairs = [
    ...Object.entries(entry.config.pathParams),
    ...Object.entries(entry.config.queryParams),
  ].filter(([, value]) => value.trim().length > 0);

  if (pairs.length === 0 && entry.config.bodyText.trim().length === 0) return "no params";

  const params = pairs
    .slice(0, 3)
    .map(([key, value]) => `${key}=${redactKeyLikeValue(value)}`)
    .join(" · ");
  const suffix = pairs.length > 3 ? ` +${pairs.length - 3}` : "";
  const body = entry.config.bodyText.trim().length > 0 ? "body" : "";

  return [params ? `${params}${suffix}` : "", body].filter(Boolean).join(" · ");
}

export function formatRelativeHistoryTime(nowMs: number, timestamp: string) {
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - Date.parse(timestamp)) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  return `${Math.floor(elapsedMinutes / 60)}h ago`;
}
