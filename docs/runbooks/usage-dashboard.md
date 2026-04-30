# Usage Dashboard Runbook

## Contract

The console usage page reads `GET /v1/account/usage`.

- Current usage totals are summed from `prontiq-usage` for the active org
  billing period. Stale key-period counters are excluded from current cards and
  surfaced via `scopeConsistency = mixed_key_periods`. Keys missing their
  Lago-period projection are also treated as drift; calendar fallback counters
  are not silently added to Lago-period cards.
- Chart buckets are read from `prontiq-usage-daily`.
- Entitlements and billing-period labels come from Lago-projected org envelope
  fields.

Lago remains commercial truth. Prontiq remains enforced usage truth.

## Projection Lag

If cards update but charts do not:

1. Confirm the address API request succeeded and returned a request id.
2. Confirm `BILLING_EVENTS_ENABLED=true`.
3. Check billing-event SQS queue age and DLQ alarms.
4. Check `PqLagoEventForwarder` logs for projection or Lago delivery failures.
5. Confirm `prontiq-billing-event-deliveries` has the event id.
6. Confirm the ledger row has `usageAnalyticsAppliedAt`.

The chart starts from post-P1C.04 projected events. Pre-existing usage counters
are not backfilled into chart buckets in v1.

## Counter / Projection Mismatch

Counters are authoritative. A chart bucket mismatch usually means projection
lag, a DLQ message, or pre-deploy usage.

If `scopeConsistency = mixed_key_periods`, Lago reconciliation has not yet
projected the active billing period onto every key, or one or more keys are
missing the period projection entirely. Do not add stale key-period or calendar
fallback counters into current cards. Re-run or replay the Lago entitlement
reconciliation path so key records converge to the org envelope period.

Do not edit `prontiq-usage` manually to make charts match. Replay the original
billing event only after preserving the original `eventId`.

## Invalid Scope

The worker marks events with invalid `usageScope` as `invalid` and does not send
them to Lago. This is an internal contract bug. Fix the emitter or shared scope
helper before replay.

## Smoke

1. Use a labelled dev test org.
2. Create or reuse an API key.
3. Make 10 address API calls.
4. Verify usage cards increase by 10.
5. Wait up to 1 minute and verify the daily chart bucket increases by 10.
6. Export CSV and confirm `date,product,credits` totals.
