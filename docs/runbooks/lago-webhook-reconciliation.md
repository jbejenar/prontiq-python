# Lago Webhook Reconciliation Runbook

Target-state operator guidance for reconciling Lago commercial state back into
Prontiq enforcement state.

## Purpose

In the target commercial architecture:

- Lago owns subscription and billing truth
- Prontiq owns request-time enforcement counters
- webhook reconciliation keeps those two views aligned without putting Lago on
  the hot path

## Scope

This runbook is for the **target Lago path**, not the current live Stripe
billing implementation.

## Expected behavior

1. Lago emits a commercial-state change with `external_id = customerId`.
2. Prontiq webhook handlers validate and normalize the event.
3. The platform updates customer billing state, plan metadata, and any relevant
   enforcement counters or reset markers.
4. Replayed events remain idempotent by provider event ID and internal
   transaction references.

## Customer resolution

1. Read the Lago webhook customer `external_id`.
2. Treat that value as Prontiq `customerId`.
3. Resolve the customer through `prontiq-customers.customerId-index`.
4. If no row exists, or more than one row matches, fail closed and alert for
   operator reconciliation.
5. If Lago's provider-owned `lago_id` differs from cached `lagoCustomerId`, do
   not silently rewrite the mapping; mark the row `migration_conflict` unless
   the operator confirms a legitimate provider-side migration.

Stripe customer IDs are migration/payment-rail linkage only and are not used to
resolve Lago webhooks.

## Verification

- confirm the Lago event resolves to exactly one Prontiq `customerId`
- confirm the resolved row has `lagoExternalCustomerId = customerId`
- confirm billing-state updates are idempotent on replay
- confirm counters and plan metadata converge to the intended state
- confirm no request-path dependency on direct Lago availability
