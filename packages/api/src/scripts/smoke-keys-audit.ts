#!/usr/bin/env node
/**
 * Smoke test for the P1C.03 PR 5 audit read path:
 *   - GET /v1/account/audit (member-allowed)
 *
 * This is read-only. It asserts the private account API can mint a Clerk JWT,
 * reach the target stage, and read recent audit rows without exposing raw keys.
 */
import {
  SessionResolutionError,
  getOptionalEnvOrNull,
  getRequiredEnv,
  getTimeoutMs,
  mintClerkJwt,
  resolveApiBaseUrl,
} from "./smoke-clerk.js";

interface AuditEvent {
  action: string;
  actorId: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

class SmokeAssertionError extends Error {}

async function authedFetch(
  apiUrl: string,
  jwt: string,
  timeoutMs: number,
): Promise<{ status: number; body: unknown; requestId: string | null; durationMs: number }> {
  const start = Date.now();
  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/account/audit`, {
    headers: { Authorization: `Bearer ${jwt}` },
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

function assertAuditShape(value: unknown): asserts value is { events: AuditEvent[] } {
  if (!value || typeof value !== "object" || !("events" in value)) {
    throw new SmokeAssertionError(`audit response missing "events": ${JSON.stringify(value)}`);
  }
  const events = (value as { events: unknown }).events;
  if (!Array.isArray(events)) {
    throw new SmokeAssertionError("audit response events is not an array");
  }
  for (const event of events) {
    if (!event || typeof event !== "object") {
      throw new SmokeAssertionError(`audit event is not an object: ${JSON.stringify(event)}`);
    }
    const e = event as Record<string, unknown>;
    for (const required of ["action", "actorId", "timestamp"] as const) {
      if (typeof e[required] !== "string") {
        throw new SmokeAssertionError(
          `audit event missing string ${required}: ${JSON.stringify(e)}`,
        );
      }
    }
    if (!["CREATE", "ROTATE", "REVOKE"].includes(e.action as string)) {
      throw new SmokeAssertionError(`audit event returned non-key action: ${String(e.action)}`);
    }
    if ("raw" in e) {
      throw new SmokeAssertionError("audit event leaked raw API key field");
    }
    if ("apiKeyHash" in e) {
      throw new SmokeAssertionError("audit event leaked server-side apiKeyHash field");
    }
    const serialized = JSON.stringify(e);
    if (serialized.includes("apiKeyHash") || serialized.includes("oldApiKeyHash")) {
      throw new SmokeAssertionError("audit event leaked server-side hash metadata");
    }
  }
}

export async function run(): Promise<number> {
  const secretKey = getRequiredEnv("CLERK_SECRET_KEY");
  const userIdentifier = getRequiredEnv("CLERK_TEST_USER_ID");
  const targetOrgId = getOptionalEnvOrNull("CLERK_TEST_ORG_ID");
  const pinnedSessionId = getOptionalEnvOrNull("CLERK_TEST_SESSION_ID");
  const apiUrl = resolveApiBaseUrl();
  const timeoutMs = getTimeoutMs();

  console.log("=== Keys audit smoke ===");
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
  console.log("[2] GET /v1/account/audit");

  let response;
  try {
    response = await authedFetch(apiUrl, minted.jwt, timeoutMs);
  } catch (error) {
    console.error(
      `      transport error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
  console.log(
    `      HTTP ${response.status} in ${response.durationMs}ms${response.requestId ? ` request_id=${response.requestId}` : ""}`,
  );
  if (response.status !== 200) {
    console.error(`      audit returned non-200:\n${JSON.stringify(response.body, null, 2)}`);
    return 1;
  }

  try {
    assertAuditShape(response.body);
  } catch (error) {
    console.error(`      ${(error as Error).message}`);
    return 1;
  }

  const events = response.body.events;
  console.log(`      events=${events.length}`);
  const hasLifecycleEvent = events.some((event) =>
    ["CREATE", "ROTATE", "REVOKE"].includes(event.action),
  );
  if (!hasLifecycleEvent) {
    console.warn(
      "      no key lifecycle event found in recent audit tail; shape/read path still passed",
    );
  }
  console.log("      OK");
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
