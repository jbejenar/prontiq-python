import test from "node:test";
import assert from "node:assert/strict";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import type { StripeWebhookHandleResult } from "@prontiq/control-plane";
import { createStripeHandler } from "./stripe.js";
import Stripe from "stripe";

const TEST_SECRET = "whsec_test_stripe_secret";

function makeStripeClient(): Stripe {
  return new Stripe("sk_test_123");
}

function signedEvent(payload: object): APIGatewayProxyEventV2 {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({
    cryptoProvider: Stripe.createNodeCryptoProvider(),
    payload: body,
    scheme: "v1",
    secret: TEST_SECRET,
    signature: "",
    timestamp: Math.floor(Date.now() / 1000),
  });
  return {
    version: "2.0",
    routeKey: "POST /webhooks/stripe",
    rawPath: "/webhooks/stripe",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "stripe-signature": header,
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "POST",
        path: "/webhooks/stripe",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "stripe/test",
      },
      requestId: "test",
      routeKey: "POST /webhooks/stripe",
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
  const sc = result.statusCode ?? 200;
  const raw = typeof result.body === "string" ? result.body : "{}";
  return { statusCode: sc, body: JSON.parse(raw) as Record<string, unknown> };
}

function makeService(result: StripeWebhookHandleResult) {
  const events: Stripe.Event[] = [];
  return {
    service: {
      async handleEvent(event: Stripe.Event): Promise<StripeWebhookHandleResult> {
        events.push(event);
        return result;
      },
    },
    events,
  };
}

test("invalid stripe signature -> 400 invalid_signature", async () => {
  const handler = createStripeHandler({
    webhookSecret: TEST_SECRET,
    stripeClient: makeStripeClient(),
    service: makeService({
      status: "processed",
      httpStatus: 200,
      body: { ok: true },
    }).service,
  });
  const event = signedEvent({
    id: "evt_invalid_sig",
    object: "event",
    type: "invoice.payment_failed",
    data: { object: { id: "in_123", object: "invoice", customer: "cus_123" } },
  });
  event.headers["stripe-signature"] = "bogus";
  const result = await handler(event);
  const decoded = decodeBody(result);
  assert.equal(decoded.statusCode, 400);
  assert.equal(decoded.body.error, "invalid_signature");
});

test("processed duplicate event -> 200", async () => {
  const fake = makeService({
    status: "duplicate",
    httpStatus: 200,
    body: { ok: true, status: "duplicate" },
  });
  const handler = createStripeHandler({
    webhookSecret: TEST_SECRET,
    stripeClient: makeStripeClient(),
    service: fake.service,
  });
  const result = await handler(signedEvent({
    id: "evt_duplicate",
    object: "event",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_123",
        object: "subscription",
        customer: "cus_123",
      },
    },
  }));
  const decoded = decodeBody(result);
  assert.equal(decoded.statusCode, 200);
  assert.equal(decoded.body.status, "duplicate");
  assert.equal(fake.events.length, 1);
  assert.equal(fake.events[0]?.id, "evt_duplicate");
});

test("retryable failure from billing service -> 500", async () => {
  const fake = makeService({
    status: "retryable_failure",
    httpStatus: 500,
    body: { error: "retryable_failure" },
  });
  const handler = createStripeHandler({
    webhookSecret: TEST_SECRET,
    stripeClient: makeStripeClient(),
    service: fake.service,
  });
  const result = await handler(signedEvent({
    id: "evt_retryable",
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_123",
        object: "checkout.session",
        customer: "cus_123",
        subscription: "sub_123",
      },
    },
  }));
  const decoded = decodeBody(result);
  assert.equal(decoded.statusCode, 500);
  assert.equal(decoded.body.error, "retryable_failure");
});
