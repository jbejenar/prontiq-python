/**
 * Shared Clerk session/JWT helpers for smoke scripts.
 *
 * Lifted verbatim from `smoke-account-setup.ts` so multiple smoke
 * scripts can share the session-resolution + JWT-mint flow without
 * drift. The smoke-account-setup script will be migrated to use this
 * helper in a follow-up; for now the duplication is intentional to
 * keep PR-1 smoke validation low-risk.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClerkClient } from "@clerk/backend";
import type { Session } from "@clerk/backend";

export const DEFAULT_SMOKE_TIMEOUT_MS = 15_000;

export class SessionResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionResolutionError";
  }
}

export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

export function getOptionalEnvOrNull(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

export function resolveApiBaseUrl(): string {
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
    // Fall through.
  }
  throw new Error(
    "PRONTIQ_API is required when .sst/outputs.json is unavailable or missing the api output.",
  );
}

export function getTimeoutMs(): number {
  const raw = process.env.SMOKE_TIMEOUT_MS;
  if (!raw) return DEFAULT_SMOKE_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`SMOKE_TIMEOUT_MS must be a positive integer; got "${raw}"`);
  }
  return parsed;
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}

interface ResolvedSmokeUser {
  source: "email" | "user_id";
  userId: string;
}

interface ResolvedSession {
  session: Session;
  origin: "pinned_by_session_id" | "matched_target_org" | "single_active" | "created_fresh";
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
    clerk.users.getUserList({ emailAddress: [identifier], limit: 2 }),
    timeoutMs,
    `clerk.users.getUserList(${identifier})`,
  );
  if (list.data.length === 1) {
    const user = list.data[0];
    if (!user) throw new SessionResolutionError("Internal: Clerk returned undefined user.");
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
    (s) =>
      typeof s.lastActiveOrganizationId === "string" && s.lastActiveOrganizationId.length > 0,
  );

  if (targetOrgId) {
    const matching = withOrg.filter((s) => s.lastActiveOrganizationId === targetOrgId);
    if (matching.length === 1) {
      const session = matching[0];
      if (!session) throw new SessionResolutionError("Internal: filter returned undefined element");
      return { session, origin: "matched_target_org" };
    }
    if (matching.length > 1) {
      const candidates = matching
        .map((s) => `  - ${s.id} (lastActiveAt=${s.lastActiveAt ?? "null"})`)
        .join("\n");
      throw new SessionResolutionError(
        `${matching.length} active sessions match CLERK_TEST_ORG_ID=${targetOrgId}. Pin one via CLERK_TEST_SESSION_ID:\n${candidates}`,
      );
    }
    return await tryCreateSession(clerk, userId, targetOrgId, timeoutMs);
  }

  if (withOrg.length === 1) {
    const session = withOrg[0];
    if (!session) throw new SessionResolutionError("Internal: filter returned undefined element");
    return { session, origin: "single_active" };
  }
  if (withOrg.length > 1) {
    const candidates = withOrg
      .map(
        (s) =>
          `  - ${s.id} → org=${s.lastActiveOrganizationId} (lastActiveAt=${s.lastActiveAt ?? "null"})`,
      )
      .join("\n");
    throw new SessionResolutionError(
      `User has ${withOrg.length} active sessions across multiple orgs. Set CLERK_TEST_ORG_ID to disambiguate:\n${candidates}`,
    );
  }
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
        "Use Clerk Dashboard → Impersonate user to create a session, then re-run.",
    );
  }
  if (targetOrgId && created.lastActiveOrganizationId !== targetOrgId) {
    throw new SessionResolutionError(
      `Created a fresh session ${created.id} but lastActiveOrganizationId=${created.lastActiveOrganizationId ?? "null"} doesn't match CLERK_TEST_ORG_ID=${targetOrgId}. Use the impersonation flow.`,
    );
  }
  if (!created.lastActiveOrganizationId) {
    throw new SessionResolutionError(
      `Created a fresh session ${created.id} but it has no active org. Use the impersonation flow.`,
    );
  }
  return { session: created, origin: "created_fresh" };
}

export interface MintClerkJwtOpts {
  secretKey: string;
  userIdentifier: string;
  targetOrgId?: string | null;
  pinnedSessionId?: string | null;
  timeoutMs: number;
}

export interface MintedClerkJwt {
  jwt: string;
  sessionId: string;
  orgId: string;
  userId: string;
  origin: ResolvedSession["origin"];
  resolvedFromSource: ResolvedSmokeUser["source"];
}

/**
 * Resolves a target Clerk user → session → JWT in one call.
 * Throws `SessionResolutionError` (operator-actionable) on session
 * resolution problems; bubbles other errors as-is.
 */
export async function mintClerkJwt(opts: MintClerkJwtOpts): Promise<MintedClerkJwt> {
  const clerk = createClerkClient({ secretKey: opts.secretKey });
  const user = await resolveSmokeUser(clerk, opts.userIdentifier, opts.timeoutMs);
  const resolved = await resolveSession(
    clerk,
    user.userId,
    opts.targetOrgId ?? null,
    opts.pinnedSessionId ?? null,
    opts.timeoutMs,
  );
  const orgId = resolved.session.lastActiveOrganizationId;
  if (!orgId) {
    throw new SessionResolutionError(
      `Resolved session ${resolved.session.id} has no lastActiveOrganizationId — cannot mint JWT with org context.`,
    );
  }
  const token = await withTimeout(
    clerk.sessions.getToken(resolved.session.id),
    opts.timeoutMs,
    `clerk.sessions.getToken(${resolved.session.id})`,
  );
  if (!token.jwt || token.jwt.length === 0) {
    throw new Error("Clerk getToken returned empty jwt — check tenant template config.");
  }
  return {
    jwt: token.jwt,
    sessionId: resolved.session.id,
    orgId,
    userId: user.userId,
    origin: resolved.origin,
    resolvedFromSource: user.source,
  };
}
