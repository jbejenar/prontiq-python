# DEC-018: Lago Events Carry Credit Deltas

## Status

Accepted.

## Context

Prontiq's public usage unit is credits. `BillingUsageEventV1` already carries
the endpoint-weighted `creditDelta` emitted after DynamoDB request-time
enforcement succeeds.

Lago billable metrics can aggregate event properties. P1B.16 needs a stable
payload contract for address usage without exposing request metadata.

## Decision

Send one Lago usage event per accepted billing event with:

- `code = meterEventName`
- `properties.credits = creditDelta`
- aggregation configured in Lago as a sum of the `credits` property

The worker does not send raw API-key hashes, key prefixes, URLs, headers, query
strings, IPs, user agents, or response payloads to Lago.

## Considered And Rejected

- **Send raw request count and let Lago apply endpoint weights.** Rejected
  because endpoint weights are a Prontiq enforcement contract and must match
  request-time counters exactly.
- **Send cumulative monthly totals.** Rejected for P1B.16 because the queue
  already contains event deltas, and cumulative semantics would need a separate
  watermark and repair model.
- **Send per-endpoint properties beyond credits.** Rejected for v1 to keep the
  external payload minimal and avoid leaking operational request context.

## Consequences

- Lago metrics must sum `properties.credits`.
- Credit-weight changes are applied in Prontiq code/config, not retroactively in
  Lago metric formulas.
- Historical event replay preserves the original charged credit delta.
