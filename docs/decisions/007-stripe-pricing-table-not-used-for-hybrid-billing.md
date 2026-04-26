# ADR-007: Stripe Pricing Tables are not used for Prontiq's hybrid billing UX

> Superseded on 2026-04-22 by the Lago commercial architecture direction and
> closed out by DEC-033 / P1B.20 on 2026-04-26.
>
> This ADR is retained as a record of the **legacy Stripe-forward** billing UX
> decision. It is not the forward-looking commercial architecture.

## Status

Superseded

## Context

This ADR records a historical decision made while the commercial architecture
was still Stripe-forward. The repo has since pivoted to a Lago-centered target
architecture, but the earlier Stripe pricing-table decision is retained here so
future readers can understand why the interim embedded pricing-table path was
retired.

## Decision

Do not use embedded Stripe Pricing Tables for Prontiq's paid-plan purchase UX.
Keep pricing UI first-party and platform-owned instead of treating a hosted
Stripe widget as the long-term contract. P1B.20 removes the interim
`stripe-pricing-table` component/env wiring entirely.

## Consequences

### Positive

- Keeps pricing UI first-party rather than bound to a hosted widget.
- Preserves Prontiq control over how Free and paid commercial messaging are
  explained.

### Negative

- Requires platform-owned pricing UI instead of a drop-in component.
- The interim pricing-table integration had to be retired and documented as
  superseded.

## Alternatives Considered

### 1. Keep Stripe Pricing Tables and patch around the gaps

Rejected. The limitations were structural, not cosmetic.

### 2. Keep commercial UX platform-owned

Accepted at the time. That intent survives even though the broader commercial
system-of-record decision has since moved to Lago.
