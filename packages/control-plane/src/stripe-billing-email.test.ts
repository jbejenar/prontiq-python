import test from "node:test";
import assert from "node:assert/strict";
import {
  BILLING_GRACE_PERIOD_PAST_DUE_DAYS_REMAINING,
  BILLING_GRACE_PERIOD_TOTAL_DAYS,
} from "@prontiq/shared";
import { buildPastDueEmailBody } from "./stripe-billing.js";

test("past_due email body stays aligned with the documented grace-period contract", () => {
  const body = buildPastDueEmailBody("https://app.prontiq.dev/account/billing");

  assert.match(body, new RegExp(`up to ${BILLING_GRACE_PERIOD_TOTAL_DAYS} days from the first failed renewal`));
  assert.match(body, new RegExp(`service continues for ${BILLING_GRACE_PERIOD_PAST_DUE_DAYS_REMAINING} more days`));
  assert.match(body, /Update your card at https:\/\/app\.prontiq\.dev\/account\/billing/);
});
