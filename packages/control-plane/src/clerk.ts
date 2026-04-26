import type { ClerkClient } from "@clerk/backend";
import { createLogger } from "@prontiq/shared";

/**
 * Resolves the verified primary email for a Clerk user via the
 * Backend API. Mirrors the discriminated-union pattern used by
 * `readOrgEnvelope` in `./provisioning.ts`: the compiler forces every
 * caller to handle every outcome, and we never let a raw Clerk SDK
 * exception escape into the handler's main flow.
 *
 *   found             → verified primary email available, safe to
 *                       provision (verification.status === "verified")
 *   not_found         → user lookup succeeded but no primaryEmailAddress
 *                       (phone-first / OAuth-only signup, or operator
 *                       deleted the email post-signup)
 *   not_verified      → primary email exists but verification has not
 *                       completed (status: unverified | failed |
 *                       expired | transferable | null)
 *   transient_failure → Clerk API blip / network / 5xx — retryable;
 *                       caller decides whether to surface as 503
 *                       (sync API path) or rely on Svix redelivery
 *                       (webhook path)
 *
 * Policy: do NOT fall back to a non-primary verified email if the
 * primary itself isn't verified. The primary is the user's explicit
 * identity choice; falling back would make Lago customer email
 * unpredictable from the operator's perspective ("which one did we
 * send the receipt to?"). Operator-facing fix is "verify your primary
 * email" or "set a verified email as primary in the Clerk dashboard".
 *
 * Both consumers — the Clerk webhook handler in @prontiq/webhooks and
 * the (P1B.05 PR 3/3) `/v1/account/setup` recovery endpoint in
 * @prontiq/api — call this helper to enforce the same email
 * resolution policy at one place. Per ADR-002 hardening contract #2
 * principle (single source of truth at the package boundary).
 */

export type EmailLookupResult =
  | { kind: "found"; email: string }
  | { kind: "not_found" }
  | { kind: "not_verified"; verificationStatus: string | null }
  | { kind: "transient_failure"; error: Error };

export async function resolvePrimaryEmail(
  client: ClerkClient,
  userId: string,
): Promise<EmailLookupResult> {
  try {
    const user = await client.users.getUser(userId);
    if (!user.primaryEmailAddressId) {
      return { kind: "not_found" };
    }
    const primary = user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId);
    if (!primary?.emailAddress || primary.emailAddress.length === 0) {
      return { kind: "not_found" };
    }
    // Verification check (Bug 4 from PR #95 review). Per Clerk docs,
    // Verification.status is one of: unverified | verified |
    // transferable | failed | expired. Only "verified" is safe to
    // forward to Lago + SES. A null verification object is treated
    // as not-verified (defensive).
    const status = primary.verification?.status ?? null;
    if (status !== "verified") {
      return { kind: "not_verified", verificationStatus: status };
    }
    return { kind: "found", email: primary.emailAddress };
  } catch (raw) {
    const error = raw instanceof Error ? raw : new Error(String(raw));
    return { kind: "transient_failure", error };
  }
}

/**
 * Org-admin role gate. Both ingress paths to `provisionOrg` (Clerk
 * webhook on `organizationMembership.created`, and the JWT-authenticated
 * `POST /v1/account/setup` recovery endpoint) MUST gate on this so a
 * non-admin org member can't hijack ownership of the org's envelope by
 * racing the webhook.
 *
 * Clerk's canonical org-creator role identifier as of v3 of the Backend
 * API is `org:admin`. The bare `admin` token covers (a) pre-namespace
 * clients still in the wild, (b) custom role sets that re-use the
 * `admin` slug, and (c) historical integration test fixtures. Operators
 * can override via the `CLERK_ADMIN_ROLES` env var (comma-separated)
 * without redeploying code — the env var must be set on BOTH the
 * webhook Lambda AND the account-setup Lambda for the override to apply
 * uniformly across both ingress paths.
 *
 * Returns the parsed role set with safe-fallback semantics: a
 * whitespace-only / commas-only override (operator typo) parses to an
 * empty set, which would silently classify every caller as non-admin
 * and skip every provisioning event. Falling back to defaults instead
 * + logging the typo to CloudWatch is the safer behaviour.
 */
export const DEFAULT_ADMIN_ROLES = ["org:admin", "admin"] as const;
const logger = createLogger("control-plane-clerk");

export function getAdminRoles(): Set<string> {
  const override = process.env.CLERK_ADMIN_ROLES;
  if (typeof override !== "string" || override.length === 0) {
    return new Set(DEFAULT_ADMIN_ROLES);
  }
  const parsed = new Set(
    override
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  if (parsed.size === 0) {
    logger.warn(
      "CLERK_ADMIN_ROLES is set but contains no valid role tokens after parsing — falling back to defaults",
      { rawValue: override, defaultRoles: [...DEFAULT_ADMIN_ROLES] },
    );
    return new Set(DEFAULT_ADMIN_ROLES);
  }
  return parsed;
}

// Re-export ClerkClient type so callers can `import { type ClerkClient } from "@prontiq/control-plane"`
// without adding @clerk/backend to their own deps just for the type.
export type { ClerkClient };
