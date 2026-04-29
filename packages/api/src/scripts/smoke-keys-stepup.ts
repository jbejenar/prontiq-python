#!/usr/bin/env node
/**
 * Smoke test for the P1C.03 PR 2 step-up routes:
 *   - POST /v1/account/keys/rotate   (admin + requireReverification)
 *   - POST /v1/account/keys/revoke   (admin + requireReverification)
 *
 * What's testable today (pre-PR-4-operator-gate, JWT template does
 * NOT yet emit `fva`):
 *
 *   [admin token] rotate/revoke any keyId →
 *     500 STEP_UP_MISCONFIGURED (proves requireReverification fires
 *     and fail-loud works — no infinite reverify loop on misconfigured
 *     templates).
 *
 *   [admin token, malformed body] →
 *     500 STEP_UP_MISCONFIGURED (middleware runs BEFORE Zod body
 *     validation, so even a bad body never reaches the handler. This
 *     is the documented compose order: clerkAdminOnly →
 *     requireReverification → Zod → handler.)
 *
 * What flips on once the operator updates the Clerk JWT template /
 * default-token reverification config to emit `fva`:
 *
 *   [fresh fva] rotate → 200 + new raw key + REDIRECT grace
 *   [stale fva] rotate → 403 with Clerk-native body
 *
 * Default mode is **read-only** with respect to the keys table — no
 * key is rotated or revoked, because every call hits 500 before the
 * handler. Safe to run repeatedly against dev or prod.
 *
 * Required env (same as smoke-keys):
 *   - CLERK_SECRET_KEY        Dev `sk_test_...` or prod `sk_live_...`
 *   - CLERK_TEST_USER_ID      `user_...` or primary email; admin role.
 *
 * Optional env:
 *   - CLERK_TEST_ORG_ID       Disambiguate when user has multiple orgs.
 *   - CLERK_TEST_SESSION_ID   Pin a specific session ID.
 *   - PRONTIQ_API             Override API base; default reads .sst/outputs.json.
 *   - SMOKE_TIMEOUT_MS        Per-call timeout. Default 15000.
 *   - EXPECT                  `step_up_blocked`         (default — accepts either
 *                                                       500 STEP_UP_MISCONFIGURED
 *                                                       or 403 Clerk-native body
 *                                                       depending on JWT-template
 *                                                       config state)
 *                             | `step_up_misconfigured` (strict — pre-fva-config only)
 *                             | `reverification_required` (strict — post-fva-config,
 *                                                       Clerk-native 403 body)
 *                             | `rotated_revoked`       (post-fresh-2fa happy flow,
 *                                                       not yet reachable from a
 *                                                       Backend-SDK-minted token)
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

// Synthetic well-formed keyId that is INTENTIONALLY ABSENT from
// DynamoDB. The smoke probes /keys/{rotate,revoke} expecting the
// step-up middleware (`clerkAdminOnly → requireReverification → Zod →
// handler`) to block before the handler runs. If the gate regresses,
// the handler executes — using a non-existent keyId means it returns
// 404 KEY_NOT_FOUND with no DDB mutation and no fresh raw secret to
// leak into CI logs. Defense-in-depth on top of the gate itself.
//
// The shape (KEY_ID_PATTERN) matters because: (a) Zod body validation
// happens AFTER step-up, so a malformed body would also produce the
// expected step-up block — but a well-shaped body proves we're
// probing step-up, not Zod. (b) If the gate ever regresses AND a real
// key in the test org happens to share this id, we'd mutate it. The
// "SMOKEFALLBACK" marker padded with zeros makes that collision
// astronomically unlikely (no real ULID encodes that prefix) and
// makes any audit-row writer trace grep-able.
//
// Asserted at module load so a future regex tightening (e.g., adopting
// Crockford-Base32) blows up on import, not on runtime.
const SYNTHETIC_NONEXISTENT_KEY_ID = "key_01HXSMOKEFALLBACK000000000";
if (!KEY_ID_PATTERN.test(SYNTHETIC_NONEXISTENT_KEY_ID)) {
  throw new Error(
    `SYNTHETIC_NONEXISTENT_KEY_ID="${SYNTHETIC_NONEXISTENT_KEY_ID}" must satisfy KEY_ID_PATTERN — fix the constant before shipping`,
  );
}

// Fields that may carry secrets if the step-up gate regresses and the
// rotate/revoke handler executes. `summarize()` redacts these before
// JSON-stringifying the response body so a gate regression never
// writes a fresh `pq_live_*` to the workflow log.
const SECRET_BEARING_FIELDS = new Set(["raw", "apiKeyHash"]);

interface ApiError {
  error: { code: string; message: string; status: number; request_id: string };
}

/**
 * Clerk-native step-up 403 body shape — emitted by `requireReverification`
 * when the JWT carries `fva` but the second-factor age is stale (or
 * `-1` "never used"). Pinned literally because Clerk's
 * `useReverification()` hook on the frontend matches against these
 * exact key names + literal values.
 */
