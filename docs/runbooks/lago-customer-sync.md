# Lago Customer Sync Runbook

Target-state operator guidance for syncing Prontiq customer state with Lago.

## Purpose

In the target commercial architecture:

- Clerk organizations map to Prontiq `customerId`
- Prontiq `customerId` maps 1:1 to Lago `external_id`
- Default Lago subscription external IDs are derived as
  `pq_cust_<ulid> -> pq_sub_<ulid>`
- Lago owns subscription and commercial state

## Scope

This runbook is for the **target Lago path**, not the current live Stripe
provisioning flow.

## Customer contract

`customerId` is platform-owned and formatted as `pq_cust_<ulid>`.

The `prontiq-customers` row is keyed by `orgId` and carries:

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
3. Lago subscription exists with `external_id = pq_sub_<same ulid as customerId>`.
4. Subscription changes reconcile back into Prontiq enforcement counters through
   `POST /webhooks/lago`.

## Backfill procedure

1. Run `CUSTOMERS_TABLE_NAME=<table> KEYS_TABLE_NAME=<table> pnpm --filter @prontiq/control-plane backfill:customers` for a dry run.
2. Resolve the Clerk org and read `prontiq-customers` by `orgId`.
3. If a row exists, preserve `customerId` and only update unambiguous provider
   linkage.
4. If no row exists, read `ORG#{orgId}` from `prontiq-keys`, preserve
   `ownerEmail`, preserve string `stripeCustomerId` when present, store
   `stripeCustomerId = null` when it is absent, and create one
   `pq_cust_<ulid>` for the org.
5. The backfill checks duplicate provider linkage across both scanned
   `ORG#{orgId}` envelopes and existing `prontiq-customers` rows. If duplicate
   `orgId`, duplicate non-null `stripeCustomerId`, mismatched existing
   customer-row `customerId`, or API-key-level `customerId` mismatch is found,
   leave denormalized key/envelope values untouched and set
   `status = "migration_conflict"` with `conflictReason` for every involved
   org. Null or missing Stripe linkage is valid migration input and is ignored
   by duplicate-linkage detection.
6. Apply with `CUSTOMERS_TABLE_NAME=<table> KEYS_TABLE_NAME=<table> pnpm --filter @prontiq/control-plane backfill:customers -- --apply`.
7. Do not create or mutate the Lago customer while the mapping is in
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
- confirm Lago subscription external id is derived from the same customer ULID
- confirm Lago `lago_id` is cached only as `lagoCustomerId`
- confirm no customer-table read is required by API-key request auth
- confirm Prontiq counters reconcile after plan changes or period resets
