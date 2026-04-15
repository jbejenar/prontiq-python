#!/usr/bin/env node
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

const API = process.env.PRONTIQ_API ?? "https://api.prontiq.dev";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} env var required`);
    process.exit(1);
  }
  return value;
}

const KEY = requireEnv("PRONTIQ_KEY");

interface SmokeCase {
  name: string;
  path: string;
  /** Returns null if pass, or string explaining failure */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  check: (response: any) => string | null;
}

const cases: SmokeCase[] = [
  {
    name: "autocomplete: valid prefix ranks COURT first",
    path: "/v1/address/autocomplete?q=9+endeavour+cou&limit=5",
    check: (r) => {
      const labels = r.suggestions?.map((s: { addressLabel: string }) => s.addressLabel) ?? [];
      if (labels.length === 0) return "0 results";
      const allCourt = labels.every((l: string) => l.includes("COURT"));
      return allCourt ? null : `expected all COURT, got ${JSON.stringify(labels)}`;
    },
  },
  {
    name: "autocomplete: typo'd prefix falls back (returns SOMETHING)",
    path: "/v1/address/autocomplete?q=9+endeavour+cuo&limit=5",
    check: (r) => {
      const count = r.suggestions?.length ?? 0;
      return count > 0 ? null : "0 results — phase-2 fallback didn't trigger";
    },
  },
  {
    name: "autocomplete: typo in completed word still finds ENDEAVOUR (fuzzy)",
    path: "/v1/address/autocomplete?q=9+endevour+court&limit=3",
    check: (r) => {
      const labels = r.suggestions?.map((s: { addressLabel: string }) => s.addressLabel) ?? [];
      const hasEndeavour = labels.some((l: string) => l.includes("ENDEAVOUR COURT"));
      return hasEndeavour ? null : `expected ENDEAVOUR COURT in results, got ${JSON.stringify(labels)}`;
    },
  },
  {
    name: "validate: known address returns high confidence",
    path: "/v1/address/validate?q=9+endeavour+court+coffin+bay+sa+5607",
    check: (r) => (r.confidence === "high" ? null : `expected confidence "high", got "${r.confidence}"`),
  },
  {
    name: "validate: nonsense returns none/low (token coverage gate)",
    path: "/v1/address/validate?q=zzz1234+nonexistent+nowhere",
    check: (r) =>
      r.confidence === "none" || r.confidence === "low"
        ? null
        : `nonsense should score "none" or "low", got "${r.confidence}"`,
  },
  {
    name: "validate: wrong postcode caps at low (critical-component gate)",
    path: "/v1/address/validate?q=9+endeavour+court+coffin+bay+sa+9999",
    check: (r) =>
      r.confidence !== "high" && r.confidence !== "medium"
        ? null
        : `wrong postcode should not score medium/high, got "${r.confidence}"`,
  },
  {
    name: "validate: wrong locality caps at low (alien-token gate)",
    // RICHMOND with SA 5607 — matched doc will be COFFIN BAY SA 5607.
    // Alien-token detection should catch RICHMOND as a wrong component.
    path: "/v1/address/validate?q=9+endeavour+court+richmond+sa+5607",
    check: (r) =>
      r.confidence !== "high" && r.confidence !== "medium"
        ? null
        : `wrong locality should not score medium/high, got "${r.confidence}"`,
  },
  {
    name: "lookupSuburb: bondi+beech (typo) → matched as BONDI BEACH",
    path: "/v1/address/lookup/suburb?suburb=bondi+beech",
    check: (r) =>
      r.suburb === "BONDI BEACH" ? null : `expected suburb "BONDI BEACH", got "${r.suburb}"`,
  },
  {
    name: "lookupSuburb: richmond (no state) → aggregates across multiple states",
    path: "/v1/address/lookup/suburb?suburb=richmond",
    check: (r) => {
      const count = r.postcodes?.length ?? 0;
      const stateUndefined = r.state === undefined || r.state === null;
      if (count < 3) return `expected 3+ postcodes from multi-state RICHMOND, got ${count}`;
      if (!stateUndefined) return `expected state field undefined when caller omitted state, got "${r.state}"`;
      return null;
    },
  },
  {
    name: "lookupPostcode: limit=3 returns exactly 3 localities",
    path: "/v1/address/lookup/postcode?postcode=2000&limit=3",
    check: (r) => {
      const count = r.localities?.length ?? 0;
      return count === 3 ? null : `expected 3 localities, got ${count}`;
    },
  },
];

async function main(): Promise<void> {
  console.log(`Running ${cases.length} smoke tests against ${API}\n`);
  let failed = 0;

  for (const c of cases) {
    const url = `${API}${c.path}`;
    try {
      const res = await fetch(url, { headers: { "X-Api-Key": KEY } });
      if (!res.ok) {
        console.log(`✗ ${c.name}\n  HTTP ${res.status}: ${await res.text()}`);
        failed++;
        continue;
      }
      const body = await res.json();
      const failure = c.check(body);
      if (failure) {
        console.log(`✗ ${c.name}\n  ${failure}`);
        failed++;
      } else {
        console.log(`✓ ${c.name}`);
      }
    } catch (err) {
      console.log(`✗ ${c.name}\n  ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  if (failed > 0) process.exit(1);
}

void main();