interface ClerkReverificationError403 {
  clerk_error: {
    type: "forbidden";
    reason: "reverification-error";
    metadata: { reverification: { level: string; afterMinutes: number } };
  };
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

function isApiError(value: unknown): value is ApiError {
  return (
    !!value &&
    typeof value === "object" &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object"
  );
}

function isClerkReverificationError(value: unknown): value is ClerkReverificationError403 {
  if (!value || typeof value !== "object" || !("clerk_error" in value)) return false;
  const inner = (value as { clerk_error: unknown }).clerk_error;
  if (!inner || typeof inner !== "object") return false;
  const o = inner as Record<string, unknown>;
  return (
    o.type === "forbidden" &&
    o.reason === "reverification-error" &&
    !!o.metadata &&
    typeof o.metadata === "object"
  );
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_BEARING_FIELDS.has(k) ? "[REDACTED]" : redactSecrets(v);
    }
    return out;
  }
  return value;
}

function summarize(body: unknown): string {
  if (isApiError(body)) {
    return `${body.error.code} (${body.error.status}) request_id=${body.error.request_id}`;
  }
  return JSON.stringify(redactSecrets(body), null, 2).slice(0, 400);
}

type StepUpExpectMode =
  | "step_up_blocked"
  | "step_up_misconfigured"
  | "reverification_required";

type StepUpOutcome = "step_up_misconfigured_500" | "reverification_required_403";

async function expectStepUpBlocked(
  apiUrl: string,
  jwt: string,
  routeName: "rotate" | "revoke",
  body: Record<string, unknown>,
  timeoutMs: number,
  mode: StepUpExpectMode,
): Promise<StepUpOutcome> {
  const segment = `/v1/account/keys/${routeName}`;
  const res = await authedFetch(
    apiUrl,
    jwt,
    segment,
    { method: "POST", body: JSON.stringify(body) },
    timeoutMs,
  );
  console.log(
    `      HTTP ${res.status} in ${res.durationMs}ms${res.requestId ? ` request_id=${res.requestId}` : ""}`,
  );

  // 500 STEP_UP_MISCONFIGURED — JWT lacks `fva` claim entirely.
  if (
    res.status === 500 &&
    isApiError(res.body) &&
    res.body.error.code === "STEP_UP_MISCONFIGURED"
  ) {
    if (mode === "reverification_required") {
      throw new SmokeAssertionError(
        `${segment}: EXPECT=reverification_required but got 500 STEP_UP_MISCONFIGURED — operator hasn't configured the Clerk JWT template to emit fva yet.`,
      );
    }
    return "step_up_misconfigured_500";
  }

  // 403 Clerk-native body — JWT carries `fva` but stale (or -1).
  if (res.status === 403 && isClerkReverificationError(res.body)) {
    if (mode === "step_up_misconfigured") {
      throw new SmokeAssertionError(
        `${segment}: EXPECT=step_up_misconfigured but got 403 reverification-error — the JWT template is already emitting fva. Switch EXPECT to reverification_required or step_up_blocked.`,
      );
    }
    // Extra invariant — the body shape MUST match the OpenAPI union
    // exactly, since the frontend's useReverification() hook depends
    // on the literal keys + values. The OpenAPI 403 union is pinned
    // by scripts/openapi-boundary.test.mjs in CI, but a runtime mismatch
    // (e.g., a future middleware change that drops a field) would only
    // be caught here.
    const meta = res.body.clerk_error.metadata.reverification;
    if (meta.level !== "second_factor") {
      throw new SmokeAssertionError(
        `${segment}: clerk_error.metadata.reverification.level expected "second_factor", got "${meta.level}"`,
      );
    }
    if (typeof meta.afterMinutes !== "number" || meta.afterMinutes < 0) {
      throw new SmokeAssertionError(
        `${segment}: clerk_error.metadata.reverification.afterMinutes invalid: ${meta.afterMinutes}`,
      );
    }
    return "reverification_required_403";
  }

  // 2xx from a blocked-path probe means the step-up gate itself
  // regressed (middleware removed, misordered, bypassed). Treat as a
  // critical assertion failure WITHOUT echoing the response body —
  // it may contain a freshly-rotated raw key (`raw` is in the
  // response shape per packages/api/src/routes/keys.ts). The smoke
  // uses SYNTHETIC_NONEXISTENT_KEY_ID as defense-in-depth so even in
  // this regression the handler should hit 404 KEY_NOT_FOUND, but
  // we redact unconditionally regardless of what comes back.
  if (res.status >= 200 && res.status < 300) {
    throw new SmokeAssertionError(
      `${segment}: GATE REGRESSION — got HTTP ${res.status} from a blocked-path probe. The step-up middleware did not block. Response body redacted; see CloudWatch with request_id=${res.requestId ?? "<none>"}.`,
    );
  }

  throw new SmokeAssertionError(
    `${segment}: expected step-up block (500 STEP_UP_MISCONFIGURED or 403 Clerk-native), got ${res.status}: ${summarize(res.body)}`,
  );
}

