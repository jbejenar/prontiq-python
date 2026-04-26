# P1B.11 Implementation Plan

> Historical implementation plan. P1B.20 later removed the platform-owned
> Stripe billing cron and month-close deploys; Lago now owns billing-period
> reconciliation.

## Intent

Implement P1B.11 so a dedicated monthly Lambda finalizes the previous month's billable usage at `00:30 UTC` on day 1, pushes any remaining Stripe meter delta exactly once, then marks the current-hash previous-month scope `closed=true` so the hourly billing cron stops revisiting it permanently.

## Current State

- At the time this plan was written,
  `packages/control-plane/src/billing-cron.ts` was the live hourly Stripe
  metering path. This is historical context only after P1B.20.
- Replay-safe meter pushes already exist on the current-hash usage row through:
  - `pendingMeterEventIdentifier`
  - `pendingMeterTargetCumulativeCount`
  - `lastPushedCumulativeCount`
- `UsageCounterRecord.closed?: boolean` already exists and is already respected by the hourly cron and key rotation flow.
- At the time this plan was written, `sst.config.ts` wired `PqBillingCron`
  only; there was no dedicated month-close Lambda, schedule, alarm, or runbook
  yet.

## Constraints

- No public API or billing-catalog changes.
- No schema migration or new required table attributes.
- Preserve replay safety and idempotency for Stripe meter pushes.
- Preserve retired-hash and predecessor-chain attribution semantics.
- Month-close must be independently disable-able from the hourly cron.

## Approach

- Extract the shared scope-reconciliation logic out of the hourly cron into a small internal billing runtime module.
- Build a separate month-close service on top of that shared runtime.
- Reuse the same pending-marker / finalize semantics instead of creating a second billing algorithm.

## Phases

### Phase 1 — Shared billing runtime

- Create `packages/control-plane/src/billing-runtime.ts`.
- Move the reusable billing internals there:
  - registry loading
  - redirect-chain discovery
  - usage-row indexing
  - product discovery for a month
  - pending meter claim / replay / finalize helpers
  - single-scope reconciliation
- Keep the hourly cron behavior unchanged.

### Phase 2 — Month-close service and infra

- Create `packages/control-plane/src/month-close.ts`.
- Add `createMonthCloseService()` and `handler()`.
- Process only the previous month.
- Process both:
  - `REGISTRY#active-keys`
  - `REGISTRY#retired-billing-keys`
- Add SST cron `PqMonthClose` with schedule `cron(30 0 1 * ? *)`.
- Add `PqMonthCloseErrors` CloudWatch alarm.

### Phase 3 — Tests and docs

- Add `packages/control-plane/src/month-close.integration.test.ts`.
- Extend `packages/control-plane/src/billing-cron.integration.test.ts` with a closed-scope skip regression.
- Update roadmap, architecture, runbooks, root docs, and session tracking to reflect shipped month-close behavior.

## Documentation Updates

- `ARCHITECTURE.MD`
  - replace future-tense month-close wording with shipped behavior
  - clarify that `closed=true` is set only on the current-hash row after final previous-month reconciliation
- `ROADMAP.md`
  - mark P1B.11 complete
  - check off each DoD item explicitly
  - update P1B and total counts
- `NEXT-WORK.md`
  - remove P1B.11 as the recommended next ticket
- `NEXT-SESSION.md`
  - record implementation, deploy, and verification
- `CHANGELOG.md`
  - add month-close rollout note
- `README.md`
  - refresh billing live-state and roadmap counts
- `AGENTS.md`
  - remove P1B.11 from remaining planned-stack wording
- `docs/runbooks/month-close.md`
  - new runbook for monthly finalization and operator recovery
- `docs/runbooks/stripe-webhook.md`
  - cross-reference month-close ownership

## Test Strategy

- Integration coverage for:
  - remaining previous-month delta push + close
  - fully pushed previous-month row closes without a new Stripe event
  - retired predecessor-only chain still finalizes and closes
  - rerun is idempotent
  - current-month delta is untouched
- Hourly cron regression:
  - closed previous-month scope is skipped during the day-1 grace window
- Manual verification:
  - seed previous-month usage in dev
  - invoke `PqMonthClose`
  - verify one Stripe meter push, watermark advance, `closed=true`
  - rerun and verify no second push

## Risk & Rollback

- Failure mode: hourly cron and month-close both attempt the same previous-month delta.
  - Mitigation: both paths use the same pending identifier / target model.
- Failure mode: month-close closes before final watermark commit.
  - Mitigation: close only after successful finalize or confirmed zero delta.
- Rollback:
  - disable `PqMonthClose`
  - revert code
  - manually unset `closed` on affected current-hash rows if reconciliation still needs to run
  - Stripe correction remains manual if a bad event has already been accepted

## Open Questions

- None blocking.

## Estimate

- Phase 1: 0.5–1 day
- Phase 2: 0.5 day
- Phase 3: 0.5 day

Total: 1.5–2 days

## File Checklist

| Phase | File | Action | Doc update |
|---|---|---|---|
| 1 | `packages/control-plane/src/billing-runtime.ts` | Create | No |
| 1 | `packages/control-plane/src/billing-cron.ts` | Modify | No |
| 1 | `packages/control-plane/src/index.ts` | Modify | No |
| 2 | `packages/control-plane/src/month-close.ts` | Create | No |
| 2 | `sst.config.ts` | Modify | No |
| 3 | `packages/control-plane/src/month-close.integration.test.ts` | Create | No |
| 3 | `packages/control-plane/src/billing-cron.integration.test.ts` | Modify | No |
| 3 | `ARCHITECTURE.MD` | Modify | Yes |
| 3 | `ROADMAP.md` | Modify | Yes |
| 3 | `NEXT-WORK.md` | Modify | Yes |
| 3 | `NEXT-SESSION.md` | Modify | Yes |
| 3 | `CHANGELOG.md` | Modify | Yes |
| 3 | `README.md` | Modify | Yes |
| 3 | `AGENTS.md` | Modify | Yes |
| 3 | `docs/runbooks/month-close.md` | Create | Yes |
| 3 | `docs/runbooks/stripe-webhook.md` | Modify | Yes |
