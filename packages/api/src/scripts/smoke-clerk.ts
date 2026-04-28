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
  origin:
    | "pinned_by_session_id"
    | "matched_target_org"
    | "single_active"
    | "freshest_in_org"
    | "created_fresh";
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

  const allActive = await listAllActiveSessions(clerk, userId, timeoutMs);
  const withOrg = allActive.filter(
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
      // Multiple sessions in the SAME org is not real ambiguity — it
      // accumulates from prior smoke runs that called tryCreateSession
      // and never revoked. Auto-pick the freshest by lastActiveAt;
      // operator can still override via CLERK_TEST_SESSION_ID.
      return { session: pickFreshestSession(matching), origin: "freshest_in_org" };
    }
    return await tryCreateSession(clerk, userId, targetOrgId, timeoutMs);
  }

  if (withOrg.length === 1) {
    const session = withOrg[0];
    if (!session) throw new SessionResolutionError("Internal: filter returned undefined element");
    return { session, origin: "single_active" };
  }
  if (withOrg.length > 1) {
    const distinctOrgs = new Set(withOrg.map((s) => s.lastActiveOrganizationId));
    if (distinctOrgs.size === 1) {
      // All sessions in the same org — same-org accumulation, not real
      // ambiguity. Pick freshest.
      return { session: pickFreshestSession(withOrg), origin: "freshest_in_org" };
    }
    const candidates = withOrg
      .map(
        (s) =>
          `  - ${s.id} → org=${s.lastActiveOrganizationId} (lastActiveAt=${s.lastActiveAt ?? "null"})`,
      )
      .join("\n");
    throw new SessionResolutionError(
      `User has ${withOrg.length} active sessions across ${distinctOrgs.size} distinct orgs. Set CLERK_TEST_ORG_ID to disambiguate:\n${candidates}`,
    );
  }
  return await tryCreateSession(clerk, userId, null, timeoutMs);
}

// Fully paginate clerk.sessions.getSessionList. The SDK defaults to a
// page size of 10; without explicit pagination, a user with >10 active
// sessions can have an entire org's worth of sessions invisible to
// the resolver — making same-org auto-disambiguation pick the wrong
// JWT silently. Loops until totalCount is reached, with an upper
// bound to fail loud rather than spin forever on a malformed response
// or a wildly compromised account.
async function listAllActiveSessions(
  clerk: ReturnType<typeof createClerkClient>,
  userId: string,
  timeoutMs: number,
): Promise<Session[]> {
  const PAGE_SIZE = 100;
  const HARD_CAP = 10_000;
  const all: Session[] = [];
  let offset = 0;
  while (true) {
    const page = await withTimeout(
      clerk.sessions.getSessionList({
        userId,
        status: "active",
        limit: PAGE_SIZE,
        offset,
      }),
      timeoutMs,
      `clerk.sessions.getSessionList(offset=${offset})`,
    );
    all.push(...page.data);
    if (page.data.length < PAGE_SIZE) break;
    if (all.length >= page.totalCount) break;
    if (all.length >= HARD_CAP) {
      throw new SessionResolutionError(
        `Active session count for user ${userId} exceeded ${HARD_CAP}. Either a Clerk pagination bug or a compromised account — investigate before re-running smoke.`,
      );
    }
    offset += page.data.length;
  }
  return all;
}

// Returns the session with the highest lastActiveAt. Tie-break: the
// id that sorts first lexicographically (deterministic). Sessions with
// null/undefined lastActiveAt are treated as 0.
function pickFreshestSession(sessions: Session[]): Session {
  if (sessions.length === 0) {
    throw new SessionResolutionError("Internal: pickFreshestSession called with empty list");
  }
  const sorted = [...sessions].sort((a, b) => {
    const aAt = typeof a.lastActiveAt === "number" ? a.lastActiveAt : 0;
    const bAt = typeof b.lastActiveAt === "number" ? b.lastActiveAt : 0;
    if (aAt !== bAt) return bAt - aAt;
    return a.id.localeCompare(b.id);
  });
  const first = sorted[0];
  if (!first) throw new SessionResolutionError("Internal: sort produced empty list");
  return first;
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
