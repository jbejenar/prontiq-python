# DEC-038: Usage Charts Use Prontiq Projection, Not Lago Delivery State

## Status

Accepted.

## Context

Lago is the commercial system of record for plans, subscriptions, invoices, and
payment state. Prontiq is still the API bouncer: it authenticates keys, applies
rate limits, increments local counters, and enforces quota before a request is
served.

The console usage page needs chartable daily/weekly/monthly data. The existing
`prontiq-usage` table has authoritative counters, but only at key/scope level.
The Lago delivery ledger records async billing-event forwarding, but `accepted`
delivery is not the same thing as platform-enforced usage.

## Decision

P1C.04 adds a Prontiq-owned `prontiq-usage-daily` projection. The Lago event
forwarder updates this projection idempotently from the same billing-event SQS
messages it sends to Lago.

The console usage API uses:

- `prontiq-usage` for authoritative current-period totals.
- `prontiq-usage-daily` for chart buckets.
- Lago-projected org envelope fields for entitlements and billing-period
  labels.

When `prontiq-usage-daily` has no rows for a product, or its projected total is
behind current-period `prontiq-usage` counters, the API prepends a `Before chart
tracking` baseline point for the missing delta and still returns the projected
daily/weekly buckets that do exist. If projected buckets exceed authoritative
counters, the API returns one authoritative `Current period` total point instead
of over-reporting. This is a presentation fallback only; it does not backfill
daily buckets or change the async projection contract.

Only active `BillingUsageEventV2` events are projected into
`prontiq-usage-daily`. Legacy `BillingUsageEventV1` messages are still accepted
for safe drain/replay to Lago, but they are not a valid source for org-scoped
dashboard buckets.

## Considered And Rejected

- **Read chart data from Lago.** Rejected because Lago must not be on the
  console hot read path for usage and may lag behind local enforcement.
- **Use only accepted Lago delivery rows.** Rejected because delayed Lago
  forwarding would hide usage that Prontiq already enforced.
- **Write daily buckets in the address API request path.** Rejected because the
  address API should do only the enforcement counter write before serving data.

## Consequences

- Usage cards can show counter totals while charts lag the SQS worker; in that
  case the chart shows a baseline delta plus any projected buckets until
  projected bucket totals match authoritative counters.
- The chart starts from post-deploy projected events; no historical backfill is
  part of v1.
- Duplicate SQS deliveries must not double-count chart buckets; the projection
  uses a `usageAnalyticsAppliedAt` sentinel on the billing-event ledger row.
- In Lago-period mode, keys with stale or missing period projection surface
  `mixed_key_periods`; their stale/calendar fallback counters are not silently
  added to current-period cards.
