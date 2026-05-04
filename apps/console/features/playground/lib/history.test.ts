import { expect, test } from "vitest";

import type { PlaygroundHistoryEntry } from "../types.js";
import {
  displayHistoryParameterSummary,
  formatRelativeHistoryTime,
  PLAYGROUND_HISTORY_LIMIT,
  playgroundHistoryReducer,
  redactKeyLikeValue,
} from "./history.js";

test("history reducer prepends entries and evicts the oldest entry", () => {
  const entries = Array.from({ length: PLAYGROUND_HISTORY_LIMIT + 1 }, (_, index) =>
    makeEntry(String(index)),
  ).reduce<PlaygroundHistoryEntry[]>(
    (currentEntries, entry) => playgroundHistoryReducer(currentEntries, { type: "APPEND", entry }),
    [],
  );

  expect(entries).toHaveLength(PLAYGROUND_HISTORY_LIMIT);
  expect(entries[0]?.id).toBe(String(PLAYGROUND_HISTORY_LIMIT));
  expect(entries.at(-1)?.id).toBe("1");
});

test("history reducer clears memory-only entries", () => {
  const entries = playgroundHistoryReducer([makeEntry("one")], { type: "CLEAR" });

  expect(entries).toEqual([]);
});

test("redacts key-like parameter values for display only", () => {
  const entry = makeEntry("secret", {
    config: {
      bodyText: "",
      pathParams: {},
      queryParams: { token: `pq_test_${"a".repeat(48)}` },
    },
  });

  expect(displayHistoryParameterSummary(entry)).toContain("pq_test•••••••••");
  expect(entry.config.queryParams.token).toBe(`pq_test_${"a".repeat(48)}`);
});

test("formats relative history time", () => {
  expect(formatRelativeHistoryTime(Date.parse("2026-05-04T00:01:20.000Z"), "2026-05-04T00:00:00.000Z")).toBe("1m ago");
});

test("does not redact normal values", () => {
  expect(redactKeyLikeValue("2000")).toBe("2000");
});

test("redacts live and test key-shaped values", () => {
  expect(redactKeyLikeValue(`pq_live_${"a".repeat(48)}`)).toBe("pq_live•••••••••");
  expect(redactKeyLikeValue("pq_test_secret_value")).toBe("pq_test•••••••••");
});

test("redacts key-shaped substrings in display values", () => {
  const liveKey = `pq_live_${"a".repeat(48)}`;
  const testKey = `pq_test_${"b".repeat(48)}`;

  expect(redactKeyLikeValue(` ${liveKey} `)).toBe(" pq_live••••••••• ");
  expect(redactKeyLikeValue(`Bearer ${liveKey}`)).toBe("Bearer pq_live•••••••••");
  expect(redactKeyLikeValue(`${liveKey} and ${testKey}`)).toBe(
    "pq_live••••••••• and pq_test•••••••••",
  );
});

test("redacts key-shaped substrings in parameter summaries without mutating replay config", () => {
  const liveKey = `pq_live_${"a".repeat(48)}`;
  const entry = makeEntry("secret", {
    config: {
      bodyText: "",
      pathParams: {},
      queryParams: { authorization: `Bearer ${liveKey}` },
    },
  });

  expect(displayHistoryParameterSummary(entry)).toContain("authorization=Bearer pq_live•••••••••");
  expect(entry.config.queryParams.authorization).toBe(`Bearer ${liveKey}`);
});

function makeEntry(id: string, overrides: Partial<PlaygroundHistoryEntry> = {}): PlaygroundHistoryEntry {
  return {
    config: {
      bodyText: "",
      pathParams: {},
      queryParams: { q: id },
    },
    id,
    latencyMs: 10,
    mode: "demo",
    operation: {
      method: "GET",
      operationId: "addressAutocomplete",
      path: "/v1/address/autocomplete",
      summary: "Autocomplete addresses",
      tag: "Address",
    },
    requestDisplayId: id.padStart(6, "0").slice(0, 6),
    status: 200,
    timestamp: "2026-05-04T00:00:00.000Z",
    ...overrides,
  };
}
