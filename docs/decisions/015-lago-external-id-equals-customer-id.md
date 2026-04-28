# ADR-015: Lago external ID equals Prontiq customerId

## Status

Superseded by [ADR-035](035-clerk-org-commercial-identity.md) for active runtime.

This ADR is retained as historical P1B.14-P1B.21 migration context only. Active
Lago customers now use `external_id = orgId`, not generated `customerId`. Active
Lago subscriptions use `external_id = lago_sub_${orgId}`.

## Context

Lago has a provider-owned customer identifier, commonly exposed as `lago_id`, and an application-provided customer identifier, `external_id`. Prontiq needs stable reconciliation between Lago webhooks, billing-event forwarding, console billing state, and migration-era Stripe linkage.

## Decision

Historical P1B.14-P1B.21 decision: set Lago customer `external_id` to
Prontiq's platform-owned `customerId`.

```text
lagoExternalCustomerId = customerId
lagoCustomerId = Lago provider-owned lago_id, stored as nullable cache data
```

Prontiq resolves Lago webhook and API responses by `external_id` first. `lagoCustomerId` may be cached for diagnostics or direct-provider calls, but it is not canonical customer identity.

## Considered and Rejected

- `external_id = orgId`: historically rejected because it leaks the auth-provider identifier into commercial identity and conflicts with ADR-013. Reconsidered and accepted by ADR-035 before production because it removes unnecessary mapping state and aligns Clerk, platform enforcement, and Lago.
- `external_id = stripeCustomerId`: rejected because Stripe is migration-era/payment-rail linkage only.
- Use Lago `lago_id` as the only join key: rejected because Prontiq needs to identify customers before Lago creation and during provider outage/retry windows.

## Consequences

- Historical Lago customer creation was idempotent around `external_id = customerId`.
- Active Lago customer creation is idempotent around `external_id = orgId`.
- Active Lago webhooks resolve customers by Clerk `orgId`; mismatched external IDs still fail closed for operator review.
