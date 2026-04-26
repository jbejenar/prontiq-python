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
  smoke helper and alert health verified. Retained prod smoke fixtures may be
  reused by P1B.18, P1B.19, and P1B.20 only while clearly labelled/inventoried
  as test-only. P1B.21 owns final fixture retirement and post-cleanup prod
  smoke before real customer go-live.
- P1B.18a is closed. Future billing API work may rely on dev/prod Lago
  forwarding and webhook smoke evidence, but must keep Lago and Stripe off the
  API hot path.
- Account billing routes belong in `account-handler.ts` / `routes/account.ts`,
  not the address API `$default` app. Update `openapi.ts` when adding account
  routes so docs include the contract without bloating the hot-path Lambda.
- Never include raw API keys, query strings, headers, IP addresses, user agents,
  or response payloads in billing events.
