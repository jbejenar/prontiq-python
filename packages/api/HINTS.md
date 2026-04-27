# API Agent Hints

- Do not call Lago or Stripe from the address API hot path.
- P1B.19/P1B.20 cutover posture is `COUNTER_PERIOD_SOURCE=lago`. Calendar remains the
  rollback fallback. In either mode, use only denormalized fields from the key
  record; never fetch a period from Lago during request auth.
- PAYG and Enterprise are uncapped but tracked. Do not reintroduce
  `tier === "free"` quota branching; use plan enforcement mode.
- Billing event emission is allowed only through `BillingUsageEventV2` after
  DynamoDB usage enforcement succeeds.
- Enable `BILLING_EVENTS_ENABLED` only for deployed stages that have completed
  P1B.18a Lago metric/subscription/replay smoke checks with the repo-owned
  smoke helper and alert health verified. P1B.21 retired the retained prod
  smoke key with prefix `pq_live_4a85`; do not reactivate or reuse it. Future
  prod smoke needs a new labelled probe under a new ticket.
- P1B.18a is closed. Future billing API work may rely on dev/prod Lago
  forwarding and webhook smoke evidence, but must keep Lago and Stripe off the
  API hot path.
- Account setup responses expose Clerk `orgId`, which is also the active Lago
  customer external id.
- AWS account billing routes are retired. Future console billing should use a
  Vercel server-side BFF that verifies Clerk auth and calls Lago with a
  server-held Lago API key.
- Never include raw API keys, query strings, headers, IP addresses, user agents,
  or response payloads in billing events.
