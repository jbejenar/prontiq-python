import test from "node:test";
import assert from "node:assert/strict";
import { buildUsageDailyBucketKey } from "./usage-analytics.js";

test("buildUsageDailyBucketKey uses period/day/product sort-key shape", () => {
  assert.equal(
    buildUsageDailyBucketKey({
      periodKey: "2026-04-25_2026-05-25",
      bucketDate: "2026-04-30",
      product: "address",
    }),
    "period#2026-04-25_2026-05-25#day#2026-04-30#product#address",
  );
});
