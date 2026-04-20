import {
  __resetDemoRateLimiterForTesting,
  DEMO_BUCKET_CLEANUP_INTERVAL,
  DEMO_BUCKET_TTL_MS,
  DEMO_SESSION_COOKIE_NAME,
  DEMO_SHARED_GUARD_CAPACITY,
  DEMO_SHARED_GUARD_KEY,
  DEMO_QUERY_MIN_LENGTH,
  DEMO_SUGGESTION_LIMIT_DEFAULT,
  DEMO_SUGGESTION_LIMIT_MAX,
  applyDemoSessionCookie,
  buildDemoUpstreamUrl,
  consumeDemoRouteRateLimits,
  consumeDemoRateLimit,
  consumeDemoSharedRateLimit,
  getClientIdentifier,
  sanitizeDemoQuery,
  throttleResponse,
  upstreamFailureResponse,
} from "./demo-proxy.js";

beforeEach(() => {
  __resetDemoRateLimiterForTesting();
});

test("sanitizeDemoQuery rejects too-short queries", () => {
  expect(() => sanitizeDemoQuery(new URLSearchParams({ q: "ab" }))).toThrowError(Response);
});

test("sanitizeDemoQuery clamps the suggestion limit and normalizes state", () => {
  expect(
    sanitizeDemoQuery(new URLSearchParams({ q: "9 endeavour", state: "vic", limit: "999" })),
  ).toEqual({
    limit: DEMO_SUGGESTION_LIMIT_MAX,
    q: "9 endeavour",
    state: "VIC",
  });
});

test("sanitizeDemoQuery falls back to the default limit when invalid", () => {
  expect(
    sanitizeDemoQuery(new URLSearchParams({ q: "123 collins", limit: "nope" })),
  ).toEqual({
    limit: DEMO_SUGGESTION_LIMIT_DEFAULT,
    q: "123 collins",
    state: undefined,
  });
});

test("buildDemoUpstreamUrl forwards only the whitelisted query params", () => {
  const url = buildDemoUpstreamUrl("https://api.prontiq.dev", {
    limit: 5,
    q: "9 endeavour",
    state: "VIC",
  });

  expect(url.toString()).toBe("https://api.prontiq.dev/v1/address/autocomplete?q=9+endeavour&limit=5&state=VIC");
});

test("getClientIdentifier issues a server-side demo session and ignores forwarding headers", () => {
  const headers = new Headers({
    "x-vercel-id": "mel1::abc123",
    "x-forwarded-for": "203.0.113.10, 10.0.0.1",
    forwarded: 'for="203.0.113.20";proto=https;by=203.0.113.43',
    "x-real-ip": "198.51.100.4",
  });
  const identity = getClientIdentifier(headers, "https://landing.prontiq.dev/api/demo/address/autocomplete");

  expect(identity.clientKey).toMatch(/^session:/);
  expect(identity.setCookieHeader).toContain(`${DEMO_SESSION_COOKIE_NAME}=`);
  expect(identity.setCookieHeader).toContain("HttpOnly");
  expect(identity.setCookieHeader).toContain("Secure");
});

test("getClientIdentifier reuses an existing server-issued demo session cookie", () => {
  const identity = getClientIdentifier(
    new Headers({
      cookie: `${DEMO_SESSION_COOKIE_NAME}=123e4567-e89b-42d3-a456-426614174000`,
      "x-forwarded-for": "203.0.113.10",
    }),
  );

  expect(identity).toEqual({
    clientKey: "session:123e4567-e89b-42d3-a456-426614174000",
    sessionId: "123e4567-e89b-42d3-a456-426614174000",
  });
});

