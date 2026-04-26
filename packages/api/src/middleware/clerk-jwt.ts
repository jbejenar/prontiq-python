import { createMiddleware } from "hono/factory";
import { verifyToken } from "@clerk/backend";
import {
  TokenVerificationError,
  TokenVerificationErrorReason,
  isClerkAPIResponseError,
} from "@clerk/backend/errors";
import { getAdminRoles } from "@prontiq/control-plane";
import { createLogger } from "@prontiq/shared";

/**
 * Clerk JWT middleware for `POST /v1/account/setup` and any future
 * Clerk-authenticated routes on the `PqAccount` Lambda.
 *
 * Auth contract per `docs/decisions/002-control-plane-package.md`
 * hardening contract #5 + ARCHITECTURE.MD §5.7.1:
 *
 *   - Single env var: `CLERK_SECRET_KEY` (the same Backend API key the
 *     webhook uses for `clerkClient.users.getUser(...)`). No JWKS / no
 *     issuer config — webhook-only.
 *   - `verifyToken({ secretKey })` makes a network call to Clerk per
 *     request (acceptable for an admin / low-QPS path). If this
 *     endpoint ever moves to a hot path, switch to
 *     `verifyToken({ jwtKey })` (offline JWKS) — separate ticket.
 *   - 5s `clockSkewInMs` matches Svix's tolerance and is forgiving of
 *     small NTP drift on Lambda cold-starts.
 *
 * Failure-mode contract:
 *
 *   - Missing / malformed Authorization header → 401 INVALID_TOKEN
 *   - `verifyToken` throws (expired, tampered, unknown) → 401 INVALID_TOKEN
 *   - Verified token without `org_id` claim → 400 NO_ACTIVE_ORG with a
 *     message that points operators at the Clerk dashboard fix (JWT
 *     template needs `{ "org_id": "{{org.id}}" }`) AND at the frontend
 *     prerequisite (must have called `setActive({ organization })`).
 *   - `CLERK_SECRET_KEY` env unset at request time → 500 INTERNAL_ERROR
 *     (mirrors the webhook's startup-guard pattern; loud failure for
 *     the platform alarm).
 *
 * Trade-off: because the middleware mounts on `app.use("/v1/account/*")`
 * BEFORE the route handlers, an unauthenticated request to a
 * non-existent path under `/v1/account/*` returns 401, not 404. This is
 * the right security posture for an admin surface — the operator can't
 * probe for routes without a valid token.
 *
 * The verifier is an injectable dependency (DI pattern matching
 * `createClerkHandler({ overrides })` in `@prontiq/webhooks` and
 * `createProvisioningService({ overrides })` in `@prontiq/control-plane`).
 * Tests inject a stub; production uses the real `verifyToken`.
 *
 * Admin-only authorization is enforced by the SEPARATE `clerkAdminOnly()`
 * middleware below. They compose: clerkJwt() runs first (sets the
 * principal), clerkAdminOnly() runs second (gates on org role).
 * `account-handler.ts` mounts BOTH on `/v1/account/*` so every route
 * under that prefix inherits admin-only by construction.
 */

export interface ClerkPrincipal {
  userId: string;
  orgId: string;
  /**
   * The user's role in the active org, extracted from the `org_role`
   * claim of the verified Clerk session token. Empty string when the
   * claim is missing — `clerkAdminOnly()` distinguishes
   * "claim missing" (operator config gap) from
   * "claim present but not admin" (caller authorisation failure).
   *
   * Operator must add `{ "org_role": "{{org.role}}" }` to the Clerk
   * dashboard JWT template alongside `org_id`. Required for any
   * downstream gate that uses this field.
   */
  orgRole: string;
}

export type ClerkVerifier = (token: string) => Promise<{
  sub?: unknown;
  org_id?: unknown;
  org_role?: unknown;
  [claim: string]: unknown;
}>;

const logger = createLogger("api-clerk-jwt");

