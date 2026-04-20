import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

import { createLogger } from "@prontiq/shared";

const logger = createLogger("landing-demo-proxy");

export const DEMO_QUERY_MIN_LENGTH = 3;
export const DEMO_SUGGESTION_LIMIT_DEFAULT = 5;
export const DEMO_SUGGESTION_LIMIT_MAX = 6;
export const DEMO_RATE_LIMIT_CAPACITY = 12;
export const DEMO_RATE_LIMIT_REFILL_PER_SECOND = 4;
export const DEMO_SESSION_COOKIE_NAME = "prontiq_demo_session";
export const DEMO_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 30;
export const DEMO_SHARED_GUARD_KEY = "bucket:shared-instance";
export const DEMO_SHARED_GUARD_CAPACITY = 60;
export const DEMO_SHARED_GUARD_REFILL_PER_SECOND = 20;
export const DEMO_BUCKET_TTL_MS = DEMO_SESSION_COOKIE_MAX_AGE_SECONDS * 1000;
export const DEMO_BUCKET_CLEANUP_INTERVAL = 64;

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TokenBucket = {
  lastSeenAtMs: number;
  lastRefillAtMs: number;
  tokens: number;
};

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

type CombinedRateLimitResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      rejectedKey: string;
      retryAfterSeconds: number;
    };

export type SanitizedDemoQuery = {
  limit: number;
  q: string;
  state?: string;
};

export type DemoClientIdentity = {
  clientKey: string;
  sessionId: string;
  setCookieHeader?: string;
  trustedIp?: string;
};

type ClientIdentifierOptions = {
  trustProxyHeaders?: boolean;
};

const rateLimitBuckets = new Map<string, TokenBucket>();
let rateLimitOperationCount = 0;

type BucketEvaluation = {
  allowed: boolean;
  bucket: TokenBucket;
  hadExistingBucket: boolean;
  retryAfterSeconds?: number;
};

function errorBody(code: string, message: string, status: number) {
  return {
    error: {
      code,
      message,
      status,
    },
  };
}

function parseCookies(headers: Headers): Map<string, string> {
  const cookieHeader = headers.get("cookie");
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const entry of cookieHeader.split(";")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key.length === 0 || value.length === 0) {
      continue;
    }

    cookies.set(key, decodeURIComponent(value));
  }

  return cookies;
}

