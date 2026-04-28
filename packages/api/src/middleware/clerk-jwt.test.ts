import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  ClerkAPIResponseError,
  TokenVerificationError,
  TokenVerificationErrorReason,
} from "@clerk/backend/errors";
import {
  clerkAdminOnly,
  clerkJwt,
  requireReverification,
  type ClerkVerifier,
} from "./clerk-jwt.js";
import { requestId } from "./request-id.js";

function makeTokenError(reason: string, message = "verification failed"): TokenVerificationError {
  return new TokenVerificationError({ reason, message });
}

function makeApiError(status: number, retryAfter?: number): ClerkAPIResponseError {
  return new ClerkAPIResponseError("Clerk BAPI error", {
    data: [],
    status,
    ...(retryAfter !== undefined ? { retryAfter } : {}),
  });
}

function makeApp(verifier: ClerkVerifier) {
  const app = new Hono();
  app.use("*", requestId());
  app.use("/v1/account/*", clerkJwt({ verifier }));
  app.post("/v1/account/setup", (c) => {
    const principal = c.get("clerkPrincipal");
    return c.json({
      ok: true,
      userId: principal.userId,
      orgId: principal.orgId,
      orgRole: principal.orgRole,
    });
  });
  return app;
}

async function postSetup(app: Hono, headers: Record<string, string> = {}): Promise<Response> {
  return await app.request("/v1/account/setup", { method: "POST", headers });
}

test("valid token + org_id + org_role claims → 200 + clerkPrincipal set", async () => {
  const verifier: ClerkVerifier = async (token) => {
    assert.equal(token, "good_token", "verifier receives the bearer token");
    return { sub: "user_abc", org_id: "org_xyz", org_role: "org:admin" };
  };
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer good_token" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok: boolean;
    userId: string;
    orgId: string;
    orgRole: string;
  };
  assert.deepEqual(body, { ok: true, userId: "user_abc", orgId: "org_xyz", orgRole: "org:admin" });
});

test("valid token without org_role claim → principal.orgRole is empty string (clerkAdminOnly decides)", async () => {
  const verifier: ClerkVerifier = async () => ({ sub: "user_abc", org_id: "org_xyz" });
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer good_token" });
  assert.equal(res.status, 200, "clerkJwt itself doesn't reject — clerkAdminOnly is the gate");
  const body = (await res.json()) as { orgRole: string };
  assert.equal(body.orgRole, "");
});

test("lowercase 'authorization' header still accepted", async () => {
  const verifier: ClerkVerifier = async () => ({ sub: "user_abc", org_id: "org_xyz" });
  const app = makeApp(verifier);
  const res = await postSetup(app, { authorization: "Bearer good_token" });
  assert.equal(res.status, 200);
});

test("lowercase 'bearer' prefix still accepted (case-insensitive scheme)", async () => {
  const verifier: ClerkVerifier = async () => ({ sub: "user_abc", org_id: "org_xyz" });
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "bearer good_token" });
  assert.equal(res.status, 200);
});

test("missing Authorization header → 401 INVALID_TOKEN", async () => {
  let verifierCalls = 0;
  const verifier: ClerkVerifier = async () => {
    verifierCalls += 1;
    return { sub: "u", org_id: "o" };
  };
  const app = makeApp(verifier);
  const res = await postSetup(app);
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string; status: number; request_id: string } };
  assert.equal(body.error.code, "INVALID_TOKEN");
  assert.equal(body.error.status, 401);
  assert.match(body.error.request_id, /^req_/);
  assert.equal(verifierCalls, 0, "verifier MUST NOT be called when header is missing");
});

test("Authorization header without Bearer prefix → 401 INVALID_TOKEN", async () => {
  const verifier: ClerkVerifier = async () => ({ sub: "u", org_id: "o" });
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Basic dXNlcjpwYXNz" });
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "INVALID_TOKEN");
  assert.match(body.error.message, /Bearer scheme/);
});

test("verifier throws TokenVerificationError(TokenExpired) → 401 INVALID_TOKEN", async () => {
  const verifier: ClerkVerifier = async () => {
    throw makeTokenError(TokenVerificationErrorReason.TokenExpired, "JWT is expired");
  };
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer expired_token" });
  assert.equal(res.status, 401);
  const body = (await res.json()) as {
    error: { code: string; message: string; details?: { reason: string } };
  };
  assert.equal(body.error.code, "INVALID_TOKEN");
  assert.match(body.error.message, /Invalid or expired/);
  assert.equal(body.error.details?.reason, TokenVerificationErrorReason.TokenExpired);
});

