#!/usr/bin/env node
/**
 * Smoke test for the P1C.04 usage read path:
 *   - GET /v1/account/usage?granularity={daily,weekly,monthly}
 *
 * This is read-only. It asserts the deployed private account API includes the
 * usage route, can authenticate a Clerk session token, and returns the console
 * usage contract without leaking key material.
 */
import {
  SessionResolutionError,
  getOptionalEnvOrNull,
  getRequiredEnv,
  getTimeoutMs,
  mintClerkJwt,
  resolveApiBaseUrl,
} from "./smoke-clerk.js";

type UsageGranularity = "daily" | "weekly" | "monthly";

interface UsageProduct {
  product: string;
  displayName: string;
  includedInCurrentPlan: boolean;
  usedCredits: number;
  quotaCredits: number | null;
  remainingCredits: number | null;
  overageCredits: number | null;
  enforcementMode: "hard_cap" | "soft_overage" | "uncapped_tracked";
  rateLimitPerSecond: number | null;
  series: Array<{
    bucket: string;
    label: string;
    credits: number;
    kind: "baseline" | "projected" | "total";
    sortKey: string;
  }>;
}

interface UsageResponse {
  generatedAt: string;
  granularity: UsageGranularity;
  period: {
    key: string;
    startedAt: string | null;
    endingAt: string | null;
    source: "calendar" | "lago";
    entitlementsSyncedAt: string | null;
    scopeConsistency: "single_period" | "mixed_key_periods";
  };
  products: UsageProduct[];
}

class SmokeAssertionError extends Error {}

async function authedFetch(input: {
  apiUrl: string;
  granularity: UsageGranularity;
  jwt: string;
  timeoutMs: number;
}): Promise<{ status: number; body: unknown; requestId: string | null; durationMs: number }> {
  const start = Date.now();
  const url = `${input.apiUrl.replace(/\/$/, "")}/v1/account/usage?granularity=${input.granularity}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${input.jwt}` },
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  const requestId = res.headers.get("x-request-id");
  const durationMs = Date.now() - start;
  const text = await res.text();
  let body: unknown;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = { _raw: text.slice(0, 500) };
  }
  return { status: res.status, body, requestId, durationMs };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertNumberOrNull(value: unknown, field: string): asserts value is number | null {
  if (value !== null && typeof value !== "number") {
    throw new SmokeAssertionError(`${field} must be number|null; got ${JSON.stringify(value)}`);
  }
}

function assertUsageShape(value: unknown, granularity: UsageGranularity): asserts value is UsageResponse {
  if (!isRecord(value)) {
    throw new SmokeAssertionError(`usage response is not an object: ${JSON.stringify(value)}`);
  }
  if (value.granularity !== granularity) {
    throw new SmokeAssertionError(
      `usage granularity mismatch: expected ${granularity}, got ${String(value.granularity)}`,
    );
  }
  if (typeof value.generatedAt !== "string") {
    throw new SmokeAssertionError("usage response missing generatedAt");
  }
  if (!isRecord(value.period)) {
    throw new SmokeAssertionError("usage response missing period object");
  }
  if (typeof value.period.key !== "string" || value.period.key.length === 0) {
    throw new SmokeAssertionError("usage period.key must be a non-empty string");
  }
  if (!["calendar", "lago"].includes(String(value.period.source))) {
    throw new SmokeAssertionError(`usage period.source invalid: ${String(value.period.source)}`);
  }
  if (!["single_period", "mixed_key_periods"].includes(String(value.period.scopeConsistency))) {
    throw new SmokeAssertionError(
      `usage period.scopeConsistency invalid: ${String(value.period.scopeConsistency)}`,
    );
  }
  if (!Array.isArray(value.products)) {
    throw new SmokeAssertionError("usage products must be an array");
  }
  for (const product of value.products) {
    if (!isRecord(product)) {
      throw new SmokeAssertionError(`usage product is not an object: ${JSON.stringify(product)}`);
    }
    for (const field of ["product", "displayName", "enforcementMode"] as const) {
      if (typeof product[field] !== "string") {
        throw new SmokeAssertionError(`usage product missing string ${field}`);
      }
    }
    for (const field of ["usedCredits"] as const) {
      if (typeof product[field] !== "number" || product[field] < 0) {
        throw new SmokeAssertionError(`usage product ${field} must be a non-negative number`);
      }
    }
    for (const field of ["quotaCredits", "remainingCredits", "overageCredits", "rateLimitPerSecond"] as const) {
      assertNumberOrNull(product[field], `usage product ${field}`);
    }
    if (typeof product.includedInCurrentPlan !== "boolean") {
      throw new SmokeAssertionError("usage product includedInCurrentPlan must be boolean");
    }
    if (!["hard_cap", "soft_overage", "uncapped_tracked"].includes(String(product.enforcementMode))) {
      throw new SmokeAssertionError(
        `usage product enforcementMode invalid: ${String(product.enforcementMode)}`,
      );
    }
    if (!Array.isArray(product.series)) {
      throw new SmokeAssertionError("usage product series must be an array");
    }
    for (const point of product.series) {
      if (!isRecord(point)) {
        throw new SmokeAssertionError(`usage series point is not an object: ${JSON.stringify(point)}`);
      }
      if (typeof point.bucket !== "string" || typeof point.label !== "string") {
        throw new SmokeAssertionError("usage series point missing bucket/label string fields");
      }
      if (typeof point.sortKey !== "string") {
        throw new SmokeAssertionError("usage series point missing sortKey string field");
      }
      if (!["baseline", "projected", "total"].includes(String(point.kind))) {
        throw new SmokeAssertionError(`usage series point kind invalid: ${String(point.kind)}`);
      }
      if (typeof point.credits !== "number" || point.credits < 0) {
        throw new SmokeAssertionError("usage series point credits must be a non-negative number");
      }
    }
  }

  const serialized = JSON.stringify(value);
  for (const forbidden of ["apiKeyHash", "keyPrefix", "pq_live_"]) {
    if (serialized.includes(forbidden)) {
      throw new SmokeAssertionError(`usage response leaked forbidden field/material: ${forbidden}`);
    }
  }
}