declare module "hono" {
  interface ContextVariableMap {
    clerkPrincipal: ClerkPrincipal;
  }
}

interface ClerkJwtOptions {
  verifier?: ClerkVerifier;
}

const BEARER_PREFIX_RE = /^bearer\s+/i;
const CLOCK_SKEW_MS = 5_000;

function getDefaultVerifier(): ClerkVerifier {
  return async (token: string) => {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey || secretKey.length === 0) {
      throw new Error("CLERK_SECRET_KEY is required");
    }
    return verifyToken(token, { secretKey, clockSkewInMs: CLOCK_SKEW_MS });
  };
}

function errorEnvelope(
  c: Parameters<Parameters<typeof createMiddleware>[0]>[0],
  status: 400 | 401 | 500 | 503,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return c.json(
    {
      error: {
        code,
        message,
        status,
        request_id: c.get("requestId"),
        ...(details ? { details } : {}),
      },
    },
    status,
  );
}

/**
 * Verifier-error classifier (Bug 4 from PR #101 review #3).
 *
 * `verifyToken({ secretKey })` performs a network call to Clerk on
 * every request — see ARCH §5.7.1 + the doc-block on `clerkJwt()`
 * above. The previous catch block collapsed every exception into
 * `401 INVALID_TOKEN` (except for our local missing-secret sentinel),
 * which meant a Clerk transport failure / 5xx / rate-limit response
 * was misreported to the caller as "your token is bad" — wrong UX,
 * wrong remediation, AND the route's `5xx` CloudWatch alarm never
 * fired because we returned 401 instead of 5xx.
 *
 * This classifier routes failures by root cause using Clerk's typed
 * error taxonomy:
 *
 *   - `TokenVerificationError` with a token-fault reason
 *     (TokenExpired, TokenInvalid, TokenInvalidSignature, etc.)
 *     → caller fault → 401 INVALID_TOKEN
 *   - `TokenVerificationError` with a JWKS-fetch reason
 *     (RemoteJWKFailedToLoad, JWKFailedToResolve, etc.)
 *     → upstream outage → 503 VERIFIER_UNAVAILABLE
 *   - `TokenVerificationError` with a config-fault reason
 *     (InvalidSecretKey, LocalJWKMissing, JWKKidMismatch)
 *     → operator config bug → 500 INTERNAL_ERROR
 *   - `TokenVerificationError` with an unknown reason → conservatively
 *     `503 VERIFIER_UNAVAILABLE` so a future Clerk SDK upgrade adding
 *     a new reason doesn't silently re-introduce the misclassification
 *     bug. Operator alarm fires; we add specific handling once we see
 *     the reason in CloudWatch.
 *   - `ClerkAPIResponseError` with status 5xx or 429
 *     → upstream outage / rate limit → 503 VERIFIER_UNAVAILABLE
 *     (with retryAfter surfaced in details when Clerk supplies it)
 *   - `ClerkAPIResponseError` with status 4xx (other)
 *     → our request to Clerk's BAPI was malformed (e.g. bad
 *     CLERK_SECRET_KEY format) → 500 INTERNAL_ERROR
 *   - Raw `TypeError("fetch failed")` (transport layer leak — DNS /
 *     TCP / TLS failure not wrapped by Clerk SDK)
 *     → 503 VERIFIER_UNAVAILABLE
 *   - The local `CLERK_SECRET_KEY is required` sentinel (our missing-
 *     env startup guard) → 500 INTERNAL_ERROR (preserved from prior
 *     behaviour; pinned by regression test)
 *   - Any other unknown error → 500 INTERNAL_ERROR (conservative
 *     default — we don't know whether the caller can usefully retry,
 *     so surface as our problem and let the alarm + logs drive
 *     diagnosis)
 */

