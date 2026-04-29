import assert from "node:assert/strict";
import test from "node:test";
import app from "./account-handler.js";

test("account routes answer browser CORS preflight before Clerk auth", async () => {
  const res = await app.request("/v1/account/keys", {
    headers: {
      "access-control-request-headers": "authorization",
      "access-control-request-method": "GET",
      origin: "https://console-dev.prontiq.dev",
    },
    method: "OPTIONS",
  });

  assert.notEqual(res.status, 401);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /GET/);
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /OPTIONS/);
  assert.match(res.headers.get("access-control-allow-headers") ?? "", /authorization/i);
});
