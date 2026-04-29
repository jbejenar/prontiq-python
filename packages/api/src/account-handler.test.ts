import assert from "node:assert/strict";
import test from "node:test";
import app from "./account-handler.js";

async function withEnv<T>(
  updates: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(updates).map((name) => [name, process.env[name]]),
  );

  for (const [name, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

test("dev account routes answer browser CORS preflight before Clerk auth with wildcard origin", async () => {
  const res = await withEnv({ PRONTIQ_STAGE: "dev" }, () =>
    app.request("/v1/account/keys", {
      headers: {
        "access-control-request-headers": "authorization",
        "access-control-request-method": "GET",
        origin: "https://prontiq-platform-console-git-main-jbejenar-2089s-projects.vercel.app",
      },
      method: "OPTIONS",
    }),
  );

  assert.notEqual(res.status, 401);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /GET/);
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /OPTIONS/);
  assert.match(res.headers.get("access-control-allow-headers") ?? "", /authorization/i);
});

test("prod account-route CORS uses the configured console origin", async () => {
  const prodRes = await withEnv(
    {
      PRONTIQ_ACCOUNT_URL: "https://console.prontiq.dev",
      PRONTIQ_STAGE: "prod",
    },
    () =>
      app.request("/v1/account/keys", {
        headers: {
          "access-control-request-headers": "authorization",
          "access-control-request-method": "GET",
          origin: "https://console.prontiq.dev",
        },
        method: "OPTIONS",
      }),
  );

  assert.notEqual(prodRes.status, 401);
  assert.equal(prodRes.status, 204);
  assert.equal(prodRes.headers.get("access-control-allow-origin"), "https://console.prontiq.dev");
  assert.notEqual(prodRes.headers.get("access-control-allow-origin"), "*");
});

test("prod account-route CORS defaults to the canonical console origin", async () => {
  const res = await withEnv(
    {
      PRONTIQ_ACCOUNT_URL: undefined,
      PRONTIQ_STAGE: "prod",
    },
    () =>
      app.request("/v1/account/keys", {
        headers: {
          "access-control-request-headers": "authorization",
          "access-control-request-method": "GET",
          origin: "https://console.prontiq.dev",
        },
        method: "OPTIONS",
      }),
  );

  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://console.prontiq.dev");
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /GET/);
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /OPTIONS/);
  assert.match(res.headers.get("access-control-allow-headers") ?? "", /authorization/i);
});