export async function run(): Promise<number> {
  const secretKey = getRequiredEnv("CLERK_SECRET_KEY");
  const userIdentifier = getRequiredEnv("CLERK_TEST_USER_ID");
  const targetOrgId = getOptionalEnvOrNull("CLERK_TEST_ORG_ID");
  const pinnedSessionId = getOptionalEnvOrNull("CLERK_TEST_SESSION_ID");
  const apiUrl = resolveApiBaseUrl();
  const timeoutMs = getTimeoutMs();
  const expect = (process.env.EXPECT?.trim() ?? "step_up_blocked") as
    | StepUpExpectMode
    | "rotated_revoked";

  console.log("=== Keys step-up smoke ===");
  console.log(`API:     ${apiUrl}`);
  console.log(`User:    ${userIdentifier}`);
  console.log(`Org:     ${targetOrgId ?? "(unpinned)"}`);
  console.log(`Tenant:  ${secretKey.startsWith("sk_live_") ? "PROD (sk_live_)" : "DEV (sk_test_)"}`);
  console.log(`Expect:  ${expect}`);
  console.log();

  if (expect === "rotated_revoked") {
    console.error(
      "      EXPECT=rotated_revoked is not yet supported by this script; that path requires fva-aware JWT minting (a real frontend re-auth, not a Backend SDK token mint).",
    );
    return 2;
  }
  if (
    expect !== "step_up_blocked" &&
    expect !== "step_up_misconfigured" &&
    expect !== "reverification_required"
  ) {
    console.error(`      EXPECT="${expect}" is not a recognised mode.`);
    return 2;
  }

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

  // The smoke ALWAYS uses a synthetic non-existent keyId. Step-up
  // runs before Zod and before the handler, so the keyId is never
  // decoded by the production code path under test. Using a real
  // active key would add zero realism (step-up doesn't read the
  // body) but would create a leak vector: if the gate ever
  // regresses, the handler executes, rotates the live fixture key,
  // and returns a fresh `raw` secret. With a non-existent id, a
  // gate regression instead hits 404 KEY_NOT_FOUND with no DDB
  // mutation. Combined with redact-on-2xx in expectStepUpBlocked,
  // this keeps the smoke non-mutating even under a broken gate.
  const targetKeyId = SYNTHETIC_NONEXISTENT_KEY_ID;
  console.log(`[2] Using synthetic non-existent keyId: ${targetKeyId}`);

  const outcomes: StepUpOutcome[] = [];

  const stepUpMode = expect as StepUpExpectMode;

  console.log("[3] POST /v1/account/keys/rotate (admin token, expect step-up block)");
  try {
    outcomes.push(
      await expectStepUpBlocked(apiUrl, minted.jwt, "rotate", { keyId: targetKeyId }, timeoutMs, stepUpMode),
    );
  } catch (error) {
    console.error(`      ${(error as Error).message}`);
    return 1;
  }

  console.log("[4] POST /v1/account/keys/revoke (admin token, expect step-up block)");
  try {
    outcomes.push(
      await expectStepUpBlocked(apiUrl, minted.jwt, "revoke", { keyId: targetKeyId }, timeoutMs, stepUpMode),
    );
  } catch (error) {
    console.error(`      ${(error as Error).message}`);
    return 1;
  }

  console.log("[5] POST /v1/account/keys/rotate with malformed body (expect step-up block)");
  // Middleware order is clerkAdminOnly → requireReverification → Zod
  // → handler, so a step-up failure short-circuits the chain BEFORE
  // Zod sees the body. This proves the compose order documented at
  // packages/api/src/routes/keys.ts (use(...) calls before openapi()
  // registrations).
  try {
    outcomes.push(
      await expectStepUpBlocked(
        apiUrl,
        minted.jwt,
        "rotate",
        { not_a_key_id: "garbage" },
        timeoutMs,
        stepUpMode,
      ),
    );
  } catch (error) {
    console.error(`      ${(error as Error).message}`);
    return 1;
  }

  // Outcomes must be consistent across calls — the JWT template's
  // fva-emission state is fixed per token, so all three checks must
  // hit the same branch.
  const distinct = new Set(outcomes);
  if (distinct.size !== 1) {
    console.error(
      `      mixed step-up outcomes across calls: ${[...distinct].join(", ")} — middleware should be deterministic`,
    );
    return 1;
  }
  const [outcome] = outcomes;
  const summary =
    outcome === "step_up_misconfigured_500"
      ? "500 STEP_UP_MISCONFIGURED (JWT lacks fva — operator hasn't updated Clerk template yet)"
      : "403 Clerk-native reverification-error body (JWT emits fva but second factor stale or never used)";

  console.log(`\n✅ PASS — step-up middleware blocks on all 3 invariants. Outcome: ${summary}`);
  console.log("     NOTE: zero state mutation. Every call canceled in middleware before the handler.");
  if (outcome === "step_up_misconfigured_500") {
    console.log(
      "     NEXT: configure the Clerk JWT template to emit `fva`, then re-run with EXPECT=reverification_required.",
    );
  } else {
    console.log(
      "     NEXT: a real frontend re-auth produces a fresh `fva[1]` < 10 min, which flips this to a 200 happy path. Backend SDK token mints can never reach that branch.",
    );
  }
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
