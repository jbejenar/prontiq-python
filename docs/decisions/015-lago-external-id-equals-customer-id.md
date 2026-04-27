# ADR-015: Lago external ID equals Prontiq customerId

## Status

Superseded by [ADR-035](035-clerk-org-commercial-identity.md) for active runtime.

This ADR is retained as historical P1B.14-P1B.21 migration context only. Active
Lago customers now use `external_id = orgId`, not generated `customerId`.

## Context

Lago has a provider-owned customer identifier, commonly exposed as `lago_id`, and an application-provided customer identifier, `external_id`. Prontiq needs stable reconciliation between Lago webhooks, billing-event forwarding, console billing state, and migration-era Stripe linkage.

## Decision

Set Lago customer `external_id` to Prontiq's platform-owned `customerId`.

```text
lagoExternalCustomerId = customerId
lagoCustomerId = Lago provider-owned lago_id, stored as nullable cache data
```

Prontiq resolves Lago webhook and API responses by `external_id` first. `lagoCustomerId` may be cached for diagnostics or direct-provider calls, but it is not canonical customer identity.

## Considered and Rejected

- `external_id = orgId`: rejected because it leaks the auth-provider identifier into commercial identity and conflicts with ADR-013.
- `external_id = stripeCustomerId`: rejected because Stripe is migration-era/payment-rail linkage only.
- Use Lago `lago_id` as the only join key: rejected because Prontiq needs to identify customers before Lago creation and during provider outage/retry windows.

## Consequences

- Lago customer creation must be idempotent around `external_id = customerId`.
- Lago webhooks must resolve to Prontiq customers through `lagoExternalCustomerId` / `customerId`.
- If Lago returns a mismatched `external_id`, reconciliation must fail closed and require operator review rather than mutating a different customer.
