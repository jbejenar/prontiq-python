# ADR-034: Retire the production Lago smoke API key and retain audit evidence

## Status

Accepted, 2026-04-27. Historical P1B.18a-P1B.21 fixture context.

Active smoke events after [ADR-035](035-clerk-org-commercial-identity.md) use
Clerk `orgId` and `lago_sub_${orgId}`. The retained `pq_cust_*` / `pq_sub_*`
fixture below is audit evidence only.

## Context

P1B.18a, P1B.18, P1B.19, and P1B.20 intentionally reused a repo-owned
production smoke fixture while the Lago migration was still in flight. After
P1B.20, that fixture no longer needs to admit production API traffic before real
customer go-live, but its accepted billing-event, usage, webhook, and Lago
subscription evidence is still useful for replay and drift analysis.

The retained production fixture is test-only:

- org: `org_prontiq_platform_lago_smoke_prod`
- customer: `pq_cust_01KQ3TT9XZZDR2CAZTV1TX1KBS`
- subscription: `pq_sub_01KQ3TT9XZZDR2CAZTV1TX1KBS`
- key prefix: `pq_live_4a85`

Raw API keys, API-key hashes, Lago API keys, webhook secrets, and local ignored
operator files are intentionally excluded from this decision record.

## Decision

Disable the retained production smoke API key by setting `active=false` after
one final API-originated smoke event is accepted by Lago.

Retain the related Prontiq customer row, usage row, delivery-ledger rows,
webhook-ledger rows, and Lago customer/subscription as audit and replay
evidence. Do not use this fixture as an ongoing operational probe. Any future
production probe must be created deliberately by a new ticket with a new labelled
key and fresh evidence.

## Considered And Rejected

- **Hard-delete all smoke records.** Rejected because it removes the exact
  evidence needed to debug migration-time Lago deliveries and webhook
  reconciliation.
- **Keep the smoke key active as a go-live probe.** Rejected because there are
  no customers yet, and a reusable production key is unnecessary risk after the
  migration closes.
- **Cancel or delete the Lago smoke subscription.** Rejected because the
  subscription is linked to accepted delivery evidence. Once the platform API
  key is disabled, it cannot receive new API-originated usage from this repo.
- **Reactivate the same key for future testing.** Rejected because reusing a
  historical production key makes later evidence ambiguous.

## Consequences

- The final go-live posture leaves billing enabled for real customers:
  `BILLING_EVENTS_ENABLED=true`, `COUNTER_PERIOD_SOURCE=lago`, and
  `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true`.
- The retired key returns `401 INVALID_API_KEY`.
- The delivery and webhook ledgers remain canonical evidence and must not be
  deleted by cleanup work.
- Future production tests need a new labelled probe key or a real customer test
  flow.
