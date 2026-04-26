# ADR-008: Lago is the commercial system of record

## Status

Accepted

## Context

The repo previously shipped a Stripe-centric billing path. P1B.19 cuts runtime
billing over to the Lago-centered model while retaining Stripe as the payment
rail, and P1B.20 removes the legacy platform-owned Stripe runtime. Plans,
pricing, metering, invoicing, and
commercial reporting need to live outside the Prontiq hot path and outside
founder-operated billing logic.

## Decision

Lago is the commercial system of record for Prontiq after the P1B.19 cutover
and P1B.20 Stripe-runtime removal.

Prontiq will continue to own:

- API key lifecycle
- request-time credit enforcement
- org/customer mapping
- billing-event emission

## Consequences

- Canonical docs and roadmap now describe a Lago-centered current architecture.
- The direct Stripe webhook / billing cron / month-close path is historical
  shipped implementation only after P1B.20.
