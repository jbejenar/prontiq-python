import test from "node:test";
import assert from "node:assert/strict";
import {
  billingUsageEventV2Schema,
  deriveBillingUsageEventId,
  deriveLagoExternalSubscriptionIdForOrg,
  type BillingEventIdInput,
} from "./billing-events.js";

const baseInput: BillingEventIdInput = {
  apiKeyHash: "a".repeat(64),
  billingEndpointKey: "address.autocomplete",
  creditDelta: 1,
  orgId: "org_123",
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
  const parsed = billingUsageEventV2Schema.parse({
    version: 2,
    eventId: deriveBillingUsageEventId(baseInput),
    occurredAt: "2026-04-25T00:00:00.000Z",
    orgId: baseInput.orgId,
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
    billingUsageEventV2Schema.parse({
      ...parsed,
      eventId: "not-deterministic",
    }),
  );
});

test("lago external subscription id derives from Clerk org id", () => {
  assert.equal(
    deriveLagoExternalSubscriptionIdForOrg("org_123"),
    "lago_sub_org_123",
  );
});

test("lago external subscription id rejects malformed org ids", () => {
  assert.throws(() => deriveLagoExternalSubscriptionIdForOrg("pq_cust_123"));
  assert.throws(() => deriveLagoExternalSubscriptionIdForOrg("not-an-org"));
});
