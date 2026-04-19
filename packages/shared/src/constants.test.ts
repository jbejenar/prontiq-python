import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ACCOUNT_URL, DEFAULT_BILLING_URL } from "./constants.js";

test("frontend host defaults keep account and billing surfaces distinct", () => {
  assert.equal(DEFAULT_ACCOUNT_URL, "https://console.prontiq.dev");
  assert.equal(DEFAULT_BILLING_URL, "https://console.prontiq.dev/billing");
  assert.notEqual(DEFAULT_ACCOUNT_URL, DEFAULT_BILLING_URL);
});
