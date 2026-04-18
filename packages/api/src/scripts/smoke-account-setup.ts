#!/usr/bin/env node
/**
 * Smoke test for `POST /v1/account/setup` (P1B.05 PR 3/3).
 *
 * Mints a real Clerk session JWT via the Backend API, then exercises
 * the deployed account-setup endpoint with it. Validates the full
 * happy-path that no unit / integration test can cover (the
 * unit/integration tests stub `verifyToken`, so they don't exercise
 * the real network call from our middleware to Clerk).
 *
 * Doubles as a reusable operator tool for any future Clerk-auth
 * change — switch tenants/stages by env var.
 *
 * ## Required env
 *
 *   - `CLERK_SECRET_KEY` — same secret the webhook + account Lambdas
 *     use. For dev, use the dev tenant's `sk_test_...`. For prod,
 *     use the prod tenant's `sk_live_...`.
 *   - `CLERK_TEST_USER_ID` — the Clerk test user identifier. Prefer the
 *     Clerk user_id (`user_...`), but a primary email address is also
 *     accepted and resolved to a user id via the Backend API. The
 *     resolved user MUST be an org admin in the target org.
 *
 * ## Optional env
 *
 *   - `CLERK_TEST_ORG_ID` — the org_id to validate against
 *     (`org_...`). REQUIRED when the user has multiple active
 *     sessions or multiple orgs — without it the script fails
 *     deterministically rather than silently picking the wrong
 *     session (Bug 1 fix from PR #103 review). Optional when the
 *     user has exactly one active session with a single org context.
 *   - `CLERK_TEST_SESSION_ID` — pin a specific session by ID. Use
 *     when multiple sessions match the target org and the script
 *     reports candidates.
 *   - `PRONTIQ_API` — base URL of the API. Optional when a fresh
 *     `.sst/outputs.json` is present in the current checkout;
 *     otherwise required. Set to `https://api.prontiq.dev` to smoke prod.
 *   - `EXPECT` — `created` | `already_exists` | `403` | `400` —
 *     fail the script if the response status doesn't match. Useful
 *     in CI. Defaults to accepting both 201 (created) and 200
 *     (already_exists) as success.
 *   - `SMOKE_TIMEOUT_MS` — per-call timeout for both Clerk SDK
 *     resolutions and the smoke fetch. Default 15000ms. Bug 2 fix.
 *
 * ## Usage
 *
 *   # smoke dev (single org, single session — no CLERK_TEST_ORG_ID needed)
 *   CLERK_SECRET_KEY=sk_test_... \
 *   CLERK_TEST_USER_ID=user_... \
 *   pnpm --filter @prontiq/api smoke:account-setup
 *
 *   # smoke prod with explicit org pin (recommended)
 *   CLERK_SECRET_KEY=sk_live_... \
 *   CLERK_TEST_USER_ID=user_... \
 *   CLERK_TEST_ORG_ID=org_... \
 *   pnpm --filter @prontiq/api smoke:account-setup:prod
 *
 * ## What it validates
 *
 *   1. The deployed `clerkJwt()` middleware accepts a real Clerk-
 *      minted JWT (proves `verifyToken({ secretKey })` works in the
 *      Lambda runtime — not just in the unit-test stub).
 *   2. The JWT template's `org_id` and `org_role` claims reach the
 *      handler (validates the operator's Clerk Dashboard config).
 *   3. The `clerkAdminOnly()` gate accepts admin roles (or correctly
 *      rejects non-admin with 403).
 *   4. `provisionOrg` + DDB writes work end-to-end against the real
 *      Stripe + DDB tables for the stage being tested.
 *   5. Idempotency: a second run returns 200 already_exists (when
 *      `EXPECT` isn't pinned to `created`).
 *
 * ## Exit codes
 *
 *   - 0 — smoke passed (matched EXPECT or default 201/200)
 *   - 1 — smoke ran end-to-end but the response didn't match EXPECT
 *   - 2 — smoke could not run (env missing, no suitable session,
 *         timeout, transport error, or non-JSON upstream response)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClerkClient } from "@clerk/backend";
import type { Session } from "@clerk/backend";

interface SetupSuccess {
  status: "created" | "already_exists";
  stripeCustomerId: string;
  emailSent?: boolean;
}

interface SetupError {
  error: {
    code: string;
    message: string;
    status: number;
    request_id: string;
    details?: Record<string, unknown>;
  };
}

const DEFAULT_TIMEOUT_MS = 15_000;
const RAW_BODY_SNIPPET_BYTES = 500;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required. See script doc-block for usage.`);
  }
  return value.trim();
}

function resolveApiBaseUrl(): string {
  const configured = process.env.PRONTIQ_API;
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }

  const outputsPath = path.resolve(process.cwd(), ".sst/outputs.json");
  try {
    const parsed = JSON.parse(readFileSync(outputsPath, "utf8")) as { api?: unknown };
    if (typeof parsed.api === "string" && parsed.api.trim().length > 0) {
      return parsed.api.trim();
    }
  } catch {
    // Fall through to the explicit operator-facing error below.
  }

  throw new Error(
    "PRONTIQ_API is required when .sst/outputs.json is unavailable or missing the api output.",
  );
}

function getOptionalEnvOrNull(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

function getTimeoutMs(): number {
  const raw = process.env.SMOKE_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`SMOKE_TIMEOUT_MS must be a positive integer; got "${raw}"`);
  }
  return parsed;
}

/**
 * Wrap a Promise with a timeout. The Clerk SDK doesn't expose
 * cancellation, so we race against a setTimeout — the underlying call
 * still runs in the background but the script is about to exit anyway,
 * so the leak doesn't matter. Bug 2 fix from PR #103 review.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ).unref?.(),
    ),
  ]);
}

// ───────────────────────────────────────────────────────────────────
// Session resolution (Bug 1 fix)
//
// The previous implementation grabbed `data[0]` from getSessionList
// which, when a user has multiple active sessions (laptop + phone, or
// two browsers), returned a non-deterministic session that may have:
//   - no active org (org_id claim missing → 400 NO_ACTIVE_ORG)
//   - a different org than the one we want to test
// Either way: false-negative smoke result on a healthy endpoint.
//
// New rules:
//   1. Filter to sessions where `lastActiveOrganizationId` is set.
//   2. If `CLERK_TEST_ORG_ID` is set: filter further to that org. Must
//      match exactly one session — otherwise fail with the candidate
//      list and instruct the operator to pin via CLERK_TEST_SESSION_ID.
//   3. If not set: must be exactly one session with org context;
//      otherwise fail with instructions (pass CLERK_TEST_ORG_ID, OR
//      sign in fresh via dashboard impersonation).
//   4. CLERK_TEST_SESSION_ID short-circuits resolution (operator picks).
//   5. Always print the chosen session_id + its org context so reruns
//      are deterministic.
// ───────────────────────────────────────────────────────────────────

interface ResolvedSession {
  session: Session;
  origin: "pinned_by_session_id" | "matched_target_org" | "single_active" | "created_fresh";
}

interface ResolvedSmokeUser {
  source: "email" | "user_id";
  userId: string;
}

class SessionResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionResolutionError";
  }
}

async function resolveSmokeUser(
  clerk: ReturnType<typeof createClerkClient>,
  identifier: string,
  timeoutMs: number,
): Promise<ResolvedSmokeUser> {
  if (identifier.startsWith("user_")) {
    return { source: "user_id", userId: identifier };
  }

  const list = await withTimeout(
    clerk.users.getUserList({
      emailAddress: [identifier],
      limit: 2,
    }),
    timeoutMs,
    `clerk.users.getUserList(${identifier})`,
  );

  if (list.data.length === 1) {
    const user = list.data[0];
    if (!user) {
      throw new SessionResolutionError("Internal: Clerk returned undefined user.");
    }
    return { source: "email", userId: user.id };
  }
  if (list.data.length === 0) {
    throw new SessionResolutionError(
      `CLERK_TEST_USER_ID=${identifier} did not match any Clerk user. Provide a Clerk user_id (user_...) or a primary email address that exists in this tenant.`,
    );
  }
  throw new SessionResolutionError(
    `CLERK_TEST_USER_ID=${identifier} matched multiple Clerk users. Use the explicit Clerk user_id (user_...) instead.`,
  );
}

async function resolveSession(
  clerk: ReturnType<typeof createClerkClient>,
  userId: string,
  targetOrgId: string | null,
  pinnedSessionId: string | null,
  timeoutMs: number,
): Promise<ResolvedSession> {
  if (pinnedSessionId) {
    const session = await withTimeout(
      clerk.sessions.getSession(pinnedSessionId),
      timeoutMs,
      `clerk.sessions.getSession(${pinnedSessionId})`,
    );
    if (session.userId !== userId) {
      throw new SessionResolutionError(
        `CLERK_TEST_SESSION_ID=${pinnedSessionId} belongs to user ${session.userId}, not CLERK_TEST_USER_ID=${userId}.`,
      );
    }
    if (targetOrgId && session.lastActiveOrganizationId !== targetOrgId) {
      throw new SessionResolutionError(
        `Pinned session ${pinnedSessionId} has lastActiveOrganizationId=${session.lastActiveOrganizationId ?? "null"} but CLERK_TEST_ORG_ID=${targetOrgId}. Pick a different session or update setActive on this one.`,
      );
    }
    return { session, origin: "pinned_by_session_id" };
  }

  const list = await withTimeout(
    clerk.sessions.getSessionList({ userId, status: "active" }),
    timeoutMs,
    "clerk.sessions.getSessionList",
  );
  const withOrg = list.data.filter(
    (s) => typeof s.lastActiveOrganizationId === "string" && s.lastActiveOrganizationId.length > 0,
  );

  if (targetOrgId) {
    const matching = withOrg.filter((s) => s.lastActiveOrganizationId === targetOrgId);
    if (matching.length === 1) {
      const session = matching[0];
      if (!session) throw new SessionResolutionError("Internal: filter returned undefined element");
      return { session, origin: "matched_target_org" };
    }
    if (matching.length > 1) {
      const candidates = matching.map((s) => `  - ${s.id} (lastActiveAt=${s.lastActiveAt ?? "null"})`).join("\n");
      throw new SessionResolutionError(
        `${matching.length} active sessions match CLERK_TEST_ORG_ID=${targetOrgId}. Pin one via CLERK_TEST_SESSION_ID:\n${candidates}`,
      );
    }
    // No matching session — try to create one (dev tenants only)
    return await tryCreateSession(clerk, userId, targetOrgId, timeoutMs);
  }

  if (withOrg.length === 1) {
    const session = withOrg[0];
    if (!session) throw new SessionResolutionError("Internal: filter returned undefined element");
    return { session, origin: "single_active" };
  }
  if (withOrg.length > 1) {
    const candidates = withOrg
      .map((s) => `  - ${s.id} → org=${s.lastActiveOrganizationId} (lastActiveAt=${s.lastActiveAt ?? "null"})`)
      .join("\n");
    throw new SessionResolutionError(
      `User has ${withOrg.length} active sessions across multiple orgs. Set CLERK_TEST_ORG_ID to disambiguate:\n${candidates}`,
    );
  }
  // Zero sessions with an org context — try to create one
  return await tryCreateSession(clerk, userId, null, timeoutMs);
}

async function tryCreateSession(
  clerk: ReturnType<typeof createClerkClient>,
  userId: string,
  targetOrgId: string | null,
  timeoutMs: number,
): Promise<ResolvedSession> {
  let created: Session;
  try {
    created = await withTimeout(
      clerk.sessions.createSession({ userId }),
      timeoutMs,
      "clerk.sessions.createSession",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SessionResolutionError(
      `No suitable existing session found AND createSession failed: ${message}\n` +
        "\n" +
        "This is normal for production Clerk tenants (createSession is dev-only on most plans).\n" +
        "Workaround:\n" +
        "  1. In Clerk Dashboard, find the test user → click 'Impersonate user'\n" +
        "  2. In the impersonation window, the session is already active for that user\n" +
        "  3. If needed, navigate to a page that calls setActive({ organization: '<target_org>' })\n" +
        "  4. Re-run this script — it will find the active session\n" +
        "\n" +
        "If you don't have a frontend yet (P1C pending), the impersonation flow still gives\n" +
        "you a session, but you'll need to ensure it has the right org context another way\n" +
        "(e.g., the user has only one org membership so it auto-activates).",
    );
  }
  if (targetOrgId && created.lastActiveOrganizationId !== targetOrgId) {
    throw new SessionResolutionError(
      `Created a fresh session ${created.id} but lastActiveOrganizationId=${created.lastActiveOrganizationId ?? "null"} doesn't match CLERK_TEST_ORG_ID=${targetOrgId}.\n` +
        "Backend SDK can't pin org context on session create — that requires a frontend\n" +
        "setActive call. Either ensure the user has only one org membership (so the new\n" +
        "session auto-activates it), or use the impersonation flow described above.",
    );
  }
  if (!created.lastActiveOrganizationId) {
    throw new SessionResolutionError(
      `Created a fresh session ${created.id} but it has no active org. The user has zero or multiple org memberships, and Backend SDK can't pin a target — that requires a frontend setActive call. Use the impersonation flow described above, or ensure the user has exactly one org membership.`,
    );
  }
  return { session: created, origin: "created_fresh" };
}

// ───────────────────────────────────────────────────────────────────
// Smoke result + classification (Bug 2 + Bug 3 fix)
//
// SmokeResult is a discriminated union so transport errors and
// non-JSON upstream responses are first-class outcomes (instead of
// crashing through the top-level catch). EXPECT works against all
// three kinds.
// ───────────────────────────────────────────────────────────────────

type SmokeResult =
  | {
      kind: "json";
      httpStatus: number;
      body: SetupSuccess | SetupError;
      requestId: string | null;
      durationMs: number;
    }
  | {
      kind: "non_json";
      httpStatus: number;
      contentType: string | null;
      bodySnippet: string;
      requestId: string | null;
      durationMs: number;
    }
  | {
      kind: "transport_error";
      reason: string;
      durationMs: number;
    };

async function smokeAccountSetup(
  apiUrl: string,
  jwt: string,
  timeoutMs: number,
): Promise<SmokeResult> {
  const url = `${apiUrl.replace(/\/$/, "")}/v1/account/setup`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const durationMs = Date.now() - start;
    const requestId = res.headers.get("x-request-id");
    const contentType = res.headers.get("content-type");
    const isJson = contentType !== null && contentType.toLowerCase().includes("application/json");
    if (isJson) {
      try {
        const body = (await res.json()) as SetupSuccess | SetupError;
        return { kind: "json", httpStatus: res.status, body, requestId, durationMs };
      } catch {
        // content-type lied — body wasn't actually JSON
        const bodyText = await res.text().catch(() => "<failed to read body>");
        return {
          kind: "non_json",
          httpStatus: res.status,
          contentType,
          bodySnippet: bodyText.slice(0, RAW_BODY_SNIPPET_BYTES),
          requestId,
          durationMs,
        };
      }
    }
    const bodyText = await res.text().catch(() => "<failed to read body>");
    return {
      kind: "non_json",
      httpStatus: res.status,
      contentType,
      bodySnippet: bodyText.slice(0, RAW_BODY_SNIPPET_BYTES),
      requestId,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { kind: "transport_error", reason: `request timed out after ${timeoutMs}ms`, durationMs };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "transport_error", reason: message, durationMs };
  }
}

interface ExpectationCheck {
  pass: boolean;
  reason: string;
}

function checkExpectation(result: SmokeResult, expect: string | undefined): ExpectationCheck {
  if (result.kind === "transport_error") {
    return { pass: false, reason: `transport error: ${result.reason}` };
  }
  if (result.kind === "non_json") {
    return {
      pass: false,
      reason: `upstream returned non-JSON (HTTP ${result.httpStatus}, content-type=${result.contentType ?? "null"}). Endpoint or proxy is misbehaving.`,
    };
  }
  const code = "error" in result.body ? result.body.error.code : null;
  const status = "error" in result.body ? null : result.body.status;
  if (!expect) {
    if (result.httpStatus === 201 && status === "created") {
      return { pass: true, reason: "201 created (fresh org)" };
    }
    if (result.httpStatus === 200 && status === "already_exists") {
      return { pass: true, reason: "200 already_exists (idempotent replay)" };
    }
    return {
      pass: false,
      reason: `unexpected response ${result.httpStatus} ${code ?? status ?? "unknown"}`,
    };
  }
  switch (expect) {
    case "created":
      return result.httpStatus === 201 && status === "created"
        ? { pass: true, reason: "201 created" }
        : { pass: false, reason: `expected 201 created, got ${result.httpStatus} ${code ?? status}` };
    case "already_exists":
      return result.httpStatus === 200 && status === "already_exists"
        ? { pass: true, reason: "200 already_exists" }
        : {
            pass: false,
            reason: `expected 200 already_exists, got ${result.httpStatus} ${code ?? status}`,
          };
    case "403":
      return result.httpStatus === 403 && code === "INSUFFICIENT_ROLE"
        ? { pass: true, reason: "403 INSUFFICIENT_ROLE (non-admin caller correctly rejected)" }
        : { pass: false, reason: `expected 403 INSUFFICIENT_ROLE, got ${result.httpStatus} ${code}` };
    case "400":
      return result.httpStatus === 400
        ? { pass: true, reason: `400 ${code ?? "unknown"}` }
        : { pass: false, reason: `expected 400, got ${result.httpStatus} ${code}` };
    default:
      return { pass: false, reason: `unknown EXPECT value: ${expect}` };
  }
}

function printResult(result: SmokeResult): void {
  console.log(`      HTTP ${result.kind === "transport_error" ? "(no response)" : result.httpStatus} in ${result.durationMs}ms`);
  if (result.kind === "transport_error") {
    console.log(`      Transport error: ${result.reason}`);
    return;
  }
  if (result.requestId) console.log(`      X-Request-Id: ${result.requestId}`);
  if (result.kind === "non_json") {
    console.log(`      Content-Type: ${result.contentType ?? "null"}`);
    console.log(`      Body snippet (≤${RAW_BODY_SNIPPET_BYTES} bytes):`);
    console.log(result.bodySnippet.split("\n").map((l) => `        ${l}`).join("\n"));
    return;
  }
  console.log(`      Body: ${JSON.stringify(result.body, null, 2)}`);
}

export async function run(): Promise<number> {
  const secretKey = getRequiredEnv("CLERK_SECRET_KEY");
  const userIdentifier = getRequiredEnv("CLERK_TEST_USER_ID");
  const targetOrgId = getOptionalEnvOrNull("CLERK_TEST_ORG_ID");
  const pinnedSessionId = getOptionalEnvOrNull("CLERK_TEST_SESSION_ID");
  const apiUrl = resolveApiBaseUrl();
  const expect = process.env.EXPECT?.trim();
  const timeoutMs = getTimeoutMs();

  console.log("=== Account-setup smoke ===");
  console.log(`API:     ${apiUrl}`);
  console.log(`User:    ${userIdentifier}`);
  console.log(`Org:     ${targetOrgId ?? "(unpinned — must be exactly one active session with org)"}`);
  if (pinnedSessionId) console.log(`Session: ${pinnedSessionId} (pinned)`);
  console.log(`Tenant:  ${secretKey.startsWith("sk_live_") ? "PROD (sk_live_)" : "DEV (sk_test_)"}`);
  console.log(`Timeout: ${timeoutMs}ms per call`);
  if (expect) console.log(`Expect:  ${expect}`);
  console.log();

  const clerk = createClerkClient({ secretKey });
  let resolvedUser: ResolvedSmokeUser;
  try {
    resolvedUser = await resolveSmokeUser(clerk, userIdentifier, timeoutMs);
  } catch (error) {
    if (error instanceof SessionResolutionError) {
      console.error(`\n      ${error.message}`);
      return 2;
    }
    console.error("      Unexpected error while resolving test user:", error);
    return 2;
  }
  if (resolvedUser.source === "email") {
    console.log(`Resolved Clerk user: ${resolvedUser.userId} (from email)`);
  }

  console.log("[1/3] Resolving target session...");
  let resolved: ResolvedSession;
  try {
    resolved = await resolveSession(clerk, resolvedUser.userId, targetOrgId, pinnedSessionId, timeoutMs);
  } catch (error) {
    if (error instanceof SessionResolutionError) {
      console.error(`\n      ${error.message}`);
      return 2;
    }
    console.error("      Unexpected error during session resolution:", error);
    return 2;
  }
  const { session, origin } = resolved;
  console.log(`      Session: ${session.id}`);
  console.log(`      Origin:  ${origin}`);
  console.log(`      Org:     ${session.lastActiveOrganizationId ?? "null"}`);

  console.log("[2/3] Minting a session JWT (uses the configured default template)...");
  let token: { jwt: string };
  try {
    token = await withTimeout(
      clerk.sessions.getToken(session.id),
      timeoutMs,
      `clerk.sessions.getToken(${session.id})`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`      Failed to mint session JWT: ${message}`);
    return 2;
  }
  if (!token.jwt || token.jwt.length === 0) {
    console.error("      Token returned but jwt field is empty — check Clerk template config.");
    return 2;
  }
  console.log(`      JWT length: ${token.jwt.length} bytes`);

  console.log("[3/3] Calling POST /v1/account/setup with the JWT...");
  const result = await smokeAccountSetup(apiUrl, token.jwt, timeoutMs);
  printResult(result);
  console.log();

  const check = checkExpectation(result, expect);
  if (check.pass) {
    console.log(`✅ PASS — ${check.reason}`);
    return 0;
  }
  console.error(`❌ FAIL — ${check.reason}`);
  return result.kind === "json" ? 1 : 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error("Smoke threw unexpectedly:", error);
      process.exit(2);
    });
}