const TOKEN_FAULT_REASONS = new Set<string>([
  TokenVerificationErrorReason.TokenExpired,
  TokenVerificationErrorReason.TokenInvalid,
  TokenVerificationErrorReason.TokenInvalidAlgorithm,
  TokenVerificationErrorReason.TokenInvalidAuthorizedParties,
  TokenVerificationErrorReason.TokenInvalidSignature,
  TokenVerificationErrorReason.TokenNotActiveYet,
  TokenVerificationErrorReason.TokenIatInTheFuture,
  TokenVerificationErrorReason.TokenVerificationFailed,
]);

const VERIFIER_OUTAGE_REASONS = new Set<string>([
  TokenVerificationErrorReason.RemoteJWKFailedToLoad,
  TokenVerificationErrorReason.RemoteJWKInvalid,
  TokenVerificationErrorReason.RemoteJWKMissing,
  TokenVerificationErrorReason.JWKFailedToResolve,
]);

const CONFIG_FAULT_REASONS = new Set<string>([
  TokenVerificationErrorReason.InvalidSecretKey,
  TokenVerificationErrorReason.LocalJWKMissing,
  TokenVerificationErrorReason.JWKKidMismatch,
]);

export type VerifierFailure =
  | { kind: "invalid_token"; reason: string }
  | { kind: "verifier_unavailable"; reason: string; retryAfter?: number }
  | { kind: "internal_error"; reason: string };

export function classifyVerifierError(error: unknown): VerifierFailure {
  // Local startup-guard sentinel — preserved from prior behaviour so
  // the existing "CLERK_SECRET_KEY unset → 500 internal_error"
  // regression test continues to pin this path.
  if (error instanceof Error && error.message === "CLERK_SECRET_KEY is required") {
    return { kind: "internal_error", reason: "missing_secret_key" };
  }

  if (error instanceof TokenVerificationError) {
    if (TOKEN_FAULT_REASONS.has(error.reason)) {
      return { kind: "invalid_token", reason: error.reason };
    }
    if (VERIFIER_OUTAGE_REASONS.has(error.reason)) {
      return { kind: "verifier_unavailable", reason: error.reason };
    }
    if (CONFIG_FAULT_REASONS.has(error.reason)) {
      return { kind: "internal_error", reason: error.reason };
    }
    // Unknown reason — conservative default to outage so the alarm
    // observes it. See doc-block above for the rationale.
    return { kind: "verifier_unavailable", reason: error.reason };
  }

  if (isClerkAPIResponseError(error)) {
    if (error.status >= 500 || error.status === 429) {
      return {
        kind: "verifier_unavailable",
        reason: `clerk_api_${error.status}`,
        ...(typeof error.retryAfter === "number" ? { retryAfter: error.retryAfter } : {}),
      };
    }
    return { kind: "internal_error", reason: `clerk_api_${error.status}` };
  }

  // Node's undici/fetch wraps DNS / TCP / TLS failures as
  // `TypeError: fetch failed` with `.cause` set. The Clerk SDK
  // doesn't always wrap these into TokenVerificationError, so we
  // detect them here.
  if (
    error instanceof TypeError &&
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("fetch failed")
  ) {
    return { kind: "verifier_unavailable", reason: "network_error" };
  }

  return {
    kind: "internal_error",
    reason: error instanceof Error ? `unknown_error:${error.name}` : "unknown_error",
  };
}

