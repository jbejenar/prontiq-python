import type { Context } from "hono";
import { ERROR_CODES } from "@prontiq/shared";
import type { ApiKeyRecord } from "@prontiq/shared";

type TokenBucket = {
  lastRefillAtMs: number;
  tokens: number;
};

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

const rateLimitBuckets = new Map<string, TokenBucket>();

function tryConsumeToken(
  apiKeyHash: string,
  rateLimit: number | null,
  nowMs: number = Date.now(),
): RateLimitResult {
  if (rateLimit == null || !Number.isFinite(rateLimit) || rateLimit <= 0) {
    return { allowed: true };
  }

  const current = rateLimitBuckets.get(apiKeyHash) ?? {
    lastRefillAtMs: nowMs,
    tokens: rateLimit,
  };

  const elapsedSeconds = Math.max(0, (nowMs - current.lastRefillAtMs) / 1000);
  const refilledTokens = Math.min(rateLimit, current.tokens + elapsedSeconds * rateLimit);

  if (refilledTokens < 1) {
    rateLimitBuckets.set(apiKeyHash, {
      lastRefillAtMs: nowMs,
      tokens: refilledTokens,
    });
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - refilledTokens) / rateLimit)),
    };
  }

  rateLimitBuckets.set(apiKeyHash, {
    lastRefillAtMs: nowMs,
    tokens: refilledTokens - 1,
  });
  return { allowed: true };
}

export function consumeRateLimit(
  apiKeyHash: string,
  rateLimit: number | null,
  nowMs?: number,
): RateLimitResult {
  return tryConsumeToken(apiKeyHash, rateLimit, nowMs);
}

export function applyBurstRateLimit(
  c: Context,
  record: ApiKeyRecord,
  nowMs?: number,
): Response | null {
  const result = consumeRateLimit(record.apiKeyHash, record.rateLimit, nowMs);
  if (result.allowed) {
    return null;
  }

  c.header("Retry-After", String(result.retryAfterSeconds ?? 1));
  return c.json(
    {
      error: {
        ...ERROR_CODES.RATE_LIMITED,
        code: "RATE_LIMITED" as const,
        request_id: c.get("requestId"),
      },
    },
    429,
  );
}

export function __resetRateLimiterForTesting(): void {
  rateLimitBuckets.clear();
}
