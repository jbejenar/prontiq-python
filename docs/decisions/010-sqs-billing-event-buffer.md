# ADR-010: SQS buffers billing events away from the Prontiq hot path

## Status

Accepted

## Decision

Prontiq's request path emits billing events into a durable queue instead of
calling the billing system directly.

## Consequences

- Lago availability does not sit on the request hot path.
- Billing forwarding becomes replayable and independently operable.
- `prontiq-platform` owns the durable queue; `prontiq-lago` does not.
