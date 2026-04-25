# DEC-017: Deterministic Lago Subscription External ID

## Status

Accepted.

## Context

Lago usage events require a subscription identity. The platform's durable
commercial identity is `customerId` (`pq_cust_<ulid>`), not Clerk `orgId`,
Stripe `cus_...`, or Lago's provider-owned `lago_id`.

P1B.16 needs a subscription identifier that can be derived by the worker without
adding request-path reads or mutable provider lookups to replay handling.

## Decision

Derive the Lago `external_subscription_id` from the platform customer ID:

```text
pq_cust_<ulid> -> pq_sub_<ulid>
```

The worker rejects malformed customer IDs before sending a usage event.
Canonical Lago setup must create subscriptions with the same external
subscription ID.

## Considered And Rejected

- **Use Clerk `orgId`.** Rejected because Clerk is identity infrastructure, not
  the commercial customer contract, and org IDs cannot represent migration
  linkages cleanly.
- **Use Stripe subscription ID.** Rejected because Stripe is being reduced to
  payment rail only and subscription IDs may disappear during the Lago cutover.
- **Read Lago subscription IDs at forward time.** Rejected because replay safety
  should not depend on provider lookup availability or mutable provider-owned
  identifiers.

## Consequences

- Event replay can rebuild the exact Lago payload from the queued event.
- Operators must ensure canonical Lago subscriptions use the derived
  `pq_sub_<ulid>` external ID before enabling `BILLING_EVENTS_ENABLED`.
- If Prontiq later supports multiple simultaneous Lago subscriptions per
  customer, a new decision record must define the discriminator.
