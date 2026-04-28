# DEC-017: Deterministic Lago Subscription External ID

## Status

Superseded by [ADR-035](035-clerk-org-commercial-identity.md) for active runtime.

This ADR is retained as historical P1B.16-P1B.21 migration context only. Active
Lago subscriptions now use `external_id = lago_sub_${orgId}` and Lago customers
use `external_id = orgId`.

## Context

Lago usage events require a subscription identity. The platform's durable
commercial identity is `customerId` (`pq_cust_<ulid>`), not Clerk `orgId`,
Stripe `cus_...`, or Lago's provider-owned `lago_id`.

P1B.16 needs a subscription identifier that can be derived by the worker without
adding request-path reads or mutable provider lookups to replay handling.

## Decision

Historical P1B.16-P1B.21 decision: derive the Lago
`external_subscription_id` from the platform customer ID:

```text
pq_cust_<ulid> -> pq_sub_<ulid>
```

The worker rejects malformed customer IDs before sending a usage event.
Canonical Lago setup must create subscriptions with the same external
subscription ID.

## Considered And Rejected

- **Use Clerk `orgId`.** Historically rejected because Clerk was treated as
  identity infrastructure, not the commercial customer contract, and org IDs
  could not represent migration linkages cleanly. Reconsidered and accepted by
  ADR-035 before production as `lago_sub_${orgId}`.
- **Use Stripe subscription ID.** Rejected because Stripe is being reduced to
  payment rail only and subscription IDs may disappear during the Lago cutover.
- **Read Lago subscription IDs at forward time.** Rejected because replay safety
  should not depend on provider lookup availability or mutable provider-owned
  identifiers.

## Consequences

- Historical event replay rebuilt Lago payloads from generated `pq_sub_<ulid>`.
- Active event replay rebuilds Lago payloads from `lago_sub_${orgId}`.
- Operators must ensure canonical Lago subscriptions use `lago_sub_${orgId}`.
- If Prontiq later supports multiple simultaneous Lago subscriptions per
  customer, a new decision record must define the discriminator.
