# P1C.04 — Usage Charts Page Implementation Plan

## Intent

Implement a real console Usage page backed by Prontiq-enforced usage data:
current-period cards from `prontiq-usage`, chart buckets from
`prontiq-usage-daily`, and entitlements from Lago-projected org envelope fields.

## Current State

- `prontiq-usage` is authoritative for hot-path quota enforcement.
- Lago is authoritative for plans, subscriptions, invoices, and payment state.
- Billing events already flow through SQS to the Lago event forwarder.
- Console has real Clerk/account/key flows but only usage placeholders.

## Constraints

- Do not call Lago from the address API hot path.
- Do not call Lago or Stripe from browser usage UI.
- Do not use Lago delivery `accepted` rows as chart truth.
- Keep `/v1/account/usage` private-only; public OpenAPI must not change.
- Include revoked keys in current-period totals.
- PAYG/uncapped plans use nullable quota/remaining/overage values.

## Approach

Add `PqUsageDaily`, an org-level DynamoDB projection written idempotently by
the Lago event forwarder before sending events to Lago. Add private
`GET /v1/account/usage?granularity=daily|weekly|monthly` and console `/usage`.

Shared usage-scope helpers must be used by both auth middleware and the usage
service so the dashboard reads the same counter rows the hot path writes.

## Phases

| Phase | Scope |
|---|---|
| 1 | Shared scope helpers, `PqUsageDaily`, projection writer, forwarder wiring |
| 2 | Private account usage service/route/OpenAPI |
| 3 | Console `/usage` page, Recharts, CSV export |
| 4 | Architecture, decision, runbook, roadmap, changelog, HINTS updates |

## Documentation Updates

- `ARCHITECTURE.MD`
- `docs/decisions/038-usage-chart-source.md`
- `docs/private-api/account-usage.md`
- `docs/runbooks/usage-dashboard.md`
- `docs/runbooks/lago-billing-events.md`
- `apps/console/HINTS.md`
- `apps/console/README.md`
- `packages/api/HINTS.md`
- `packages/control-plane/HINTS.md`
- `ROADMAP.md`
- `NEXT-WORK.md`
- `NEXT-SESSION.md`
- `CHANGELOG.md`

## Test Strategy

- Shared tests for scope build/parse/reset helpers.
- Control-plane tests for projection bucket key and usage aggregation edge
  cases.
- Forwarder tests for invalid scope and no Lago send.
- Typecheck API, control-plane, shared, and console.
- Generate private/public OpenAPI and run boundary test.

## Risk & Rollback

- Double-counting is prevented by `usageAnalyticsAppliedAt`.
- Chart lag is expected while SQS drains; cards remain authoritative.
- No backfill; pre-deploy usage appears in totals but not historical chart
  buckets.
- Rollback removes projector call and usage route/UI; table can remain unused.

## Open Questions

None.

`P1C.04: 4 phases, 13 doc updates, 0 open questions.`
