# DEC-031: Retire Legacy Stripe Runtime Non-Destructively

## Status

Superseded by DEC-033 after successful P1B.19 cutover.

## Context

Lago is the billing system of record and Stripe is only the payment rail. At
P1B.19 time, the repo still contained a working Stripe webhook, billing cron,
month-close, and provisioning-time Stripe customer creation path.

## Decision

Retire the legacy Stripe runtime with `LEGACY_STRIPE_RUNTIME_ENABLED=false`
before deleting any Stripe wiring. When disabled, the Stripe webhook verifies
signatures and returns `200 retired`; billing cron and month-close return
disabled summaries without Stripe or DynamoDB billing mutation.

DEC-033 is the follow-up cleanup decision: after cutover evidence exists, remove
the disabled Stripe deploy/runtime/frontend surfaces rather than preserving
them indefinitely.

## Considered And Rejected

- Delete the Stripe runtime immediately: rejected because rollback would require rebuilding deployed infrastructure.
- Leave Stripe runtime active indefinitely: rejected because it preserves two billing sources of truth.
- Disable the Stripe webhook at the provider first: rejected because a signed no-op endpoint gives clearer evidence and avoids retry noise during cutover.

## Consequences

- P1B.19 was reversible by setting `LEGACY_STRIPE_RUNTIME_ENABLED=true`.
- P1B.20/DEC-033 removes that flag-based rollback path from active deploys.
- Any future return to direct Stripe runtime ownership requires a new decision.
