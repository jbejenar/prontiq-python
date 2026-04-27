# DEC-020: Minimal Lago Usage Event Payload

## Status

Accepted; identity fields updated by [ADR-035](035-clerk-org-commercial-identity.md).

The minimal-payload rule remains active, but the active identity is now Clerk
`orgId` and the active Lago subscription external id is
`lago_sub_${orgId}`. Any `pq_cust_*` / `pq_sub_*` examples below are historical
P1B.16-P1B.21 context only.

## Context

Billing events contain operational metadata used by Prontiq for enforcement and
repair. Lago only needs the fields required to meter usage against the canonical
customer subscription.

## Decision

The P1B.16 worker sends the minimal Lago usage event payload:

```json
{
  "event": {
    "transaction_id": "bevt_...",
    "external_subscription_id": "pq_sub_...",
    "code": "prontiq_address_requests",
    "timestamp": 1777075200,
    "properties": {
      "credits": 3
    }
  }
}
```

The worker authenticates with the Lago API key using `Authorization: Bearer` and
posts to `/api/v1/events`.

## Considered And Rejected

- **Forward the entire `BillingUsageEventV1`.** Rejected because it contains
  platform-only repair metadata and API-key-derived fields that Lago does not
  need.
- **Add request source metadata as Lago properties.** Rejected because the v1
  billing contract is credit metering, not analytics export.
- **Use Lago batch ingestion in P1B.16.** Rejected because SQS batch handling and
  per-record failure reporting already provide controlled batching; individual
  sends make idempotent retry boundaries simpler.

## Consequences

- The external billing payload is intentionally small and privacy-preserving.
- Any future analytics export to Lago or another warehouse needs a separate
  decision and schema.
- The worker can use SQS partial batch responses without ambiguous batch-level
  failure semantics.
