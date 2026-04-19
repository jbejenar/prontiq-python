import test from "node:test";
import assert from "node:assert/strict";

import { calculateOpenSearchLowFreeStorageThresholdMiB } from "./observability.js";

test("calculateOpenSearchLowFreeStorageThresholdMiB converts GiB to per-node MiB threshold", () => {
  assert.equal(calculateOpenSearchLowFreeStorageThresholdMiB(50), 10240);
  assert.equal(calculateOpenSearchLowFreeStorageThresholdMiB(20), 4096);
});

test("calculateOpenSearchLowFreeStorageThresholdMiB rejects non-positive volume sizes", () => {
  assert.throws(
    () => calculateOpenSearchLowFreeStorageThresholdMiB(0),
    /positive finite GiB value/,
  );
  assert.throws(
    () => calculateOpenSearchLowFreeStorageThresholdMiB(-1),
    /positive finite GiB value/,
  );
});