test("different server-issued demo sessions get isolated rate-limit buckets", () => {
  const firstVisitor = getClientIdentifier(
    new Headers({
      cookie: `${DEMO_SESSION_COOKIE_NAME}=123e4567-e89b-42d3-a456-426614174000`,
    }),
  );
  const secondVisitor = getClientIdentifier(
    new Headers({
      cookie: `${DEMO_SESSION_COOKIE_NAME}=123e4567-e89b-42d3-a456-426614174001`,
    }),
  );

  for (let index = 0; index < 12; index += 1) {
    expect(consumeDemoRateLimit(firstVisitor.clientKey, 1_000 + index)).toEqual({ allowed: true });
  }

  expect(consumeDemoRateLimit(firstVisitor.clientKey, 1_100)).toEqual({
    allowed: false,
    retryAfterSeconds: 1,
  });
  expect(consumeDemoRateLimit(secondVisitor.clientKey, 1_100)).toEqual({ allowed: true });
});

test("inactive demo buckets age out while active buckets are preserved", () => {
  const staleKey = "session:123e4567-e89b-42d3-a456-426614174000";
  const activeKey = "session:123e4567-e89b-42d3-a456-426614174001";
  const start = 50_000;

  for (let index = 0; index < 12; index += 1) {
    expect(consumeDemoRateLimit(staleKey, start + index)).toEqual({ allowed: true });
  }

  expect(consumeDemoRateLimit(staleKey, start + 20)).toEqual({
    allowed: false,
    retryAfterSeconds: 1,
  });
  expect(consumeDemoRateLimit(activeKey, start + DEMO_BUCKET_TTL_MS - 100)).toEqual({ allowed: true });

  for (let index = 1; index < DEMO_BUCKET_CLEANUP_INTERVAL; index += 1) {
    consumeDemoRateLimit(
      `session:cleanup-${index.toString().padStart(3, "0")}`,
      start + DEMO_BUCKET_TTL_MS + index,
    );
  }

  expect(
    consumeDemoRateLimit(
      `session:cleanup-${DEMO_BUCKET_CLEANUP_INTERVAL.toString().padStart(3, "0")}`,
      start + DEMO_BUCKET_TTL_MS + DEMO_BUCKET_CLEANUP_INTERVAL,
    ),
  ).toEqual({ allowed: true });

  expect(consumeDemoRateLimit(staleKey, start + DEMO_BUCKET_TTL_MS + DEMO_BUCKET_CLEANUP_INTERVAL + 10)).toEqual({
    allowed: true,
  });
  expect(consumeDemoRateLimit(activeKey, start + DEMO_BUCKET_TTL_MS + DEMO_BUCKET_CLEANUP_INTERVAL + 10)).toEqual({
    allowed: true,
  });
});

test("shared demo guard allows bursty public traffic before throttling the instance", () => {
  const start = 10_000;

  for (let index = 0; index < DEMO_SHARED_GUARD_CAPACITY; index += 1) {
    expect(consumeDemoSharedRateLimit(DEMO_SHARED_GUARD_KEY, start)).toEqual({
      allowed: true,
    });
  }

  expect(consumeDemoSharedRateLimit(DEMO_SHARED_GUARD_KEY, start)).toEqual({
    allowed: false,
    retryAfterSeconds: 1,
  });
});

test("shared demo guard bucket survives cleanup and keeps retry timing stable", () => {
  const start = 100_000;

  for (let index = 0; index < DEMO_SHARED_GUARD_CAPACITY; index += 1) {
    consumeDemoSharedRateLimit(DEMO_SHARED_GUARD_KEY, start);
  }

  expect(consumeDemoSharedRateLimit(DEMO_SHARED_GUARD_KEY, start)).toEqual({
    allowed: false,
    retryAfterSeconds: 1,
  });

  for (let index = 1; index <= DEMO_BUCKET_CLEANUP_INTERVAL; index += 1) {
    consumeDemoRateLimit(
      `session:cleanup-${index.toString().padStart(3, "0")}`,
      start,
    );
  }

  expect(consumeDemoSharedRateLimit(DEMO_SHARED_GUARD_KEY, start)).toEqual({
    allowed: false,
    retryAfterSeconds: 1,
  });
});