test("verifier throws TokenVerificationError(TokenInvalidSignature) → 401 INVALID_TOKEN", async () => {
  const verifier: ClerkVerifier = async () => {
    throw makeTokenError(TokenVerificationErrorReason.TokenInvalidSignature);
  };
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer tampered" });
  assert.equal(res.status, 401);
});

test("verifier throws TokenVerificationError(RemoteJWKFailedToLoad) → 503 VERIFIER_UNAVAILABLE (Bug 4 — Clerk JWKS unreachable)", async () => {
  const verifier: ClerkVerifier = async () => {
    throw makeTokenError(TokenVerificationErrorReason.RemoteJWKFailedToLoad, "JWKS fetch failed");
  };
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer good_token" });
  assert.equal(res.status, 503, "must NOT be 401 — token is fine, Clerk is down");
  const body = (await res.json()) as {
    error: { code: string; status: number; details: { reason: string } };
  };
  assert.equal(body.error.code, "VERIFIER_UNAVAILABLE");
  assert.equal(body.error.status, 503);
  assert.equal(body.error.details.reason, TokenVerificationErrorReason.RemoteJWKFailedToLoad);
});

test("verifier throws TokenVerificationError(JWKFailedToResolve) → 503 VERIFIER_UNAVAILABLE", async () => {
  const verifier: ClerkVerifier = async () => {
    throw makeTokenError(TokenVerificationErrorReason.JWKFailedToResolve);
  };
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 503);
});

test("verifier throws TokenVerificationError(InvalidSecretKey) → 500 INTERNAL_ERROR (operator config)", async () => {
  const verifier: ClerkVerifier = async () => {
    throw makeTokenError(TokenVerificationErrorReason.InvalidSecretKey, "secret key malformed");
  };
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: { code: string; details?: { reason: string } } };
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.details?.reason, TokenVerificationErrorReason.InvalidSecretKey);
});

test("verifier throws TokenVerificationError with UNKNOWN reason → 503 VERIFIER_UNAVAILABLE (conservative default; Clerk SDK upgrade safe)", async () => {
  // If a future Clerk SDK release adds a new reason that isn't in any
  // of our reason sets, we MUST NOT silently re-route it back to 401
  // (that's the bug we're fixing). 503 is the safe default — operator
  // alarm fires, we add specific handling once we see the reason.
  const verifier: ClerkVerifier = async () => {
    throw makeTokenError("some-future-clerk-sdk-reason");
  };
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { details: { reason: string } } };
  assert.equal(body.error.details.reason, "some-future-clerk-sdk-reason");
});

test("verifier throws ClerkAPIResponseError(503) → 503 VERIFIER_UNAVAILABLE (upstream 5xx)", async () => {
  const verifier: ClerkVerifier = async () => {
    throw makeApiError(503);
  };
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { details: { reason: string } } };
  assert.equal(body.error.details.reason, "clerk_api_503");
});

test("verifier throws ClerkAPIResponseError(429) → 503 VERIFIER_UNAVAILABLE with retryAfter surfaced", async () => {
  const verifier: ClerkVerifier = async () => {
    throw makeApiError(429, 30);
  };
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 503);
  const body = (await res.json()) as {
    error: { details: { reason: string; retryAfter?: number } };
  };
  assert.equal(body.error.details.reason, "clerk_api_429");
  assert.equal(body.error.details.retryAfter, 30, "retry-after surfaces so the dashboard can back off");
});

test("verifier throws ClerkAPIResponseError(400) → 500 INTERNAL_ERROR (our request to Clerk was malformed)", async () => {
  const verifier: ClerkVerifier = async () => {
    throw makeApiError(400);
  };
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: { details?: { reason: string } } };
  assert.equal(body.error.details?.reason, "clerk_api_400");
});

test("verifier throws TypeError('fetch failed') → 503 VERIFIER_UNAVAILABLE (raw network failure, not wrapped by Clerk SDK)", async () => {
  const verifier: ClerkVerifier = async () => {
    throw new TypeError("fetch failed");
  };
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { details: { reason: string } } };
  assert.equal(body.error.details.reason, "network_error");
});

