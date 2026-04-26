# DEC-029: Lago Plan Transition Semantics

## Status

Accepted.

## Question

When Lago reports a pending subscription transition, should Prontiq immediately
mutate request-time entitlements?

## Decision

No. Pending Lago transitions update pending metadata only. Prontiq changes local
request-time entitlements only when Lago reports the active replacement
subscription state. A `subscription.terminated` event downgrades to Free only
when no active replacement snapshot is returned.

## Considered and Rejected

- Downgrade on any `pending`, `canceled`, or `terminated` snapshot: rejected
  because Lago upgrade/downgrade flows can expose transitional states before the
  replacement entitlement is active.
- Ignore pending transitions entirely: rejected because the console needs to
  show scheduled changes.
- Make the API read Lago synchronously on every request: rejected because Lago
  remains off the API hot path.

## Consequences

- Local `tier`, products, quota, rate limit, billing period, and overdue state
  remain unchanged while a transition is pending.
- Pending fields are denormalized on both the org envelope and API-key records
  for consistent account billing UI, support, and debugging views.
- Webhook replay is the convergence mechanism after Lago state changes.
