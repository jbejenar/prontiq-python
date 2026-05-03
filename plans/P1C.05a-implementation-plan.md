# P1C.05a — Billing Transition Engine And Lago-Safe Plan Changes

## Intent

Make the TypeScript billing transition engine the immutable policy source of
truth for plan transitions. Lago remains provider truth for plans,
subscriptions, invoices, payment state, and Stripe payment rail. Prontiq remains
the enforcement bouncer: API keys, org-level counters, credit buckets,
hot-path locks, deterministic usage forwarding, settlement proof, entitlement
fencing, and reconciliation.

Do not change engine behavior while implementing this ticket. Move/package it,
test it, and make every platform/provider action obey its result exactly.

## Current State

- `POST /v1/account/billing/plan-change` exists and is admin + first-factor
  reverification protected.
- The existing plan-change adapter has a DynamoDB billing-action ledger, an
  org-scoped lock row, provider-in-flight fencing, and replay handling.
- The current implementation still uses the simple Lago native plan assignment
  path and does not yet implement the full engine row-contract matrix.
- Hot-path usage enforcement is still per-key usage-row based; the audited
  target state moves authority to org-level enforcement rows.
- The dropped transition engine is now the policy artefact to package under
  `@prontiq/shared`.

## Constraints

- Every transition, usage counter, bucket, reservation, ledger entry, and
  projector run is scoped to `productPool: "ADDRESS"`.
- Local auth must not trust Lago active subscription while local entitlement is
  fenced.
- Billing cancel means "cancel paid billing / revert to Free"; API keys are
  preserved.

## Core Contracts

The TypeScript billing transition engine is the immutable source of truth for
billing-transition policy.

The engine `tableRow` id is immutable. It is the canonical policy identity for
preview, commit, ledger entries, Lago adapter row contracts, reconciliation,
runbooks, audit logs, and tests.

The platform must not reinterpret, renumber, relabel, reorder, or partially
override engine decisions.

Provider execution may only execute the immutable engine result exactly, or
return `PLAN_TRANSITION_UNSUPPORTED` if Lago or local state cannot safely satisfy
that exact result.

Provider code must never derive an alternative transition row, timing, money
movement, credit movement, refund behavior, key behavior, or provider action
sequence from Lago state.

## Approach

Implement in guarded slices. First package the immutable engine and harden the
existing live mutation gate so unresolved transitions block new different-key
mutations. Then build the richer org-level bouncer, adapter row contracts,
forwarding reservations, payment fencing, and Billing Period Projector behind a
dev allowlist before enabling any row broadly.

## Phases

1. Engine artefact gate
   - Move the engine to `packages/shared/src/billing-transition-engine.ts`.
   - Export it from `@prontiq/shared` and add a direct package export.
   - CI fails if any exported path exposes the legacy shape (`lagoAction`,
     `totalCreditsAfter`) instead of ordered `lagoActions` and canonical credit
     fields.

2. Transition-fenced mutation gate
   - Idempotency scope is `orgId + productPool + route + idempotencyKey`.
   - Same key + same fingerprint returns existing ledger state.
   - Same key + different fingerprint returns
     `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`.
   - Different key while entitlement/provider state is fenced returns
     `BILLING_TRANSITION_IN_PROGRESS`.
   - The adapter must not build a fresh engine `CurrentState` from Lago while the
     local entitlement fence is unresolved.

3. Org-level bouncer
   - Move quota authority to org-level usage/enforcement rows.
   - Per-key rows and snapshots become display/cache only.
   - Add `BillingEntitlementState` and `BillingArrearsState`.
   - Consume carryover, then current allowance, then PAYG billable usage.
   - Normal renewal creates a new allowance bucket, resets org counters,
     advances `periodId`, expires old buckets, and runs exactly once.

4. Lago row contracts
   - Rows 1, 2, 5, 6, 7, 8, and 10 use `MANUAL_TERMINATE_CREATE`.
   - Rows 3, 4, and 9 use Lago native pending plan change only if pending
     state/date verify.
   - Row 11 terminates the pending subscription with `status=pending`.
   - Exact termination flags:
     - Rows 1 and 5: `on_termination_invoice=skip`; no credit note.
     - Rows 2 and 6: `on_termination_invoice=skip` and
       `on_termination_credit_note=skip`.
     - Rows 7, 8, and 10: settle PAYG first, then terminate PAYG with
       `on_termination_invoice=generate` and `on_termination_credit_note=skip`.
   - Same-external-id terminate/create for rows 1, 2, 5, 6, 7, 8, and 10 is a
     Lago dev evidence gate.

