# API Agent Hints

- Do not call Lago or Stripe from the address API hot path.
- P1B.19/P1B.20 cutover posture is `COUNTER_PERIOD_SOURCE=lago`. Calendar remains the
  rollback fallback. In either mode, use only denormalized fields from the key
  record; never fetch a period from Lago during request auth.
- PAYG and Enterprise are uncapped but tracked. Do not reintroduce
  `tier === "free"` quota branching; use plan enforcement mode.
- Billing event emission is allowed only through `BillingUsageEventV2` after
  DynamoDB usage enforcement succeeds.
- Usage scope construction is shared with the account usage API. Do not create
  a second scope format in route code; use the shared helpers so the dashboard
  and hot path read/write the same `prontiq-usage` rows.
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
- AWS account billing reads and portal-session routes are retired.
  `POST /v1/account/billing/plan-change` is the only active billing mutation:
  it must verify Clerk JWT/admin, require first-factor step-up and
  `Idempotency-Key`, write `prontiq-billing-actions*` replay evidence, and let
  Lago webhook/reconcile projection update local enforcement.
- Never include raw API keys, query strings, headers, IP addresses, user agents,
  or response payloads in billing events.
- `/v1/account/usage` is a private account route only. It must appear in
  `packages/api/openapi.private.json`, never in the public docs OpenAPI.
