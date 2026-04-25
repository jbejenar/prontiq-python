import test from "node:test";
import assert from "node:assert/strict";
import {
  billingUsageEventV1Schema,
  deriveBillingUsageEventId,
  type BillingEventIdInput,
} from "./billing-events.js";

const baseInput: BillingEventIdInput = {
  apiKeyHash: "a".repeat(64),
  billingEndpointKey: "address.autocomplete",
  creditDelta: 1,
  customerId: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
  requestCountAfterIncrement: 42,
  usageScope: "address#2026-04",
};

test("billing event id is deterministic for the idempotency input", () => {
  const first = deriveBillingUsageEventId(baseInput);
  const second = deriveBillingUsageEventId({ ...baseInput });

  assert.equal(first, second);
  assert.match(first, /^bevt_[a-f0-9]{32}$/);
});

test("billing event id changes when the cumulative usage target changes", () => {
  const first = deriveBillingUsageEventId(baseInput);
  const second = deriveBillingUsageEventId({
    ...baseInput,
    requestCountAfterIncrement: baseInput.requestCountAfterIncrement + 1,
  });

  assert.notEqual(first, second);
});

test("billing event schema rejects sensitive or malformed payload drift", () => {
  const parsed = billingUsageEventV1Schema.parse({
    version: 1,
    eventId: deriveBillingUsageEventId(baseInput),
    occurredAt: "2026-04-25T00:00:00.000Z",
    customerId: baseInput.customerId,
    orgId: "org_123",
    apiKeyHash: baseInput.apiKeyHash,
    keyPrefix: "pq_test_abc",
    product: "address",
    billingEndpointKey: "address.autocomplete",
    meterEventName: "prontiq_address_requests",
    creditDelta: 1,
    usageScope: "address#2026-04",
    requestCountAfterIncrement: 42,
    source: {
      requestId: "req_123",
      method: "GET",
      path: "/v1/address/autocomplete",
      stage: "test",
    },
  });

  assert.equal(parsed.eventId, deriveBillingUsageEventId(baseInput));
  assert.throws(() =>
    billingUsageEventV1Schema.parse({
      ...parsed,
      eventId: "not-deterministic",
    }),
  );
});
