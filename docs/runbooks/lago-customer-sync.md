# Lago Customer Sync Runbook

Target-state operator guidance for syncing Prontiq customer state with Lago.

## Purpose

In the target commercial architecture:

- Clerk organizations map to Prontiq `customerId`
- Prontiq `customerId` maps 1:1 to Lago `external_id`
- Lago owns subscription and commercial state

## Scope

This runbook is for the **target Lago path**, not the current live Stripe
provisioning flow.

## Customer contract

`customerId` is platform-owned and formatted as `pq_cust_<ulid>`.

The future `prontiq-customers` row is keyed by `orgId` and carries:

- `customerId`
- `lagoExternalCustomerId` equal to `customerId`
- nullable `lagoCustomerId` for Lago's provider-owned `lago_id`
- nullable `stripeCustomerId` for migration/payment-rail linkage
- `ownerEmail`
- `status`: `active`, `archived`, or `migration_conflict`
- `createdAt` / `updatedAt`

Do not use Clerk `orgId`, Stripe `cus_...`, or Lago `lago_id` as the Prontiq
customer primary key.

## Expected behavior

1. Customer is created or resolved from `prontiq-customers` by Clerk `orgId`.
2. Lago customer exists with `external_id = customerId`.
3. Subscription changes reconcile back into Prontiq enforcement counters.

## Backfill procedure

1. Resolve the Clerk org and read `prontiq-customers` by `orgId`.
2. If a row exists, preserve `customerId` and only update unambiguous provider
   linkage.
3. If no row exists, read `ORG#{orgId}` from `prontiq-keys`, preserve
   `ownerEmail` and `stripeCustomerId`, and create one `pq_cust_<ulid>` for the
   org.
4. If duplicate `orgId`, duplicate `stripeCustomerId`, or mismatched existing
   `customerId` evidence is found, set `status = "migration_conflict"` with
   `conflictReason`.
5. Do not create or mutate the Lago customer while the mapping is in
   `migration_conflict`.

## Lago creation / lookup

1. Look up Lago customer by `external_id = customerId`.
2. If found, cache Lago's provider id in `lagoCustomerId` when absent.
3. If not found and `status = "active"`, create the Lago customer with
   `external_id = customerId`.
4. If Lago returns a customer whose `external_id` differs from `customerId`, fail
   closed and mark the Prontiq mapping `migration_conflict`.

## Verification

- confirm Clerk org resolves to one active `prontiq-customers` row
- confirm Lago customer exists with `external_id = customerId`
- confirm Lago `lago_id` is cached only as `lagoCustomerId`
- confirm no customer-table read is required by API-key request auth
- confirm Prontiq counters reconcile after plan changes or period resets