test("verifier throws plain Error (unknown) → 500 INTERNAL_ERROR (conservative default, operator alarm fires)", async () => {
  const verifier: ClerkVerifier = async () => {
    throw new Error("something weird happened");
  };
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INTERNAL_ERROR");
});

test("verifier throws non-Error → 500 INTERNAL_ERROR (no crash, conservative default)", async () => {
  const verifier: ClerkVerifier = async () => {
    throw "raw string failure";
  };
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 500);
});

test("verifier throws with canonical CLERK_SECRET_KEY guard message → 500 INTERNAL_ERROR", async () => {
  const verifier: ClerkVerifier = async () => {
    throw new Error("CLERK_SECRET_KEY is required");
  };
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INTERNAL_ERROR");
});

test("token verified but `sub` claim missing → 401 INVALID_TOKEN", async () => {
  const verifier: ClerkVerifier = async () => ({ org_id: "org_xyz" });
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "INVALID_TOKEN");
  assert.match(body.error.message, /sub/);
});

test("token verified but `sub` claim is non-string → 401 INVALID_TOKEN", async () => {
  const verifier: ClerkVerifier = async () => ({ sub: 12345, org_id: "org_xyz" });
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 401);
});

test("token verified but `org_id` claim missing → 400 NO_ACTIVE_ORG", async () => {
  const verifier: ClerkVerifier = async () => ({ sub: "user_abc" });
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string; message: string; status: number } };
  assert.equal(body.error.code, "NO_ACTIVE_ORG");
  assert.equal(body.error.status, 400);
  assert.match(body.error.message, /JWT template/, "message points operators at the JWT template fix");
  assert.match(body.error.message, /setActive/, "message also names the frontend prerequisite");
});

test("token verified but `org_id` is empty string → 400 NO_ACTIVE_ORG", async () => {
  const verifier: ClerkVerifier = async () => ({ sub: "user_abc", org_id: "" });
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 400);
});

test("token verified but `org_id` is non-string → 400 NO_ACTIVE_ORG", async () => {
  const verifier: ClerkVerifier = async () => ({ sub: "user_abc", org_id: 0 });
  const app = makeApp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 400);
});

// ─── clerkAdminOnly() ─────────────────────────────────────────────────
//
// Mounted AFTER clerkJwt() in the production stack
// (account-handler.ts). These tests compose both middlewares so the
// principal is populated before the gate runs.

function makeAppWithAdminGate(
  verifier: ClerkVerifier,
  rolesProvider?: () => ReadonlySet<string>,
) {
  const app = new Hono();
  app.use("*", requestId());
  app.use("/v1/account/*", clerkJwt({ verifier }));
  app.use("/v1/account/*", clerkAdminOnly(rolesProvider ? { rolesProvider } : {}));
  app.post("/v1/account/setup", (c) => {
    const principal = c.get("clerkPrincipal");
    return c.json({ ok: true, role: principal.orgRole });
  });
  return app;
}

test("clerkAdminOnly: org_role 'org:admin' (default) → 200, route handler runs", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_admin",
    org_id: "org_xyz",
    org_role: "org:admin",
  });
  const app = makeAppWithAdminGate(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 200);
});

test("clerkAdminOnly: org_role 'admin' (legacy/custom default) → 200", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_admin",
    org_id: "org_xyz",
    org_role: "admin",
  });
  const app = makeAppWithAdminGate(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 200);
});

test("clerkAdminOnly: org_role 'org:member' → 403 INSUFFICIENT_ROLE with role surfaced in details", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_member",
    org_id: "org_xyz",
    org_role: "org:member",
  });
  const app = makeAppWithAdminGate(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 403);
  const body = (await res.json()) as {
    error: { code: string; status: number; details: { role: string } };
  };
  assert.equal(body.error.code, "INSUFFICIENT_ROLE");
  assert.equal(body.error.status, 403);
  assert.equal(body.error.details.role, "org:member");
});

test("clerkAdminOnly: missing org_role claim → 400 NO_ROLE_CLAIM (operator JWT-template gap)", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_abc",
    org_id: "org_xyz",
    // no org_role claim
  });
  const app = makeAppWithAdminGate(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "NO_ROLE_CLAIM");
  assert.match(body.error.message, /JWT template/, "message points operators at the JWT template fix");
});

