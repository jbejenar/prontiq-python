import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __resetRateLimiterForTesting, consumeRateLimit } from "./rate-limit.js";

beforeEach(() => {
  __resetRateLimiterForTesting();
});

test("consumeRateLimit allows requests when rate limiting is disabled", () => {
  assert.deepEqual(consumeRateLimit("hash", null, 0), { allowed: true });
  assert.deepEqual(consumeRateLimit("hash", 0, 0), { allowed: true });
  assert.deepEqual(consumeRateLimit("hash", Number.NaN, 0), { allowed: true });
});

test("consumeRateLimit consumes tokens until the bucket is empty", () => {
  assert.deepEqual(consumeRateLimit("hash", 2, 0), { allowed: true });
  assert.deepEqual(consumeRateLimit("hash", 2, 0), { allowed: true });
  assert.deepEqual(consumeRateLimit("hash", 2, 0), {
    allowed: false,
    retryAfterSeconds: 1,
  });
});

test("consumeRateLimit continuously refills tokens over time", () => {
  assert.deepEqual(consumeRateLimit("hash", 2, 0), { allowed: true });
  assert.deepEqual(consumeRateLimit("hash", 2, 0), { allowed: true });
  assert.deepEqual(consumeRateLimit("hash", 2, 250), {
    allowed: false,
    retryAfterSeconds: 1,
  });
  assert.deepEqual(consumeRateLimit("hash", 2, 500), { allowed: true });
});

test("consumeRateLimit caps refills at bucket capacity", () => {
  assert.deepEqual(consumeRateLimit("hash", 2, 0), { allowed: true });
  assert.deepEqual(consumeRateLimit("hash", 2, 10_000), { allowed: true });
  assert.deepEqual(consumeRateLimit("hash", 2, 10_000), { allowed: true });
  assert.deepEqual(consumeRateLimit("hash", 2, 10_000), {
    allowed: false,
    retryAfterSeconds: 1,
  });
});

test("consumeRateLimit isolates buckets per apiKeyHash", () => {
  assert.deepEqual(consumeRateLimit("hash-a", 1, 0), { allowed: true });
  assert.deepEqual(consumeRateLimit("hash-b", 1, 0), { allowed: true });
  assert.deepEqual(consumeRateLimit("hash-a", 1, 0), {
    allowed: false,
    retryAfterSeconds: 1,
  });
  assert.deepEqual(consumeRateLimit("hash-b", 1, 0), {
    allowed: false,
    retryAfterSeconds: 1,
  });
});
