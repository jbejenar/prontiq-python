# DEC-028: Billing Action Ledger

## Status

Accepted. Reused by DEC-040 for Vercel console billing mutations.

## Question

How should Prontiq make account billing mutations replay-safe?

## Decision

Mutating account billing routes write a DynamoDB action record keyed by a stable
hash of `orgId`, route, and `Idempotency-Key`. The record stores request hash,
actor, customer, target plan, provider status, response body, and terminal
status.

Successful terminal rows are replayable only when they include a stored response
body. Permanent failure rows replay as the stored failure, not as a successful
empty response. Ambiguous provider outcomes are stored as terminal
`outcome_unknown` rows and replay as controlled failures; operators must inspect
Lago before a new plan-change attempt. Only explicitly retryable local failures
and stale pre-provider `processing` rows whose lease has expired may be
conditionally reclaimed by the same idempotency key plus the same request hash.
Before any non-idempotent provider mutation, the action moves to
`provider_in_flight` with a per-attempt token. `provider_in_flight` is
manual-reconcile evidence, not a retryable lease. When Lago has accepted a plan
change but a later local write fails, the ledger does not mark the action
failed; the route returns a finalize error and future retries block on
inspection of Lago state. Different request hashes always remain conflicts.

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

- `prontiq-billing-actions` is retained and reused as audit/replay evidence for
  Vercel console billing mutations.
- Same idempotency key plus same request returns stored terminal evidence.
- Same idempotency key plus same request can retry only after explicitly
  retryable local failures or stale pre-provider `processing` leases.
- Same idempotency key plus a `provider_in_flight` action returns a
  manual-reconcile response and does not resubmit the provider mutation.
- Same idempotency key plus same request can replay or resume even after local
  pending transition metadata exists.
- Same idempotency key plus stored replay/resume evidence does not require live
  Lago availability.
- Same idempotency key plus a prior permanent failure returns the stored
  failure rather than resubmitting the provider mutation.
- Same idempotency key plus a prior `outcome_unknown` failure returns the stored
  failure and does not resubmit the provider mutation.
- Same idempotency key plus different request returns `IDEMPOTENCY_CONFLICT`.
- Fresh current-plan requests return `PLAN_CHANGE_ALREADY_PENDING` rather than
  `noop` when a different Lago transition is already pending.
- Ledger rows are not deleted during rollback.
