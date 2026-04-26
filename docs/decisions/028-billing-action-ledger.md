# DEC-028: Billing Action Ledger

## Status

Accepted.

## Question

How should Prontiq make account billing mutations replay-safe?

## Decision

Mutating account billing routes write a DynamoDB action record keyed by a stable
hash of `orgId`, route, and `Idempotency-Key`. The record stores request hash,
actor, customer, target plan, provider status, response body, and terminal
status.

Successful terminal rows are replayable only when they include a stored response
body. Permanent failure rows replay as the stored failure, not as a successful
empty response. Retryable failure rows, and stale `processing` rows whose lease
has expired, may be conditionally reclaimed by the same idempotency key plus the
same request hash. When Lago has accepted a plan change but a later local write
fails, the ledger stores the provider subscription outcome so retry can resume
local metadata repair without resubmitting the provider mutation. Different
request hashes always remain conflicts.

Plan-change handlers consult the ledger before applying local no-op or pending
transition guards. This preserves replay/resume semantics after an earlier
successful action has written pending transition metadata. New idempotency keys
remain blocked by the pending-transition guard.

Portal-session and plan-change handlers also consult existing ledger evidence
before live Lago reads. Stored successful responses, stored permanent failures,
and provider-accepted resume state must be available even when Lago is
temporarily unavailable. For fresh plan-change actions, pending transition
metadata is checked before the no-op branch so an already-scheduled downgrade is
not misreported as an unchanged current-plan no-op.

## Considered and Rejected

- Trusting browser retries not to duplicate work: rejected because billing
  mutations need explicit replay safety.
- Using only Lago-side idempotency: rejected because Prontiq needs its own audit
  trail and request/body conflict detection.
- Reusing webhook ledgers: rejected because webhook delivery evidence and
  customer-initiated billing actions have different keys and lifecycles.

## Consequences

- `prontiq-billing-actions` is retained as audit evidence.
- Same idempotency key plus same request returns the stored response.
- Same idempotency key plus same request can retry after a retryable provider or
  local failure.
- Same idempotency key plus same request can replay or resume even after local
  pending transition metadata exists.
- Same idempotency key plus stored replay/resume evidence does not require live
  Lago availability.
- Same idempotency key plus a prior permanent failure returns the stored
  failure rather than resubmitting the provider mutation.
- Same idempotency key plus different request returns `IDEMPOTENCY_CONFLICT`.
- Fresh current-plan requests return `PLAN_CHANGE_ALREADY_PENDING` rather than
  `noop` when a different Lago transition is already pending.
- Ledger rows are not deleted during rollback.