function buildDemoSessionCookie(sessionId: string, requestUrl?: string): string {
  const secure = requestUrl ? new URL(requestUrl).protocol === "https:" : process.env.NODE_ENV === "production";
  const parts = [
    `${DEMO_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "HttpOnly",
    "Path=/api/demo/address",
    "SameSite=Lax",
    `Max-Age=${DEMO_SESSION_COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function firstTrustedIpCandidate(...candidates: Array<string | null | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const normalized = candidate.trim().replaceAll('"', "");
    if (isIP(normalized)) {
      return normalized;
    }
  }

  return undefined;
}

function parseForwardedHeader(forwarded: string | null): string | undefined {
  if (!forwarded) {
    return undefined;
  }

  for (const part of forwarded.split(",")) {
    const match = /(?:^|;)\s*for=(?<value>[^;]+)/i.exec(part);
    const candidate = match?.groups?.value?.trim();
    if (!candidate) {
      continue;
    }

    const normalized = candidate.startsWith("[") && candidate.endsWith("]")
      ? candidate.slice(1, -1)
      : candidate;
    const parsed = firstTrustedIpCandidate(normalized);
    if (parsed) {
      return parsed;
    }
  }

  return undefined;
}

export function getTrustedDemoClientIp(
  headers: Headers,
  { trustProxyHeaders = false }: ClientIdentifierOptions = {},
): string | undefined {
  if (!trustProxyHeaders) {
    return undefined;
  }

  const forwardedFor = headers.get("x-forwarded-for");
  const firstForwardedFor = forwardedFor?.split(",")[0];
  return firstTrustedIpCandidate(
    firstForwardedFor,
    headers.get("x-real-ip"),
    parseForwardedHeader(headers.get("forwarded")),
  );
}

export function getClientIdentifier(
  headers: Headers,
  requestUrl?: string,
  options: ClientIdentifierOptions = {},
): DemoClientIdentity {
  const trustedIp = getTrustedDemoClientIp(headers, options);
  if (trustedIp) {
    const sessionId = parseCookies(headers).get(DEMO_SESSION_COOKIE_NAME);
    if (sessionId && SESSION_ID_PATTERN.test(sessionId)) {
      return {
        clientKey: `ip:${trustedIp}`,
        sessionId,
        trustedIp,
      };
    }

    const newSessionId = randomUUID();
    return {
      clientKey: `ip:${trustedIp}`,
      sessionId: newSessionId,
      setCookieHeader: buildDemoSessionCookie(newSessionId, requestUrl),
      trustedIp,
    };
  }

  const sessionId = parseCookies(headers).get(DEMO_SESSION_COOKIE_NAME);
  if (sessionId && SESSION_ID_PATTERN.test(sessionId)) {
    return {
      clientKey: `session:${sessionId}`,
      sessionId,
    };
  }

  const newSessionId = randomUUID();
  return {
    clientKey: `session:${newSessionId}`,
    sessionId: newSessionId,
    setCookieHeader: buildDemoSessionCookie(newSessionId, requestUrl),
  };
}

export function applyDemoSessionCookie(response: Response, setCookieHeader?: string): Response {
  if (!setCookieHeader) {
    return response;
  }

  response.headers.append("Set-Cookie", setCookieHeader);
  return response;
}

export function shouldTrustDemoProxyHeaders(): boolean {
  return process.env.VERCEL === "1" || typeof process.env.VERCEL_ENV === "string";
}

export function sanitizeDemoQuery(searchParams: URLSearchParams): SanitizedDemoQuery {
  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length < DEMO_QUERY_MIN_LENGTH) {
    throw new Response(
      JSON.stringify(
        errorBody(
          "INVALID_QUERY",
          `Query must be at least ${DEMO_QUERY_MIN_LENGTH} characters long.`,
          400,
        ),
      ),
      {
        headers: { "content-type": "application/json" },
        status: 400,
      },
    );
  }

  const rawState = searchParams.get("state")?.trim().toUpperCase();
  const state = rawState && rawState.length > 0 ? rawState : undefined;
  const rawLimit = searchParams.get("limit");
  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : DEMO_SUGGESTION_LIMIT_DEFAULT;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, DEMO_SUGGESTION_LIMIT_MAX)
      : DEMO_SUGGESTION_LIMIT_DEFAULT;

  return { limit, q, state };
}

export function buildDemoUpstreamUrl(baseUrl: string, query: SanitizedDemoQuery): URL {
  const url = new URL("/v1/address/autocomplete", baseUrl);
  url.searchParams.set("q", query.q);
  url.searchParams.set("limit", String(query.limit));
  if (query.state) {
    url.searchParams.set("state", query.state);
  }
  return url;
}

function evaluateBucket(
  key: string,
  nowMs: number = Date.now(),
  rateLimitCapacity: number = DEMO_RATE_LIMIT_CAPACITY,
  refillPerSecond: number = DEMO_RATE_LIMIT_REFILL_PER_SECOND,
): BucketEvaluation {
  const existing = rateLimitBuckets.get(key);
  const current = existing ?? {
    lastSeenAtMs: nowMs,
    lastRefillAtMs: nowMs,
    tokens: rateLimitCapacity,
  };

  const elapsedSeconds = Math.max(0, (nowMs - current.lastRefillAtMs) / 1000);
  const refilledTokens = Math.min(
    rateLimitCapacity,
    current.tokens + elapsedSeconds * refillPerSecond,
  );

  if (refilledTokens < 1) {
    return {
      allowed: false,
      bucket: {
      lastSeenAtMs: nowMs,
      lastRefillAtMs: nowMs,
      tokens: refilledTokens,
      },
      hadExistingBucket: existing !== undefined,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - refilledTokens) / refillPerSecond)),
    };
  }

  return {
    allowed: true,
    bucket: {
      lastSeenAtMs: nowMs,
      lastRefillAtMs: nowMs,
      tokens: refilledTokens,
    },
    hadExistingBucket: existing !== undefined,
  };
}

function commitBucket(
  key: string,
  evaluation: BucketEvaluation,
  consumeToken: boolean,
) {
  if (!consumeToken && !evaluation.hadExistingBucket) {
    return;
  }

  rateLimitBuckets.set(key, {
    ...evaluation.bucket,
    tokens: consumeToken ? evaluation.bucket.tokens - 1 : evaluation.bucket.tokens,
  });
}

