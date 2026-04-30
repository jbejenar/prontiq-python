import test from "node:test";
import assert from "node:assert/strict";
import { buildUsageResetAt, buildUsageScope, parseUsageScope } from "./usage-scope.js";

test("buildUsageScope preserves existing calendar and Lago scope shapes", () => {
  const now = new Date("2026-04-30T03:00:00.000Z");
  assert.equal(
    buildUsageScope({
      counterPeriodSource: "calendar",
      now,
      product: "address",
      record: { billingPeriodKey: "2026-04-25_2026-05-25" },
    }),
    "address#2026-04",
  );
  assert.equal(
    buildUsageScope({
      counterPeriodSource: "lago",
      now,
      product: "address",
      record: { billingPeriodKey: "2026-04-25_2026-05-25" },
    }),
    "address#period#2026-04-25_2026-05-25",
  );
});

test("buildUsageResetAt uses Lago period end when available and calendar fallback otherwise", () => {
  const now = new Date("2026-04-30T03:00:00.000Z");
  assert.equal(
    buildUsageResetAt({
      counterPeriodSource: "lago",
      now,
      record: { billingPeriodEndingAt: "2026-05-25T00:00:00.000Z" },
    }),
    "2026-05-25T00:00:00.000Z",
  );
  assert.equal(
    buildUsageResetAt({
      counterPeriodSource: "lago",
      now,
      record: { billingPeriodEndingAt: null },
    }),
    "2026-05-01T00:00:00.000Z",
  );
});

test("parseUsageScope accepts only canonical usage scope formats", () => {
  assert.deepEqual(parseUsageScope("address#2026-04"), {
    product: "address",
    periodKey: "2026-04",
    source: "calendar",
  });
  assert.deepEqual(parseUsageScope("address#period#2026-04-25_2026-05-25"), {
    product: "address",
    periodKey: "2026-04-25_2026-05-25",
    source: "lago",
  });
  assert.equal(parseUsageScope("address#period#bad"), null);
  assert.equal(parseUsageScope("address#2026"), null);
});