test("clerkAdminOnly: empty-string org_role claim treated as missing → 400 NO_ROLE_CLAIM", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_abc",
    org_id: "org_xyz",
    org_role: "",
  });
  const app = makeAppWithAdminGate(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "NO_ROLE_CLAIM");
});

test("clerkAdminOnly: non-string org_role treated as missing → 400 NO_ROLE_CLAIM", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_abc",
    org_id: "org_xyz",
    org_role: 12345,
  });
  const app = makeAppWithAdminGate(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 400);
});

test("clerkAdminOnly: custom rolesProvider — 'owner' role accepted when overridden", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_owner",
    org_id: "org_xyz",
    org_role: "owner",
  });
  const app = makeAppWithAdminGate(verifier, () => new Set(["owner", "principal"]));
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 200);
});

test("clerkAdminOnly: custom rolesProvider rejects roles not in the set", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_admin",
    org_id: "org_xyz",
    org_role: "org:admin",
  });
  const app = makeAppWithAdminGate(verifier, () => new Set(["owner"]));
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 403);
});

test("clerkAdminOnly: principal missing (mounted without clerkJwt) → 500 INTERNAL_ERROR", async () => {
  const app = new Hono();
  app.use("*", requestId());
  app.use("/v1/account/*", clerkAdminOnly());
  app.post("/v1/account/setup", (c) => c.json({ ok: true }));
  const res = await postSetup(app);
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INTERNAL_ERROR");
});

// ─── fva claim parsing in clerkJwt() ────────────────────────────────
//
// `fva` is OPTIONAL on the principal — clerkJwt sets it when the
// claim is a valid number array, otherwise leaves it undefined.
// `requireReverification()` (downstream) decides whether absence is
// a problem.

function makeAppExposingFva(verifier: ClerkVerifier) {
  const app = new Hono();
  app.use("*", requestId());
  app.use("/v1/account/*", clerkJwt({ verifier }));
  app.post("/v1/account/setup", (c) => {
    const principal = c.get("clerkPrincipal");
    return c.json({ ok: true, fva: principal.fva ?? null });
  });
  return app;
}

test("clerkJwt: fva claim is parsed when present and valid", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_a",
    org_id: "org_x",
    org_role: "org:admin",
    fva: [0, 5],
  });
  const app = makeAppExposingFva(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { fva: number[] | null };
  assert.deepEqual(body.fva, [0, 5]);
});

test("clerkJwt: fva claim absent → principal.fva undefined (returned as null in test response)", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_a",
    org_id: "org_x",
    org_role: "org:admin",
  });
  const app = makeAppExposingFva(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { fva: number[] | null };
  assert.equal(body.fva, null, "absent claim must NOT produce a default array");
});

test("clerkJwt: fva claim is non-array → principal.fva undefined (tolerated, not 401)", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_a",
    org_id: "org_x",
    org_role: "org:admin",
    fva: "not-an-array",
  });
  const app = makeAppExposingFva(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 200, "malformed fva must not gate clerkJwt itself");
  const body = (await res.json()) as { fva: number[] | null };
  assert.equal(body.fva, null);
});

test("clerkJwt: fva array containing a non-number → undefined (defensive parse)", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_a",
    org_id: "org_x",
    org_role: "org:admin",
    fva: [0, "11"],
  });
  const app = makeAppExposingFva(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { fva: number[] | null };
  assert.equal(body.fva, null, "mixed-type array rejected; downstream gate fails STEP_UP_MISCONFIGURED");
});

test("clerkJwt: fva with -1 (factor never used) is still a valid number array", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_a",
    org_id: "org_x",
    org_role: "org:admin",
    fva: [0, -1],
  });
  const app = makeAppExposingFva(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { fva: number[] | null };
  assert.deepEqual(body.fva, [0, -1], "clerkJwt parses -1; requireReverification rejects it as stale");
});

// ─── requireReverification() ────────────────────────────────────────
//
// Composes after clerkJwt(). Tests cover the three failure-mode
// branches (missing claim → 500, stale → 403 Clerk-native, fresh → next)
// plus the misconfiguration guard.

function makeAppWithStepUp(
  verifier: ClerkVerifier,
  options: { maxSecondFactorAgeMinutes?: number } = {},
) {
  const app = new Hono();
  app.use("*", requestId());
  app.use("/v1/account/*", clerkJwt({ verifier }));
  app.use("/v1/account/*", requireReverification(options));
  app.post("/v1/account/setup", (c) => c.json({ ok: true }));
  return app;
}

