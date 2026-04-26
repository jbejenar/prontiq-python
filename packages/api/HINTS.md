# API Agent Hints

- Do not call Lago or Stripe from the address API hot path.
- `COUNTER_PERIOD_SOURCE=calendar` is the safe default. If set to `lago`, use
  only denormalized `billingPeriodKey` from the key record; never fetch a period
  from Lago during request auth.
- PAYG and Enterprise are uncapped but tracked. Do not reintroduce
  `tier === "free"` quota branching; use plan enforcement mode.
- Billing event emission is allowed only through `BillingUsageEventV1` after
  DynamoDB usage enforcement succeeds.
- Enable `BILLING_EVENTS_ENABLED` only for deployed stages that have completed
  P1B.18a Lago metric/subscription/replay smoke checks with the repo-owned
  smoke helper and alert health verified. Before customer-facing prod go-live,
  P1B.18b must also prove smoke artifacts are cleaned or explicitly retained
  and a post-cleanup prod smoke passes.
- Never include raw API keys, query strings, headers, IP addresses, user agents,
  or response payloads in billing events.