function maybeCleanupExpiredBuckets(nowMs: number, bucketTtlMs: number) {
  rateLimitOperationCount += 1;
  if (rateLimitOperationCount % DEMO_BUCKET_CLEANUP_INTERVAL !== 0) {
    return;
  }

  for (const [bucketKey, bucket] of rateLimitBuckets.entries()) {
    if (nowMs - bucket.lastSeenAtMs > bucketTtlMs) {
      rateLimitBuckets.delete(bucketKey);
    }
  }
}

export function consumeDemoRateLimit(key: string, nowMs?: number): RateLimitResult {
  maybeCleanupExpiredBuckets(nowMs ?? Date.now(), DEMO_BUCKET_TTL_MS);
  const evaluation = evaluateBucket(key, nowMs);
  commitBucket(key, evaluation, evaluation.allowed);
  if (!evaluation.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: evaluation.retryAfterSeconds,
    };
  }

  return { allowed: true };
}

export function consumeDemoSharedRateLimit(key: string = DEMO_SHARED_GUARD_KEY, nowMs?: number): RateLimitResult {
  maybeCleanupExpiredBuckets(nowMs ?? Date.now(), DEMO_BUCKET_TTL_MS);
  const evaluation = evaluateBucket(
    key,
    nowMs,
    DEMO_SHARED_GUARD_CAPACITY,
    DEMO_SHARED_GUARD_REFILL_PER_SECOND,
  );
  commitBucket(key, evaluation, evaluation.allowed);
  if (!evaluation.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: evaluation.retryAfterSeconds,
    };
  }

  return { allowed: true };
}

export function consumeDemoRouteRateLimits(
  clientKey: string,
  nowMs?: number,
): CombinedRateLimitResult {
  const evaluationTimeMs = nowMs ?? Date.now();
  maybeCleanupExpiredBuckets(evaluationTimeMs, DEMO_BUCKET_TTL_MS);

  const sharedEvaluation = evaluateBucket(
    DEMO_SHARED_GUARD_KEY,
    evaluationTimeMs,
    DEMO_SHARED_GUARD_CAPACITY,
    DEMO_SHARED_GUARD_REFILL_PER_SECOND,
  );
  const clientEvaluation = evaluateBucket(clientKey, evaluationTimeMs);

  if (!sharedEvaluation.allowed) {
    commitBucket(DEMO_SHARED_GUARD_KEY, sharedEvaluation, false);
    commitBucket(clientKey, clientEvaluation, false);
    return {
      allowed: false,
      rejectedKey: DEMO_SHARED_GUARD_KEY,
      retryAfterSeconds: sharedEvaluation.retryAfterSeconds ?? 1,
    };
  }

  if (!clientEvaluation.allowed) {
    commitBucket(DEMO_SHARED_GUARD_KEY, sharedEvaluation, false);
    commitBucket(clientKey, clientEvaluation, false);
    return {
      allowed: false,
      rejectedKey: clientKey,
      retryAfterSeconds: clientEvaluation.retryAfterSeconds ?? 1,
    };
  }

  commitBucket(DEMO_SHARED_GUARD_KEY, sharedEvaluation, true);
  commitBucket(clientKey, clientEvaluation, true);
  return { allowed: true };
}

export function throttleResponse(key: string, retryAfterSeconds: number): Response {
  logger.warn("Demo proxy rate limited", {
    client_key: key,
    retry_after_seconds: retryAfterSeconds,
  });

  return new Response(
    JSON.stringify(
      errorBody(
        "RATE_LIMITED",
        "Too many demo requests. Wait a moment and try again.",
        429,
      ),
    ),
    {
      headers: {
        "content-type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
      status: 429,
    },
  );
}

export function upstreamFailureResponse(status: number = 503): Response {
  return new Response(
    JSON.stringify(
      errorBody(
        "DEMO_UNAVAILABLE",
        "The live demo is temporarily unavailable. Please try again shortly.",
        status,
      ),
    ),
    {
      headers: { "content-type": "application/json" },
      status,
    },
  );
}

export function __resetDemoRateLimiterForTesting(): void {
  rateLimitBuckets.clear();
  rateLimitOperationCount = 0;
}

export function __getDemoRateLimiterBucketCountForTesting(): number {
  return rateLimitBuckets.size;
}
