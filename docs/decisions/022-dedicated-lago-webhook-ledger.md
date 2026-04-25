# DEC-022: Dedicated Lago Webhook Ledger

## Status

Accepted.

## Context

Lago webhook reconciliation mutates local enforcement state. Replayed events,
same-key payload conflicts, and drift failures need durable evidence without
overloading existing Stripe webhook markers or billing-event delivery records.

## Decision

Store Lago webhook processing evidence in `prontiq-lago-webhook-events` keyed by
Lago `X-Lago-Unique-Key`.

Rows store payload hash, event type, processing status, customer/org resolution,
timestamps, truncated error detail, and 30-day TTL.

## Considered And Rejected

- **Reuse `prontiq-keys` reserved webhook marker rows.** Rejected because the
  Stripe marker shape is tied to Stripe event ids and org resolution. Lago has a
  separate unique-key and drift model.
- **Reuse `prontiq-billing-event-deliveries`.** Rejected because that table is
  outbound usage-event delivery evidence keyed by Prontiq `eventId`, not inbound
  commercial-state reconciliation.
- **No ledger, rely on idempotent target writes only.** Rejected because
  same-key/different-payload conflicts and in-flight duplicate behavior would be
  invisible.

## Consequences

- Deploy role policy must allow the new DynamoDB table.
- Operators have a single table to inspect for Lago webhook replay/drift.
- The webhook can return 200 for completed/ignored duplicates and 500 for fresh
  in-flight duplicates so Lago retries later.
