# ADR-014: Dedicated customer mapping table

## Status

Superseded by [ADR-035](035-clerk-org-commercial-identity.md) for active runtime.

This ADR is retained as historical P1B.14-P1B.21 migration context only. Active
commercial identity is stored on `ORG#{orgId}` envelopes and `prontiq-customers`
is legacy evidence, not the active mapping table. Lago customer
`external_id = orgId`; Lago subscription `external_id = lago_sub_${orgId}`.

## Context

The existing `ORG#{orgId}` envelope in `prontiq-keys` is a provisioning marker and operational snapshot created by the Clerk webhook and account-setup recovery path. It was not designed to be the canonical customer mapping across Clerk, Prontiq, Lago, and Stripe.

The Lago migration needs deterministic reverse lookups by platform customer ID, conflict handling during backfill, and a clean separation between customer identity, API key metadata, usage counters, and provider webhook markers.

## Decision

Historical P1B.14-P1B.21 decision: create a dedicated `prontiq-customers` table
as part of the Lago migration runtime substrate.

Target table shape:

```text
Table: prontiq-customers
PK: orgId
GSI: customerId-index (customerId)

Attributes:
  orgId                    string
  customerId               string  // pq_cust_<ulid>
  lagoExternalCustomerId   string  // equals customerId
  lagoCustomerId           string? // Lago provider-owned lago_id cache
  stripeCustomerId         string? // migration/payment-rail linkage
  ownerEmail               string
  status                   "active" | "archived" | "migration_conflict"
  createdAt                ISO timestamp
  updatedAt                ISO timestamp
  backfilledAt             ISO timestamp?
  archivedAt               ISO timestamp?
  conflictReason           string?
```

Runtime code must denormalize `customerId` onto `ORG#{orgId}` envelopes and API
key records so API-key-authenticated requests can emit billing events without
reading `prontiq-customers` on the hot path. P1B.15 implements that substrate
for new provisioning and provides `backfill:customers` for legacy records.

## Considered and Rejected

- Reuse `ORG#{orgId}` in `prontiq-keys` as the canonical customer table: historically rejected because it mixes provisioning state, Stripe-era linkage, and customer identity in the key table. Reconsidered and accepted by ADR-035 before production because the Clerk org is now the commercial identity and the envelope is the local enforcement snapshot.
- Store only in Lago: rejected because Lago must not be on the request path and Prontiq must own customer identity during provider outages or migrations.
- Store only on API key records: rejected because customer identity must also exist before the first key and must be resolvable for Clerk-authenticated console actions.

## Consequences

- `P1B.15` added `prontiq-customers` and `customerId-index`; active code no longer depends on them.
- Future cleanup/account-deletion code may need to purge retained legacy rows, but must not read `prontiq-customers` for active identity.
- Hot-path billing emission uses `orgId`, not a customer-table lookup.
