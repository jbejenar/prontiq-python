import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeSpanAttributes } from "./attributes.js";

test("sanitizeSpanAttributes keeps allow-listed safe keys only", () => {
  const attributes = sanitizeSpanAttributes({
    "prontiq.method": "GET",
    "prontiq.request_id": "req_123",
    "prontiq.route": "/v1/address/autocomplete",
    "prontiq.secret": "should-drop",
    "prontiq.user_email": "should-drop",
    body: "should-drop",
  });

  assert.deepEqual(attributes, {
    "prontiq.method": "GET",
    "prontiq.request_id": "req_123",
    "prontiq.route": "/v1/address/autocomplete",
  });
});
