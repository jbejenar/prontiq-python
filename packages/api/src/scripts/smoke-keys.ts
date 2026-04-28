#!/usr/bin/env node
/**
 * Smoke test for the P1C.03 PR 1 key-management endpoints:
 *   - GET  /v1/account/keys          (member-allowed)
 *   - POST /v1/account/keys/create   (admin-only; gated by clerkAdminOnly)
 *
 * Default mode is **list-only** — no state change. Set `SMOKE_CREATE=1`
 * to additionally exercise create + re-list verification. Create-mode
 * leaves a key behind in the target org's KEYS table; until rotate/
 * revoke ship in PR 2 there's no in-script cleanup.
 *
 * Required env (same as smoke-account-setup):
 *   - CLERK_SECRET_KEY        Dev `sk_test_...` or prod `sk_live_...`
 *   - CLERK_TEST_USER_ID      `user_...` or primary email; resolved via Backend SDK.
 *
 * Optional env:
 *   - CLERK_TEST_ORG_ID       Disambiguate when user has multiple sessions/orgs.
 *   - CLERK_TEST_SESSION_ID   Pin a specific session ID.
 *   - PRONTIQ_API             Override API base; default reads .sst/outputs.json.
 *   - SMOKE_CREATE=1          Exercise POST /keys/create + verify in re-list.
 *   - SMOKE_LABEL             Label sent on create (default `smoke-${timestamp}`).
 *   - SMOKE_TIMEOUT_MS        Per-call timeout. Default 15000.
 *   - EXPECT                  `list_only` | `created_then_listed` | `limit_exceeded`
 *                             — pin the expected outcome. `limit_exceeded` is
 *                             useful when the target org is at its plan's
 *                             maxKeys ceiling: a 403 KEY_LIMIT_EXCEEDED is the
 *                             expected pass-state and validates the atomic
 *                             counter precondition end-to-end.
 *
 * Exit codes:
 *   0 — all assertions passed
 *   1 — request succeeded but a response/state assertion failed
 *   2 — could not run (env/JWT/transport)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SessionResolutionError,
  getOptionalEnvOrNull,
  getRequiredEnv,
  getTimeoutMs,
  mintClerkJwt,
  resolveApiBaseUrl,
} from "./smoke-clerk.js";

const KEY_ID_PATTERN = /^key_[0-9A-Z]{26}$/;
const RAW_KEY_PATTERN = /^pq_live_[0-9a-f]{48}$/;
const KEY_PREFIX_PATTERN = /^pq_live_[0-9a-f]{4,12}$/;

interface ListedKey {
  keyId: string;
  keyPrefix: string;
  label?: string;
  createdAt: string;
  lastUsedAt: string | null;
  active: boolean;
  products: string[];
}

interface CreateKeySuccess {
  keyId: string;
  raw: string;
  keyPrefix: string;
  createdAt: string;
  label?: string;
}

interface ApiError {
  error: { code: string; message: string; status: number; request_id: string };
}

class SmokeAssertionError extends Error {}

async function authedFetch(
  apiUrl: string,
  jwt: string,
  pathSegment: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: unknown; requestId: string | null; durationMs: number }> {
  const url = `${apiUrl.replace(/\/$/, "")}${pathSegment}`;
  const start = Date.now();
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
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

function assertListShape(value: unknown): asserts value is { keys: ListedKey[] } {
  if (!value || typeof value !== "object" || !("keys" in value)) {
    throw new SmokeAssertionError(`list response missing "keys" field: ${JSON.stringify(value)}`);
  }
  const keys = (value as { keys: unknown }).keys;
  if (!Array.isArray(keys)) {
    throw new SmokeAssertionError(`list response "keys" is not an array`);
  }
  for (const entry of keys) {
    if (!entry || typeof entry !== "object") {
      throw new SmokeAssertionError(`list entry is not an object: ${JSON.stringify(entry)}`);
    }
    const e = entry as Record<string, unknown>;
    for (const required of ["keyId", "keyPrefix", "createdAt", "active", "products"] as const) {
      if (!(required in e)) {
        throw new SmokeAssertionError(`list entry missing "${required}": ${JSON.stringify(e)}`);
      }
    }
    if (typeof e.keyId !== "string" || !KEY_ID_PATTERN.test(e.keyId)) {
      throw new SmokeAssertionError(
        `list entry has invalid keyId "${String(e.keyId)}" (expected /^key_[0-9A-Z]{26}$/)`,
      );
    }
    if ("apiKeyHash" in e) {
      throw new SmokeAssertionError(
        `list entry leaks apiKeyHash — the list response must never include hashes`,
      );
    }
    if ("raw" in e) {
      throw new SmokeAssertionError(`list entry leaks raw key — must never appear after create`);
    }
  }
}

function assertCreateShape(value: unknown): asserts value is CreateKeySuccess {
  if (!value || typeof value !== "object") {
    throw new SmokeAssertionError(`create response not an object: ${JSON.stringify(value)}`);
  }
  const v = value as Record<string, unknown>;
  for (const required of ["keyId", "raw", "keyPrefix", "createdAt"] as const) {
    if (!(required in v)) {
      throw new SmokeAssertionError(`create response missing "${required}"`);
    }
  }
  if (typeof v.keyId !== "string" || !KEY_ID_PATTERN.test(v.keyId)) {
    throw new SmokeAssertionError(`create keyId invalid: ${String(v.keyId)}`);
  }
  if (typeof v.raw !== "string" || !RAW_KEY_PATTERN.test(v.raw)) {
    throw new SmokeAssertionError(
      `create raw invalid (expected /^pq_live_[0-9a-f]{48}$/): length=${typeof v.raw === "string" ? v.raw.length : "n/a"}`,
    );
  }
  if (typeof v.keyPrefix !== "string" || !KEY_PREFIX_PATTERN.test(v.keyPrefix)) {
    throw new SmokeAssertionError(`create keyPrefix invalid: ${String(v.keyPrefix)}`);
  }
}

function isApiError(value: unknown): value is ApiError {
  return (
    !!value &&
    typeof value === "object" &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object"
  );
}

function summarizeBody(body: unknown): string {
  if (isApiError(body)) {
    return `${body.error.code} (${body.error.status}) request_id=${body.error.request_id}`;
  }
  return JSON.stringify(body, null, 2);
}

export async function run(): Promise<number> {
  const secretKey = getRequiredEnv("CLERK_SECRET_KEY");
  const userIdentifier = getRequiredEnv("CLERK_TEST_USER_ID");
  const targetOrgId = getOptionalEnvOrNull("CLERK_TEST_ORG_ID");
  const pinnedSessionId = getOptionalEnvOrNull("CLERK_TEST_SESSION_ID");
  const apiUrl = resolveApiBaseUrl();
  const timeoutMs = getTimeoutMs();
  const shouldCreate = process.env.SMOKE_CREATE === "1";
  const expect = process.env.EXPECT?.trim();
  const label = process.env.SMOKE_LABEL?.trim() ?? `smoke-${new Date().toISOString()}`;

  console.log("=== Keys smoke ===");
  console.log(`API:     ${apiUrl}`);
  console.log(`User:    ${userIdentifier}`);
  console.log(`Org:     ${targetOrgId ?? "(unpinned)"}`);
  console.log(`Tenant:  ${secretKey.startsWith("sk_live_") ? "PROD (sk_live_)" : "DEV (sk_test_)"}`);
  console.log(`Mode:    ${shouldCreate ? "list + create + re-list" : "list-only (no state change)"}`);
  if (shouldCreate) console.log(`Label:   ${label}`);
  if (expect) console.log(`Expect:  ${expect}`);
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

  console.log("[2] GET /v1/account/keys");
  let listResp;
  try {
    listResp = await authedFetch(apiUrl, minted.jwt, "/v1/account/keys", { method: "GET" }, timeoutMs);
  } catch (error) {
    console.error(`      transport error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  console.log(
    `      HTTP ${listResp.status} in ${listResp.durationMs}ms${listResp.requestId ? ` request_id=${listResp.requestId}` : ""}`,
  );
  if (listResp.status !== 200) {
    console.error(`      list returned non-200:\n${summarizeBody(listResp.body)}`);
    return 1;
  }
  try {
    assertListShape(listResp.body);
  } catch (error) {
    console.error(`      ${(error as Error).message}`);
    return 1;
  }
  const initialKeys = (listResp.body as { keys: ListedKey[] }).keys;
  console.log(`      ${initialKeys.length} key(s) listed`);

  if (!shouldCreate) {
    if (expect && expect !== "list_only") {
      console.error(`      EXPECT=${expect} but SMOKE_CREATE not set`);
      return 1;
    }
    console.log("\n✅ PASS — list-only smoke");
    return 0;
  }

  console.log(`[3] POST /v1/account/keys/create label="${label}"`);
  let createResp;
  try {
    createResp = await authedFetch(
      apiUrl,
      minted.jwt,
      "/v1/account/keys/create",
      { method: "POST", body: JSON.stringify({ label }) },
      timeoutMs,
    );
  } catch (error) {
    console.error(`      transport error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  console.log(
    `      HTTP ${createResp.status} in ${createResp.durationMs}ms${createResp.requestId ? ` request_id=${createResp.requestId}` : ""}`,
  );

  if (expect === "limit_exceeded") {
    if (
      createResp.status === 403 &&
      isApiError(createResp.body) &&
      createResp.body.error.code === "KEY_LIMIT_EXCEEDED"
    ) {
      console.log(
        `\n✅ PASS — 403 KEY_LIMIT_EXCEEDED (atomic counter precondition fired against live DDB)`,
      );
      return 0;
    }
    console.error(
      `      EXPECT=limit_exceeded but got ${createResp.status} ${
        isApiError(createResp.body) ? createResp.body.error.code : "(non-error body)"
      }:\n${summarizeBody(createResp.body)}`,
    );
    return 1;
  }

  if (createResp.status !== 201) {
    console.error(`      create returned non-201:\n${summarizeBody(createResp.body)}`);
    return 1;
  }
  try {
    assertCreateShape(createResp.body);
  } catch (error) {
    console.error(`      ${(error as Error).message}`);
    return 1;
  }
  const created = createResp.body as CreateKeySuccess;
  console.log(`      keyId=${created.keyId} keyPrefix=${created.keyPrefix} (raw redacted)`);

  console.log("[4] GET /v1/account/keys (re-list to verify)");
  let relistResp;
  try {
    relistResp = await authedFetch(
      apiUrl,
      minted.jwt,
      "/v1/account/keys",
      { method: "GET" },
      timeoutMs,
    );
  } catch (error) {
    console.error(`      transport error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  console.log(`      HTTP ${relistResp.status} in ${relistResp.durationMs}ms`);
  if (relistResp.status !== 200) {
    console.error(`      re-list returned non-200:\n${summarizeBody(relistResp.body)}`);
    return 1;
  }
  try {
    assertListShape(relistResp.body);
  } catch (error) {
    console.error(`      ${(error as Error).message}`);
    return 1;
  }
  const after = (relistResp.body as { keys: ListedKey[] }).keys;
  const found = after.find((k) => k.keyId === created.keyId);
  if (!found) {
    console.error(`      created keyId ${created.keyId} not visible in re-list`);
    return 1;
  }
  if (found.keyPrefix !== created.keyPrefix) {
    console.error(
      `      keyPrefix drift: create=${created.keyPrefix} list=${found.keyPrefix}`,
    );
    return 1;
  }
  if (found.label !== label) {
    console.error(`      label drift: sent="${label}" listed="${found.label}"`);
    return 1;
  }
  if (!found.active) {
    console.error(`      newly created key has active=false in list`);
    return 1;
  }
  // Defense-in-depth: scan the entire serialized re-list response for
  // any substring matching the raw value we just received. The list
  // schema doesn't include `raw`, but a regression that wired it
  // through would be caught here.
  const serialized = JSON.stringify(relistResp.body);
  if (serialized.includes(created.raw)) {
    console.error(`      raw key value leaked into list response`);
    return 1;
  }

  if (expect && expect !== "created_then_listed") {
    console.error(
      `      EXPECT=${expect} did not match outcome (got 201 created — set EXPECT=created_then_listed or unset)`,
    );
    return 1;
  }
  console.log(
    `\n✅ PASS — created keyId=${created.keyId}, visible in re-list with label, active=true`,
  );
  console.log(
    `     NOTE: the new key remains in the org's KEYS table. revoke endpoint ships in PR 2.`,
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error("Smoke threw unexpectedly:", error);
      process.exit(2);
    });
}
