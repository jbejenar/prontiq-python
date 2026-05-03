#!/usr/bin/env node
import { pathToFileURL } from "node:url";

/**
 * Smoke test for the deployed Address API.
 *
 * Verifies REAL OpenSearch behavior — the class of bug that DSL unit tests
 * cannot catch (e.g. operator AND returning 0 for typo'd prefixes against
 * the actual G-NAF index).
 *
 * Usage:
 *   PRONTIQ_API=https://api.prontiq.dev \
 *   PRONTIQ_KEY=pq_live_... \
 *   pnpm --filter @prontiq/api smoke
 *
 * Designed to be run post-deploy (dev or prod) to verify search semantics
 * still hold against real data. Until P1A.12 ships fixture-OpenSearch CI
 * integration, this is the canonical real-engine verification step.
 */

const DEFAULT_API_URL = "https://api.prontiq.dev";

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} env var required`);
  }
  return value.trim();
}

type JsonObject = Record<string, unknown>;

interface FetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

export type SmokeFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<FetchResponse>;

interface SmokeCase {
  name: string;
  path: string;
  /** Returns null if pass, or string explaining failure */
  check: (response: unknown) => string | null;
}

interface RunAddressSmokeOptions {
  apiUrl: string;
  apiKey: string;
  fetchImpl?: SmokeFetch;
  log?: (message: string) => void;
  now?: () => number;
}

export interface RunAddressSmokeResult {
  passed: number;
  failed: number;
  total: number;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isObject(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function objectArrayField(value: unknown, key: string): JsonObject[] {
  if (!isObject(value)) return [];
  const field = value[key];
  if (!Array.isArray(field)) return [];
  return field.filter(isObject);
}

function arrayField(value: unknown, key: string): unknown[] {
  if (!isObject(value)) return [];
  const field = value[key];
  return Array.isArray(field) ? field : [];
}

const cases: SmokeCase[] = [
  {
    name: "autocomplete: valid prefix ranks COURT first",
    path: "/v1/address/autocomplete?q=9+endeavour+cou&limit=5",
    check: (r) => {
      const labels = objectArrayField(r, "suggestions")
        .map((suggestion) => stringField(suggestion, "addressLabel"))
        .filter((label): label is string => label !== undefined);
      if (labels.length === 0) return "0 results";
      const allCourt = labels.every((l: string) => l.includes("COURT"));
      return allCourt ? null : `expected all COURT, got ${JSON.stringify(labels)}`;
    },
  },
  {
    name: "autocomplete: typo'd prefix falls back (returns SOMETHING)",
    path: "/v1/address/autocomplete?q=9+endeavour+cuo&limit=5",
    check: (r) => {
      const count = objectArrayField(r, "suggestions").length;
      return count > 0 ? null : "0 results — phase-2 fallback didn't trigger";
    },
  },
  {
    name: "autocomplete: typo in completed word still finds ENDEAVOUR (fuzzy)",
    path: "/v1/address/autocomplete?q=9+endevour+court&limit=3",
    check: (r) => {
      const labels = objectArrayField(r, "suggestions")
        .map((suggestion) => stringField(suggestion, "addressLabel"))
        .filter((label): label is string => label !== undefined);
      const hasEndeavour = labels.some((l: string) => l.includes("ENDEAVOUR COURT"));
      return hasEndeavour
        ? null
        : `expected ENDEAVOUR COURT in results, got ${JSON.stringify(labels)}`;
    },
  },
  {
    name: "validate: known address returns high confidence",
    path: "/v1/address/validate?q=9+endeavour+court+coffin+bay+sa+5607",
    check: (r) =>
      stringField(r, "confidence") === "high"
        ? null
        : `expected confidence "high", got "${stringField(r, "confidence")}"`,
  },
  {
    name: "validate: nonsense returns none/low (token coverage gate)",
    path: "/v1/address/validate?q=zzz1234+nonexistent+nowhere",
    check: (r) => {
      const confidence = stringField(r, "confidence");
      return confidence === "none" || confidence === "low"
        ? null
        : `nonsense should score "none" or "low", got "${confidence}"`;
    },
  },
  {
    name: "validate: wrong postcode caps at low (critical-component gate)",
    path: "/v1/address/validate?q=9+endeavour+court+coffin+bay+sa+9999",
    check: (r) => {
      const confidence = stringField(r, "confidence");
      return confidence !== "high" && confidence !== "medium"
        ? null
        : `wrong postcode should not score medium/high, got "${confidence}"`;
    },
  },
  {
    name: "validate: wrong locality caps at low (alien-token gate)",
    // RICHMOND with SA 5607 — matched doc will be COFFIN BAY SA 5607.
    // Alien-token detection should catch RICHMOND as a wrong component.
    path: "/v1/address/validate?q=9+endeavour+court+richmond+sa+5607",
    check: (r) => {
      const confidence = stringField(r, "confidence");
      return confidence !== "high" && confidence !== "medium"
        ? null
        : `wrong locality should not score medium/high, got "${confidence}"`;
    },
  },
  {
    name: "lookupSuburb: bondi+beech (typo) → matched as BONDI BEACH",
    path: "/v1/address/lookup/suburb?suburb=bondi+beech",
    check: (r) =>
      stringField(r, "suburb") === "BONDI BEACH"
        ? null
        : `expected suburb "BONDI BEACH", got "${stringField(r, "suburb")}"`,
  },
  {
    name: "lookupSuburb: richmond (no state) → aggregates across multiple states",
    path: "/v1/address/lookup/suburb?suburb=richmond",
    check: (r) => {
      const count = arrayField(r, "postcodes").length;
      const state = isObject(r) ? r.state : undefined;
      const stateUndefined = state === undefined || state === null;
      if (count < 3) return `expected 3+ postcodes from multi-state RICHMOND, got ${count}`;
      if (!stateUndefined)
        return `expected state field undefined when caller omitted state, got "${String(state)}"`;
      return null;
    },
  },
  {
    name: "lookupPostcode: limit=3 returns exactly 3 localities",
    path: "/v1/address/lookup/postcode?postcode=2000&limit=3",
    check: (r) => {
      const count = arrayField(r, "localities").length;
      return count === 3 ? null : `expected 3 localities, got ${count}`;
    },
  },
];

export async function runAddressSmoke({
  apiUrl,
  apiKey,
  fetchImpl = fetch as SmokeFetch,
  log = console.log,
  now = Date.now,
}: RunAddressSmokeOptions): Promise<RunAddressSmokeResult> {
  const normalizedApiUrl = apiUrl.replace(/\/+$/, "");
  log(`Running ${cases.length} smoke tests against ${normalizedApiUrl}\n`);
  let failed = 0;

  for (const c of cases) {
    const url = `${normalizedApiUrl}${c.path}`;
    const startedAt = now();
    try {
      const res = await fetchImpl(url, { headers: { "X-Api-Key": apiKey } });
      const elapsedMs = Math.max(0, Math.round(now() - startedAt));
      if (!res.ok) {
        log(`✗ ${c.name} — HTTP ${res.status} — ${elapsedMs}ms\n  ${await res.text()}`);
        failed++;
        continue;
      }
      const body = await res.json();
      const failure = c.check(body);
      if (failure) {
        log(`✗ ${c.name} — HTTP ${res.status} — ${elapsedMs}ms\n  ${failure}`);
        failed++;
      } else {
        log(`✓ ${c.name} — HTTP ${res.status} — ${elapsedMs}ms`);
      }
    } catch (err) {
      const elapsedMs = Math.max(0, Math.round(now() - startedAt));
      log(`✗ ${c.name} — ${elapsedMs}ms\n  ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  const passed = cases.length - failed;
  log(`\n${passed}/${cases.length} passed`);
  return { passed, failed, total: cases.length };
}

async function main(): Promise<void> {
  try {
    const result = await runAddressSmoke({
      apiUrl: process.env.PRONTIQ_API ?? DEFAULT_API_URL,
      apiKey: readRequiredEnv("PRONTIQ_KEY"),
    });
    if (result.failed > 0) process.exit(1);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
