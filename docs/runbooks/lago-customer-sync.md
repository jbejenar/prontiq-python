# Lago Customer Sync Runbook

Target-state operator guidance for syncing Prontiq customer state with Lago.

## Purpose

In the target commercial architecture:

- Clerk organizations map to Prontiq `customerId`
- Prontiq `customerId` maps 1:1 to Lago customer identity
- Lago owns subscription and commercial state

## Scope

This runbook is for the **target Lago path**, not the current live Stripe
provisioning flow.

## Expected behavior

1. Customer is created or resolved from org-scoped `customerId`.
2. Lago customer exists with the same external identifier.
3. Subscription changes reconcile back into Prontiq enforcement counters.

## Verification

- confirm Clerk org resolves to a single `customerId`
- confirm Lago customer exists for that `customerId`
- confirm Prontiq counters reconcile after plan changes or period resets
