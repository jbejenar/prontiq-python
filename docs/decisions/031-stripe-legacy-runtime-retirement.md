# DEC-031: Retire Legacy Stripe Runtime Non-Destructively

## Status

Accepted.

## Context

Lago is the billing system of record and Stripe is only the payment rail. The repo still contains a working Stripe webhook, billing cron, month-close, and provisioning-time Stripe customer creation path.

## Decision

Retire the legacy Stripe runtime with `LEGACY_STRIPE_RUNTIME_ENABLED=false` before deleting any Stripe wiring. When disabled, the Stripe webhook verifies signatures and returns `200 retired`; billing cron and month-close return disabled summaries without Stripe or DynamoDB billing mutation.

## Considered And Rejected

- Delete the Stripe runtime immediately: rejected because rollback would require rebuilding deployed infrastructure.
- Leave Stripe runtime active indefinitely: rejected because it preserves two billing sources of truth.
- Disable the Stripe webhook at the provider first: rejected because a signed no-op endpoint gives clearer evidence and avoids retry noise during cutover.

## Consequences

- P1B.19 is reversible by setting `LEGACY_STRIPE_RUNTIME_ENABLED=true`.
- P1B.20 can remove dead Stripe config after cutover evidence exists.
- Any meaningful Stripe event received while retired requires manual replay if rollback is needed.
