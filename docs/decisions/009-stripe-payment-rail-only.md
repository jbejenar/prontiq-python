# ADR-009: Stripe is the payment rail, not the billing source of truth

## Status

Accepted

## Decision

Stripe remains in the architecture for payment collection and payment-method
handling, but it is no longer the target source of truth for commercial state.

## Consequences

- Canonical docs must stop describing Stripe as the forward-looking billing
  system of record.
- Legacy Stripe billing docs remain for migration and operational history only.
