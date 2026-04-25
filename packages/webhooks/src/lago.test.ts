import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { createLagoHandler, verifyLagoHmacSignature } from "./lago.js";
import type { LagoWebhookReconciliationResult } from "@prontiq/control-plane";

const TEST_SECRET = "test_lago_hmac_secret";

function sign(body: string): string {
  return createHmac("sha256", TEST_SECRET).update(body).digest("base64");
}

function makeEvent(
  payload: unknown,
  overrides: {
    headers?: Record<string, string>;
    rawBody?: string;
  } = {},
): APIGatewayProxyEventV2 {
  const body = overrides.rawBody ?? JSON.stringify(payload);
  return {
    version: "2.0",
    routeKey: "POST /webhooks/lago",
    rawPath: "/webhooks/lago",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "x-lago-signature": sign(body),
      "x-lago-signature-algorithm": "hmac",
      "x-lago-unique-key": "lago_evt_123",
      ...overrides.headers,
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "POST",
        path: "/webhooks/lago",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "lago/test",
      },
      requestId: "test",
      routeKey: "POST /webhooks/lago",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body,
    isBase64Encoded: false,
  };
}

function decodeBody(result: APIGatewayProxyResultV2): {
  statusCode: number;
  body: Record<string, unknown>;
} {
  if (typeof result === "string") {
    return { statusCode: 200, body: JSON.parse(result) as Record<string, unknown> };
  }
  const statusCode = result.statusCode ?? 200;
  const raw = typeof result.body === "string" ? result.body : "{}";
  return { statusCode, body: JSON.parse(raw) as Record<string, unknown> };
}

function makeService(result: LagoWebhookReconciliationResult) {
  const calls: Array<{ payload: unknown; payloadHash?: string; uniqueKey: string }> = [];
  return {
    service: {
      async handleWebhook(input: { payload: unknown; payloadHash?: string; uniqueKey: string }) {
        calls.push(input);
        return result;
      },
    },
    calls,
  };
}

test("verifies Lago HMAC signatures using base64 sha256 digest", () => {
  const rawBody = JSON.stringify({ webhook_type: "subscription.started" });
  assert.equal(
    verifyLagoHmacSignature({
      rawBody,
      signature: sign(rawBody),
      secret: TEST_SECRET,
    }),
    true,
  );
  assert.equal(
    verifyLagoHmacSignature({
      rawBody,
      signature: "bogus",
      secret: TEST_SECRET,
    }),
    false,
  );
});

test("invalid Lago signature -> 400 invalid_signature", async () => {
  const fake = makeService({
    status: "processed",
    httpStatus: 200,
    body: { ok: true },
  });
  const handler = createLagoHandler({ service: fake.service, webhookSecret: TEST_SECRET });
  const result = await handler(
    makeEvent(
      { webhook_type: "subscription.started" },
      { headers: { "x-lago-signature": "bogus" } },
    ),
  );
  const decoded = decodeBody(result);

  assert.equal(decoded.statusCode, 400);
  assert.equal(decoded.body.error, "invalid_signature");
  assert.equal(fake.calls.length, 0);
});

test("missing unique key -> 400 and does not dispatch", async () => {
  const fake = makeService({
    status: "processed",
    httpStatus: 200,
    body: { ok: true },
  });
  const handler = createLagoHandler({ service: fake.service, webhookSecret: TEST_SECRET });
  const result = await handler(
    makeEvent({ webhook_type: "subscription.started" }, { headers: { "x-lago-unique-key": "" } }),
  );
  const decoded = decodeBody(result);

  assert.equal(decoded.statusCode, 400);
  assert.equal(decoded.body.error, "missing_unique_key");
  assert.equal(fake.calls.length, 0);
});

test("valid Lago webhook dispatches to reconciliation service", async () => {
  const fake = makeService({
    status: "processed",
    httpStatus: 200,
    body: { ok: true, status: "processed" },
  });
  const handler = createLagoHandler({ service: fake.service, webhookSecret: TEST_SECRET });
  const result = await handler(makeEvent({ webhook_type: "subscription.started" }));
  const decoded = decodeBody(result);

  assert.equal(decoded.statusCode, 200);
  assert.equal(decoded.body.status, "processed");
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0]?.uniqueKey, "lago_evt_123");
  assert.equal(typeof fake.calls[0]?.payloadHash, "string");
});

test("disabled reconciliation propagates retryable 503 to Lago", async () => {
  const fake = makeService({
    status: "disabled",
    httpStatus: 503,
    body: { error: "reconciliation_disabled" },
  });
  const handler = createLagoHandler({ service: fake.service, webhookSecret: TEST_SECRET });
  const result = await handler(makeEvent({ webhook_type: "subscription.started" }));
  const decoded = decodeBody(result);

  assert.equal(decoded.statusCode, 503);
  assert.equal(decoded.body.error, "reconciliation_disabled");
});