test("shared guard rejections do not burn the visitor's personal bucket", () => {
  const sessionKey = "session:123e4567-e89b-42d3-a456-426614174000";
  const start = 200_000;

  for (let index = 0; index < DEMO_SHARED_GUARD_CAPACITY; index += 1) {
    expect(consumeDemoSharedRateLimit(DEMO_SHARED_GUARD_KEY, start)).toEqual({
      allowed: true,
    });
  }

  expect(consumeDemoRouteRateLimits(sessionKey, start)).toEqual({
    allowed: false,
    rejectedKey: DEMO_SHARED_GUARD_KEY,
    retryAfterSeconds: 1,
  });

  for (let index = 0; index < 12; index += 1) {
    expect(consumeDemoRateLimit(sessionKey, start + 1_000 + index)).toEqual({
      allowed: true,
    });
  }

  expect(consumeDemoRateLimit(sessionKey, start + 1_100)).toEqual({
    allowed: false,
    retryAfterSeconds: 1,
  });
});

test("client-bucket rejections do not burn shared capacity", () => {
  const sessionKey = "session:123e4567-e89b-42d3-a456-426614174001";
  const start = 300_000;

  for (let index = 0; index < 12; index += 1) {
    expect(consumeDemoRateLimit(sessionKey, start + index)).toEqual({ allowed: true });
  }

  expect(consumeDemoRouteRateLimits(sessionKey, start + 50)).toEqual({
    allowed: false,
    rejectedKey: sessionKey,
    retryAfterSeconds: 1,
  });

  for (let index = 0; index < DEMO_SHARED_GUARD_CAPACITY; index += 1) {
    expect(consumeDemoSharedRateLimit(DEMO_SHARED_GUARD_KEY, start + 100)).toEqual({
      allowed: true,
    });
  }

  expect(consumeDemoSharedRateLimit(DEMO_SHARED_GUARD_KEY, start + 100)).toEqual({
    allowed: false,
    retryAfterSeconds: 1,
  });
});

test("consumeDemoRateLimit returns retry metadata when the bucket is exhausted", () => {
  const start = 1_000;
  const key = "ip:203.0.113.10";

  for (let index = 0; index < 12; index += 1) {
    expect(consumeDemoRateLimit(key, start + index)).toEqual({ allowed: true });
  }

  expect(consumeDemoRateLimit(key, start + 12)).toEqual({
    allowed: false,
    retryAfterSeconds: 1,
  });
});

test("applyDemoSessionCookie appends the issued demo session cookie to responses", () => {
  const response = applyDemoSessionCookie(
    new Response(null, { status: 204 }),
    `${DEMO_SESSION_COOKIE_NAME}=123e4567-e89b-42d3-a456-426614174000; HttpOnly`,
  );

  expect(response.headers.get("Set-Cookie")).toBe(
    `${DEMO_SESSION_COOKIE_NAME}=123e4567-e89b-42d3-a456-426614174000; HttpOnly`,
  );
});

test("throttleResponse emits a 429 with Retry-After", async () => {
  const response = throttleResponse("ip:203.0.113.10", 3);
  const body = await response.json();

  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("3");
  expect(body).toEqual({
    error: {
      code: "RATE_LIMITED",
      message: "Too many demo requests. Wait a moment and try again.",
      status: 429,
    },
  });
});

test("upstreamFailureResponse uses a deterministic non-secret-bearing error body", async () => {
  const response = upstreamFailureResponse();
  const body = await response.json();

  expect(response.status).toBe(503);
  expect(body).toEqual({
    error: {
      code: "DEMO_UNAVAILABLE",
      message: "The live demo is temporarily unavailable. Please try again shortly.",
      status: 503,
    },
  });
});

test("query minimum length stays aligned with the widget path", () => {
  expect(DEMO_QUERY_MIN_LENGTH).toBe(3);
});