async function smokeGranularity(input: {
  apiUrl: string;
  granularity: UsageGranularity;
  jwt: string;
  timeoutMs: number;
}): Promise<boolean> {
  console.log(`[2] GET /v1/account/usage?granularity=${input.granularity}`);
  let response;
  try {
    response = await authedFetch(input);
  } catch (error) {
    console.error(
      `      transport error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
  console.log(
    `      HTTP ${response.status} in ${response.durationMs}ms${response.requestId ? ` request_id=${response.requestId}` : ""}`,
  );

  if (response.status !== 200) {
    console.error(`      usage returned non-200:\n${JSON.stringify(response.body, null, 2)}`);
    if (
      response.status === 404 &&
      isRecord(response.body) &&
      isRecord(response.body.error) &&
      response.body.error.code === "NOT_FOUND"
    ) {
      console.error(
        "      deployed API is missing /v1/account/usage; deploy the backend containing P1C.04 before testing the console preview.",
      );
    }
    return false;
  }

  try {
    assertUsageShape(response.body, input.granularity);
  } catch (error) {
    console.error(`      ${(error as Error).message}`);
    return false;
  }

  const usage = response.body;
  console.log(
    `      products=${usage.products.length} period=${usage.period.key} source=${usage.period.source} consistency=${usage.period.scopeConsistency}`,
  );
  return true;
}

export async function run(): Promise<number> {
  const secretKey = getRequiredEnv("CLERK_SECRET_KEY");
  const userIdentifier = getRequiredEnv("CLERK_TEST_USER_ID");
  const targetOrgId = getOptionalEnvOrNull("CLERK_TEST_ORG_ID");
  const pinnedSessionId = getOptionalEnvOrNull("CLERK_TEST_SESSION_ID");
  const apiUrl = resolveApiBaseUrl();
  const timeoutMs = getTimeoutMs();

  console.log("=== Account usage smoke ===");
  console.log(`API:     ${apiUrl}`);
  console.log(`User:    ${userIdentifier}`);
  console.log(`Org:     ${targetOrgId ?? "(unpinned)"}`);
  console.log(
    `Tenant:  ${secretKey.startsWith("sk_live_") ? "PROD (sk_live_)" : "DEV (sk_test_)"}`,
  );
  console.log();

  let minted;
  try {
    minted = await mintClerkJwt({
      secretKey,
      userIdentifier,
      targetOrgId,
      pinnedSessionId,
      timeoutMs,
    });
  } catch (error) {
    if (error instanceof SessionResolutionError) {
      console.error(`      ${error.message}`);
      return 2;
    }
    console.error("      Unexpected error during JWT mint:", error);
    return 2;
  }

  console.log(
    `[1] Minted JWT (${minted.jwt.length} bytes) — session=${minted.sessionId} org=${minted.orgId}`,
  );

  const results = await Promise.all(
    (["daily", "weekly", "monthly"] as const).map((granularity) =>
      smokeGranularity({ apiUrl, granularity, jwt: minted.jwt, timeoutMs }),
    ),
  );
  if (results.some((ok) => !ok)) return 1;

  console.log("\n✅ PASS — usage read path");
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 2;
    });
}
