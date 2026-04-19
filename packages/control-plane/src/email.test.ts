import test from "node:test";
import assert from "node:assert/strict";
import { getActiveSuppressionRecord, isSuppressedEmail } from "./email.js";
import type { SesSuppressionRecord } from "@prontiq/shared";

function makeDdb(record?: SesSuppressionRecord) {
  return {
    async send() {
      return { Item: record };
    },
  };
}

test("expired hard bounce suppression is inactive before DynamoDB TTL deletion", async () => {
  const suppressed = await isSuppressedEmail(
    makeDdb({
      email: "expired-hard@example.com",
      lastEventAt: "2026-01-01T00:00:00.000Z",
      reason: "hard_bounce",
      ttl: Math.floor(Date.now() / 1000) - 1,
    }) as never,
    "prontiq-ses-suppressions-test",
    "expired-hard@example.com",
  );

  assert.equal(suppressed, false);
});

test("expired thresholded soft bounce suppression is inactive before DynamoDB TTL deletion", async () => {
  const suppressed = await isSuppressedEmail(
    makeDdb({
      bounceCount: 3,
      email: "expired-soft@example.com",
      lastEventAt: "2026-01-01T00:00:00.000Z",
      reason: "soft_bounce",
      ttl: Math.floor(Date.now() / 1000) - 1,
    }) as never,
    "prontiq-ses-suppressions-test",
    "expired-soft@example.com",
  );

  assert.equal(suppressed, false);
});

test("complaint suppression remains active without TTL", async () => {
  const suppressed = await isSuppressedEmail(
    makeDdb({
      email: "complaint@example.com",
      lastEventAt: "2026-01-01T00:00:00.000Z",
      reason: "complaint",
    }) as never,
    "prontiq-ses-suppressions-test",
    "complaint@example.com",
  );

  assert.equal(suppressed, true);
});

test("getActiveSuppressionRecord drops expired non-complaint rows", () => {
  const active = getActiveSuppressionRecord({
    email: "expired-soft@example.com",
    lastEventAt: "2026-01-01T00:00:00.000Z",
    reason: "soft_bounce",
    ttl: 100,
  }, 101);

  assert.equal(active, undefined);
});

test("getActiveSuppressionRecord preserves permanent complaints", () => {
  const active = getActiveSuppressionRecord({
    email: "complaint@example.com",
    lastEventAt: "2026-01-01T00:00:00.000Z",
    reason: "complaint",
  }, 101);

  assert.deepEqual(active, {
    email: "complaint@example.com",
    lastEventAt: "2026-01-01T00:00:00.000Z",
    reason: "complaint",
  });
});
