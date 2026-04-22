# ADR-008: Lago becomes the target commercial system of record

## Status

Accepted

## Context

The repo currently ships a Stripe-centric billing path, but the commercial
architecture direction has changed. The target system needs plans, pricing,
metering, invoicing, and commercial reporting to live outside the Prontiq hot
path and outside founder-operated billing logic.

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