5. Settlement, forwarding, and payment fencing
   - Forwarding reservations carry deterministic transaction id, timestamp,
     payload hash, billable range, source metadata, and provider-boundary
     status.
   - Settlement must resolve every reservation state before sending a
     non-overlapping range.
   - Rows 8 and 10 project Free after provider mutation succeeds even if the
     closing PAYG invoice is pending or failed; record `PAYG_ARREARS` and do not
     continue PAYG metering.
   - Row 7 requires both closing PAYG arrears invoice proof and target
     subscription invoice proof before `RECONCILED`.

6. Billing Period Projector and rollout
   - Projector runs for normal renewal, pending activation, immediate
     transition reconciliation, and provider repair.
   - Idempotency key:
     `orgId + productPool + subscriptionExternalId + periodId + projectorReason`.
   - Projector conditionally claims the key before creating buckets, resetting
     counters, expiring carryover, or projecting entitlement.
   - Enable rows only after row checklist passes: engine row, adapter contract,
     same-external-id proof if applicable, invoice proof, no unexpected credit
     notes, settlement/recovery test, projector reconciliation, browser copy,
     and runbook.

## Documentation Updates

- `ARCHITECTURE.MD`: immutable engine contract, org-level bouncer, carryover
  ledger, settlement, payment fencing, Billing Period Projector.
- `ROADMAP.md`, `NEXT-WORK.md`, `NEXT-SESSION.md`: status and rollout evidence.
- New decision record: immutable billing engine plus enforcement ledger.
- `docs/runbooks/console-billing.md`: locks, payment-action handling, provider
  repair, outcome unknown, fenced-transition responses.
- `docs/runbooks/lago-billing-events.md`: V3 cumulative forwarding,
  reservations, payload hash, reservation recovery.
- `docs/runbooks/lago-webhook-reconciliation.md`: payment and projector
  behavior.
- `docs/private-api/account-billing.md`: preview/commit/cancel schemas and
  `BILLING_TRANSITION_IN_PROGRESS`.
- `apps/console/README.md` and `apps/console/HINTS.md`: private API mutation
  pattern and no browser Lago/AWS secret usage.
- Customer-facing billing FAQ/pricing copy: upgrades now, downgrades later,
  money never goes backwards.

## Test Strategy

- Engine artifact contract rejects legacy exported shape.
- Engine matrix covers all 11 rows and canonical outputs.
- Mutation-gate tests reject different idempotency keys while entitlement is
  fenced.
- Adapter tests reject unsupported Lago/provider states.
- Row-contract tests assert exact Lago flags, execution mode, pending
  verification, and same-external-id proof.
- Forwarding tests cover deterministic payload hash, all reservation states,
  recovery ownership, and outcome-unknown recovery.
- PAYG tests cover settlement before termination, closing invoice proof, row 7
  dual invoice proof, rows 8/10 Free projection despite arrears payment failure,
  and no continued PAYG metering.
- Projector tests cover normal renewal and pending activation exactly once.
- Browser tests cover preview modal, scheduled downgrade banner/cancel,
  payment-action redirect, admin-only mutation, member read-only, and no browser
  Lago/AWS secret usage.

## Risk & Rollback

- Duplicate provider mutation: blocked by idempotency scope, org lock,
  provider-in-flight fencing, and fenced-transition gate.
- Lago accepted but local finalization failed: replay returns outcome unknown;
  operator inspects Lago before any new mutation.
- Same-external-id terminate/create unsupported by Lago: affected row remains
  `PLAN_TRANSITION_UNSUPPORTED`.
- Org-level counter migration drift: dual-write for one period, compare, then
  cut over.
- Bad rollout: disable billing plan changes / keep rows allowlisted in dev.

## Open Questions

None for product policy. Implementation row enablement remains gated by Lago dev
evidence.

## Estimate

- Engine packaging + mutation gate: 0.5-1 day.
- Org-level bouncer + event V3/reservations: 2-4 days.
- Lago row-contract adapter + invoice proofs: 2-4 days.
- Billing Period Projector + migration checks: 2-3 days.
- Console/API/docs/smoke: 1-2 days.

## Checklist

| Phase | Files / Areas | Docs |
| --- | --- | --- |
| 1 | `packages/shared` engine export/tests | Yes |
| 2 | `billing-plan-change` store/service/routes/tests | Yes |
| 3 | auth usage enforcement, shared types, quota email/account usage | Yes |
| 4 | Lago adapter, billing ledger, route schemas | Yes |
| 5 | Lago forwarder, event schemas, settlement/invoice proofs | Yes |
| 6 | webhook reconciliation/projector, migration scripts, runbooks | Yes |

`P1C.05a: 6 phases, 12 doc updates, 0 open product-policy questions.`