test("requireReverification: missing fva claim → 500 STEP_UP_MISCONFIGURED (fail-loud, not 403)", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_a",
    org_id: "org_x",
    org_role: "org:admin",
  });
  const app = makeAppWithStepUp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: { code: string }; clerk_error?: unknown };
  assert.equal(body.error.code, "STEP_UP_MISCONFIGURED");
  assert.equal(
    body.clerk_error,
    undefined,
    "MUST NOT be the Clerk-native 403 body — that would loop the frontend reverify modal",
  );
});

test("requireReverification: fva[1] within max → next() runs", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_a",
    org_id: "org_x",
    org_role: "org:admin",
    fva: [0, 5],
  });
  const app = makeAppWithStepUp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 200);
});

test("requireReverification: fva[1] exactly at max boundary → pass (inclusive)", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_a",
    org_id: "org_x",
    org_role: "org:admin",
    fva: [0, 10],
  });
  const app = makeAppWithStepUp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 200, "max=10 with fva[1]=10 is within window (inclusive boundary)");
});

test("requireReverification: fva[1] over max → 403 Clerk-native body shape", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_a",
    org_id: "org_x",
    org_role: "org:admin",
    fva: [0, 11],
  });
  const app = makeAppWithStepUp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 403);
  const body = (await res.json()) as {
    clerk_error?: {
      type: string;
      reason: string;
      metadata: { level: string; afterMinutes: number };
    };
    error?: unknown;
  };
  assert.ok(body.clerk_error, "Clerk-native body required so useReverification() recognises it");
  assert.equal(body.error, undefined, "must NOT use the standard error envelope");
  assert.equal(body.clerk_error?.type, "forbidden");
  assert.equal(body.clerk_error?.reason, "reverification-error");
  assert.equal(body.clerk_error?.metadata.level, "second_factor");
  assert.equal(body.clerk_error?.metadata.afterMinutes, 10);
});

test("requireReverification: fva[1] = -1 (never verified) → 403 (treated as stale)", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_a",
    org_id: "org_x",
    org_role: "org:admin",
    fva: [0, -1],
  });
  const app = makeAppWithStepUp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { clerk_error?: { reason: string } };
  assert.equal(body.clerk_error?.reason, "reverification-error");
});

test("requireReverification: custom maxSecondFactorAgeMinutes is honoured", async () => {
  const verifier: ClerkVerifier = async () => ({
    sub: "user_a",
    org_id: "org_x",
    org_role: "org:admin",
    fva: [0, 3],
  });
  // Tighten max to 2 — fva[1]=3 must now fail
  const tight = makeAppWithStepUp(verifier, { maxSecondFactorAgeMinutes: 2 });
  const tightRes = await postSetup(tight, { Authorization: "Bearer x" });
  assert.equal(tightRes.status, 403);
  // With default 10, the same token passes
  const loose = makeAppWithStepUp(verifier);
  const looseRes = await postSetup(loose, { Authorization: "Bearer x" });
  assert.equal(looseRes.status, 200);
});

test("requireReverification: fva[1] is non-number (e.g., due to corrupted token) → 403 Clerk-native body", async () => {
  // Construct a verifier that passes clerkJwt's parser (all entries
  // ARE numbers) but where the SECOND ENTRY is undefined at runtime.
  // This is a defence-in-depth check on the bounds-typeof guard.
  const verifier: ClerkVerifier = async () => ({
    sub: "user_a",
    org_id: "org_x",
    org_role: "org:admin",
    fva: [0], // single-element array; fva[1] === undefined
  });
  const app = makeAppWithStepUp(verifier);
  const res = await postSetup(app, { Authorization: "Bearer x" });
  assert.equal(res.status, 403, "missing index-1 element falls through to the stale path");
  const body = (await res.json()) as { clerk_error?: { reason: string } };
  assert.equal(body.clerk_error?.reason, "reverification-error");
});

test("requireReverification: principal missing (mounted without clerkJwt) → 500 INTERNAL_ERROR", async () => {
  const app = new Hono();
  app.use("*", requestId());
  app.use("/v1/account/*", requireReverification());
  app.post("/v1/account/setup", (c) => c.json({ ok: true }));
  const res = await postSetup(app);
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INTERNAL_ERROR");
});
