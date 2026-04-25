# ADR-016: Standard SQS for billing event buffer

## Status

Accepted

## Question

Should the P1B.15 billing-event buffer use a standard SQS queue or a FIFO SQS
queue?

## Decision

Use a standard SQS queue with a DLQ. Event idempotency is owned by the
deterministic `BillingUsageEventV1.eventId` contract, not by queue-level
deduplication.

## Considered and rejected

- FIFO SQS: rejected for v1 because strict queue ordering is not required by
  Lago metering, FIFO throughput limits are unnecessary friction, and changing
  queue type later requires replacement.
- Direct Lago call from the API handler: rejected because Lago availability must
  not sit on the request hot path.

## Consequences

- Consumers must treat duplicate delivery as normal and use `eventId` as the
  idempotency key.
- Operators may replay messages from the source queue or DLQ without creating
  new Lago transaction IDs.
- Message order is not contractual; downstream P1B.16 must not depend on it.
