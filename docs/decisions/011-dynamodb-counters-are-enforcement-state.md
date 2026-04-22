# ADR-011: DynamoDB counters are enforcement state, not billing truth

## Status

Accepted

## Decision

DynamoDB remains the source of truth for request-time enforcement and platform
usage counters, but not for final commercial billing truth.

## Consequences

- Credits and quotas can still be enforced synchronously in Prontiq.
- Canonical architecture docs must distinguish platform counters from Lago
  billing truth.
