# ADR-007: Stripe Pricing Tables are not used for Prontiq's hybrid billing UX

## Status

Accepted

## Context

Prontiq's billing model is hybrid:

- a recurring plan item for the base monthly fee
- one metered family item per enabled API product
- Free rendered and managed by Prontiq outside Stripe subscriptions

Stripe remains the billing system of record, but Stripe Pricing Tables do not fit this purchase flow cleanly for Prontiq's hybrid metered plans. The original landing integration shipped as an interim implementation, but it is not the forward-looking contract.

## Decision

Do not use Stripe Pricing Tables for Prontiq's paid-plan purchase UX.

Use this pattern instead:

- Prontiq-rendered plan cards on landing and billing surfaces
- backend-created Stripe Checkout Sessions for paid upgrades
- existing Stripe webhooks to reconcile entitlements after `checkout.session.completed`
- Stripe Customer Portal for payment methods, invoices, cancellation, and supported subscription self-service

## Consequences

### Positive

- Keeps Stripe as the billing platform without forcing an ill-fitting low-code purchase surface.
- Lets Prontiq explain hybrid pricing clearly instead of flattening it into a Pricing Table.
- Preserves the existing webhook-driven entitlement model.
- Keeps Free as an app-rendered tier rather than trying to force it into Stripe subscription UX.

### Negative

- Requires first-party pricing UI instead of a drop-in Stripe component.
- Requires a server-side Checkout Session orchestration path.
- The interim Pricing Table integration has to be retired and documented as superseded.

## Alternatives Considered

### 1. Keep Stripe Pricing Tables and patch around the gaps

Rejected. The limitations are structural, not just cosmetic configuration issues.

### 2. Replace Stripe entirely

Rejected. Stripe still fits subscriptions, metering, invoicing, tax, Checkout, Customer Portal, and webhook-driven entitlement sync.

### 3. Build a fully custom billing UI without Checkout or Customer Portal

Rejected. That would expand scope and discard the strongest parts of Stripe's hosted billing surface without a clear benefit.