export function clerkJwt(options: ClerkJwtOptions = {}) {
  const verifier = options.verifier ?? getDefaultVerifier();

  return createMiddleware(async (c, next) => {
    const rawHeader = c.req.header("Authorization") ?? c.req.header("authorization");
    if (!rawHeader || rawHeader.length === 0) {
      return errorEnvelope(c, 401, "INVALID_TOKEN", "Missing Authorization header");
    }
    if (!BEARER_PREFIX_RE.test(rawHeader)) {
      return errorEnvelope(c, 401, "INVALID_TOKEN", "Authorization header must use Bearer scheme");
    }
    const token = rawHeader.replace(BEARER_PREFIX_RE, "").trim();
    if (token.length === 0) {
      return errorEnvelope(c, 401, "INVALID_TOKEN", "Bearer token is empty");
    }

    let payload: Awaited<ReturnType<ClerkVerifier>>;
    try {
      payload = await verifier(token);
    } catch (error) {
      const failure = classifyVerifierError(error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      switch (failure.kind) {
        case "invalid_token":
          // Caller fault (expired / tampered / bad signature). Log at
          // warn (not error) since these are caller-driven and
          // shouldn't trip the operator alarm.
          logger.warn("Clerk JWT verification failed (caller fault)", {
            request_id: c.get("requestId"),
            reason: failure.reason,
            error: errorMessage,
          });
          return errorEnvelope(c, 401, "INVALID_TOKEN", "Invalid or expired token", {
            reason: failure.reason,
          });
        case "verifier_unavailable":
          // Upstream Clerk outage / network failure / rate limit.
          // Distinct 503 so:
          //   1. the dashboard can retry with the right UX (not "your
          //      token is bad", but "we're having trouble — try again")
          //   2. the route's PqAccountErrors / PqClerkWebhookErrors
          //      5xx CloudWatch alarm OBSERVES the outage (which it
          //      didn't when we returned 401)
          logger.error("Clerk verifier unavailable (transient outage)", {
            request_id: c.get("requestId"),
            reason: failure.reason,
            ...(failure.retryAfter !== undefined ? { retryAfter: failure.retryAfter } : {}),
            error: errorMessage,
          });
          return errorEnvelope(
            c,
            503,
            "VERIFIER_UNAVAILABLE",
            "Authentication service is temporarily unavailable. Please retry.",
            {
              reason: failure.reason,
              ...(failure.retryAfter !== undefined ? { retryAfter: failure.retryAfter } : {}),
            },
          );
        case "internal_error":
          // Operator-config bug (missing secret, malformed key,
          // unknown error). Loud failure for the platform alarm.
          logger.error("Clerk JWT verification failed (server fault)", {
            request_id: c.get("requestId"),
            reason: failure.reason,
            error: errorMessage,
          });
          return errorEnvelope(c, 500, "INTERNAL_ERROR", "Internal server error", {
            reason: failure.reason,
          });
      }
    }

    const userId = typeof payload.sub === "string" ? payload.sub : undefined;
    if (!userId || userId.length === 0) {
      logger.warn("Clerk JWT verified but `sub` claim is missing/empty", {
        request_id: c.get("requestId"),
      });
      return errorEnvelope(c, 401, "INVALID_TOKEN", "Token missing sub claim");
    }
    const orgId = typeof payload.org_id === "string" ? payload.org_id : undefined;
    if (!orgId || orgId.length === 0) {
      // Operator-helpful 400: the token IS valid, but the user isn't
      // operating under an active org. Two preconditions can cause
      // this (documented in the runbook + private account API docs):
      //   1. Clerk dashboard JWT template missing
      //      `{ "org_id": "{{org.id}}" }` in BOTH dev and prod tenants.
      //   2. Frontend hasn't called `setActive({ organization })`
      //      before invoking `/v1/account/setup`.
      // Return 400 (not 401) so operators can distinguish "auth
      // broken" from "auth fine, org context missing".
      return errorEnvelope(
        c,
        400,
        "NO_ACTIVE_ORG",
        'JWT does not include an org_id claim. Ensure the Clerk session token JWT template includes { "org_id": "{{org.id}}" } and the frontend has called setActive({ organization }) before invoking this endpoint.',
      );
    }

    // org_role is OPTIONAL at this layer — clerkJwt() sets it on the
    // principal as the empty string when the claim is missing. The
    // downstream clerkAdminOnly() middleware (or a per-route check)
    // decides whether the absence of the claim is a problem. Routes
    // that don't need role info (a hypothetical "show my membership"
    // status endpoint) can mount clerkJwt() alone without the gate.
    const orgRole = typeof payload.org_role === "string" ? payload.org_role : "";

    c.set("clerkPrincipal", { userId, orgId, orgRole });
    await next();
  });
}

/**
 * Admin-only gate for `/v1/account/*` routes. Compose AFTER
 * `clerkJwt()` so the principal is populated:
 *
 *   app.use("/v1/account/*", clerkJwt());
 *   app.use("/v1/account/*", clerkAdminOnly());
 *
 * Why a SEPARATE middleware rather than checking inline in each route
 * handler:
 *
 *   - **Default-secure-by-construction**: every `/v1/account/*` route
 *     inherits the gate. A future route added under that prefix can't
 *     accidentally skip the check by forgetting to call a helper.
 *   - **Mirrors the webhook's role gate** at the same layer of the
 *     ingress chain (the webhook checks role BEFORE calling
 *     `provisionOrg`; we check role BEFORE invoking the handler).
 *   - **Single source of truth for admin roles**: uses `getAdminRoles()`
 *     from `@prontiq/control-plane`, the same function the webhook
 *     uses. A `CLERK_ADMIN_ROLES` env override applied to BOTH Lambdas
 *     produces uniform role policy across both ingress paths.
 *
 * Failure-mode contract:
 *
 *   - Missing `org_role` claim → 400 NO_ROLE_CLAIM with a message
 *     pointing operators at the Clerk dashboard JWT template (parallel
 *     to NO_ACTIVE_ORG). Distinguished from 403 because the remediation
 *     is operator-side (add to template), not caller-side (escalate).
 *   - `org_role` present but not in `getAdminRoles()` → 403
 *     INSUFFICIENT_ROLE with the role surfaced in `details.role` so
 *     the dashboard can show "ask your admin" UX.
 *
 * Bot-review fix (PR #101 → Bug 1): without this gate, any verified
 * org member (e.g. an invited `org:member`) could race a delayed
 * Clerk webhook and become the recorded `ownerEmail` / Lago
 * customer / welcome-email recipient for the org. The webhook's
 * existing `role ∈ {org:admin, admin}` check is the contract; this
 * middleware extends it to the recovery endpoint.
 *
 * The role-set resolver is an injectable dependency for testing —
 * tests can pin a deterministic set without manipulating env vars.
 */
export interface ClerkAdminOnlyOptions {
  rolesProvider?: () => ReadonlySet<string>;
}

export function clerkAdminOnly(options: ClerkAdminOnlyOptions = {}) {
  const rolesProvider = options.rolesProvider ?? getAdminRoles;

  return createMiddleware(async (c, next) => {
    const principal = c.get("clerkPrincipal");
    if (!principal) {
      // clerkAdminOnly() was mounted without clerkJwt() upstream, OR
      // mounted before it. Either way, the route is misconfigured —
      // fail loud so the platform alarm fires rather than silently
      // letting the request through.
      logger.error("clerkAdminOnly mounted without upstream clerkJwt — principal missing", {
        request_id: c.get("requestId"),
        path: c.req.path,
      });
      return errorEnvelope(c, 500, "INTERNAL_ERROR", "Internal server error");
    }

    if (!principal.orgRole || principal.orgRole.length === 0) {
      return errorEnvelope(
        c,
        400,
        "NO_ROLE_CLAIM",
        'JWT does not include an org_role claim. Ensure the Clerk session token JWT template includes { "org_role": "{{org.role}}" }.',
      );
    }

    const adminRoles = rolesProvider();
    if (!adminRoles.has(principal.orgRole)) {
      logger.warn("clerkAdminOnly: rejecting non-admin caller", {
        request_id: c.get("requestId"),
        userId: principal.userId,
        orgId: principal.orgId,
        role: principal.orgRole,
      });
      return c.json(
        {
          error: {
            code: "INSUFFICIENT_ROLE",
            message:
              "This action requires an org admin role. Ask your org admin to perform this action.",
            status: 403,
            request_id: c.get("requestId"),
            details: { role: principal.orgRole },
          },
        },
        403,
      );
    }

    await next();
  });
}
