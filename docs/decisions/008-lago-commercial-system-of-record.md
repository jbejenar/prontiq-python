# ADR-008: Lago becomes the target commercial system of record

## Status

Accepted

## Context

The repo previously shipped a Stripe-centric billing path. P1B.19 cuts runtime
billing over to the Lago-centered model while retaining Stripe as the payment
rail and rollback-only legacy runtime. Plans, pricing, metering, invoicing, and
commercial reporting need to live outside the Prontiq hot path and outside
founder-operated billing logic.

## Decision

Lago is the target commercial system of record for Prontiq.

Prontiq will continue to own:

- API key lifecycle
- request-time credit enforcement
- org/customer mapping
- billing-event emission

## Consequences

- Canonical docs and roadmap now describe a Lago-centered target architecture.
- The live Stripe webhook / billing cron / month-close path is retained as
  legacy shipped implementation until migration is complete.
