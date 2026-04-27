# ADR-035: Clerk org ID is the active commercial identity

## Status

Accepted on 2026-04-27.

## Context

P1B.14-P1B.21 introduced a generated Prontiq `customerId`
(`pq_cust_<ulid>`) plus `prontiq-customers` as the commercial identity layer.
Before production customer traffic, we chose to simplify the model.

The active product shape is:

- Clerk owns users and organizations.
- Lago owns billing state and subscriptions.
- Stripe is only Lago's payment rail.
- Prontiq owns API keys and hot-path credit enforcement.

## Decision

Use the Clerk organization id as the active commercial customer identity.

- Lago customer `external_id = orgId`.
- Lago subscription `external_id = lago_sub_${orgId}`.
- `BillingUsageEventV2` carries `orgId`, not `customerId`.
- `/v1/account/setup` returns `orgId`.
- `/v1/account/billing*` is retired from the AWS private API.
- `prontiq-customers`, `pq_cust_*`, and `pq_sub_*` remain legacy migration
  evidence only.

## Considered And Rejected

- Keep generated `pq_cust_*`: rejected because it adds a mapping table and
  repair path before the product has production customers.
- Use Stripe customer id: rejected because Stripe is not the billing system of
  record.
- Use Lago provider ids: rejected because Lago ids are provider-owned and not
  present at Clerk provisioning time.

## Consequences

Console billing should be implemented later as a Vercel server-side BFF that
verifies Clerk auth, reads the active `org_id`, and calls Lago with a server-held
Lago API key. The browser must not receive a Lago API key.
