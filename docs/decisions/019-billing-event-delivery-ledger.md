# DEC-019: Billing Event Delivery Ledger

## Status

Accepted.

## Context

SQS redelivery, Lambda retries, and operator replays are expected in the
billing-event path. Lago deduplicates usage events by transaction identity, but
Prontiq also needs local evidence of delivery attempts, accepted events, and
payload conflicts.

## Decision

Create a dedicated DynamoDB delivery ledger:

```text
prontiq-billing-event-deliveries
prontiq-billing-event-deliveries-<stage>
```

The primary key is `eventId`. Each row stores the payload hash, status,
attempt count, timestamps, selected customer/meter metadata, Lago external
subscription ID, and a TTL. The GSI `customerId-acceptedAt-index` supports
customer-scoped operational review after Lago acceptance.

Malformed JSON and schema-invalid payloads do not receive ledger rows because
their event identity fields are not trustworthy. Schema-valid events whose
`eventId` does not match the deterministic contract are recorded as `invalid`.
Delivery-ledger transitions are terminal-state aware. Later failure writes do
not downgrade accepted or permanent-failure rows, and later success writes do
not overwrite permanent-failure or invalid rows. If a duplicate worker reaches
Lago successfully after another worker has already recorded terminal local
failure evidence, the terminal row is preserved and the SQS record is
acknowledged to avoid a retry loop.

Lago `400` and specific non-duplicate `422` validation responses are treated as
permanent event-contract failures. A Lago `422` duplicate-transaction response,
or an ambiguous `422` followed by successful
`GET /api/v1/events/{transaction_id}` confirmation for the same transaction and
external subscription, is treated as idempotent success because it means Lago
already received the event. Auth, setup, rate-limit, provider, network,
timeout, and ambiguous unconfirmed responses are retryable so operators can fix
Lago configuration and replay source/DLQ messages without editing DynamoDB
ledger rows.

## Considered And Rejected

- **Rely only on Lago idempotency.** Rejected because operators still need local
  retry evidence, DLQ triage context, and payload-conflict detection.
- **Store delivery state in `prontiq-usage`.** Rejected because usage counters
  are the hot-path enforcement state; delivery evidence is a different lifecycle.
- **Use CloudWatch logs only.** Rejected because logs are not a structured
  replay ledger and are harder to query per event/customer.

## Consequences

- P1B.16 can safely skip already accepted events without resending.
- Payload hash conflicts are visible locally and are treated as invalid replay
  evidence.
- Ledger `attempts` counts worker attempts that reached the Lago-send phase;
  failure marking does not double-count a send. It is local delivery evidence,
  not a provider-side accepted-event counter.
- The deploy role must be allowed to create/update the new DynamoDB table.
- Permanent rows are intentionally narrow; over-classifying auth/setup failures
  as terminal would strand recoverable billing events.
