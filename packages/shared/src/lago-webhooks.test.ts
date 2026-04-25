import test from "node:test";
import assert from "node:assert/strict";
import { hashLagoWebhookPayload, isConsumedLagoWebhookEventType } from "./lago-webhooks.js";

test("lago webhook payload hash is stable across object key order", () => {
  assert.equal(
    hashLagoWebhookPayload({ b: 2, a: { d: 4, c: 3 } }),
    hashLagoWebhookPayload({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test("consumed Lago webhook event set is explicit", () => {
  assert.equal(isConsumedLagoWebhookEventType("subscription.started"), true);
  assert.equal(isConsumedLagoWebhookEventType("invoice.payment_overdue"), true);
  assert.equal(isConsumedLagoWebhookEventType("wallet.updated"), false);
});
