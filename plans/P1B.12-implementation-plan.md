# P1B.12 — Auth Middleware Integration Test

## Intent

Close P1B.12 as an auth middleware integration-test reconciliation ticket: fill the remaining real post-cutover auth assertions, remove stale roadmap scope that now belongs to other tickets, and mark the ticket complete without changing runtime behavior.

## Current State

- The main integration harness already exists in `packages/api/src/middleware/auth.integration.test.ts`.
- Existing coverage already proves the core auth path: valid key success, missing key, free-tier quota exhaustion, paid overage, weighted credit usage, burst limiting, product gating, payment-overdue headers, REDIRECT failure modes, and quota-email enqueue behavior.
- The real remaining gaps are:
  - direct unknown key → `401 INVALID_API_KEY`
  - direct revoked key (`active=false`) → `401 INVALID_API_KEY`
  - REDIRECT success should assert usage increments on `newHash`
  - free-tier quota rejection should assert no orphan increment beyond the cap
  - at least one pre-increment 4xx path should assert no usage row is created
  - atomic free-tier quota race (`100` concurrent requests, `50` quota)
- The old roadmap ticket body is stale:
  - no `scripts/seed-test-data.ts` exists or is needed
  - webhook idempotency is already covered by `P1B.05`
  - first-key creation belongs to `P1C.03`
  - the old audit no-op bullet is stale because `auth.ts` has no audit dependency

## Constraints

- No runtime behavior changes.
- No new scripts, infra, env vars, alarms, feature flags, or deploy steps.
- No schema/data migrations.
- Keep auth semantics unchanged:
  - same error codes
  - same REDIRECT grace behavior
  - same quota-before-response contract
  - same burst-limiter ordering
  - same usage writes only after auth/product/burst checks pass
- Keep the ticket scoped to auth middleware integration only.

## Approach

### Chosen approach

Use the existing `auth.integration.test.ts` harness as the single integration surface, fill the missing auth assertions there, then reconcile roadmap and status docs to the actual ownership boundary.

### Rejected approaches

1. Implement the old roadmap ticket literally.
   Rejected because it would duplicate moved scope and existing coverage.
2. Docs-only closure.
   Rejected because real auth integration gaps remain.
3. Add a reusable seed/smoke script.
   Rejected because the existing harness already owns fixture setup.

## Phases

### Phase 1 — Fill the remaining auth integration gaps

Files:
- `packages/api/src/middleware/auth.integration.test.ts`

Changes:
- Add direct unknown-key coverage.
- Add direct revoked-key coverage.
- Strengthen REDIRECT success coverage to assert usage increments on `newHash`, not `oldHash`.
- Strengthen free-tier quota rejection coverage so failed requests do not push usage beyond the cap.
- Add an explicit pre-increment 4xx no-usage assertion.
- Add an atomic free-tier quota-race test using `100` concurrent requests at `quotaPerProduct = 50`.

### Phase 2 — Reconcile the roadmap ticket to the real scope

Files:
- `ROADMAP.md`

Changes:
- Remove stale seed-script requirements.
- Remove Clerk webhook idempotency from `P1B.12`.
- Keep first-key creation explicitly owned by `P1C.03`.
- Remove the stale audit no-op bullet.
- Mark the ticket complete with explicit `[x]` checkoffs.
- Update global roadmap references and counts.

### Phase 3 — Align active planning/status docs

Files:
- `plans/P1B.12-implementation-plan.md`
- `NEXT-WORK.md`
- `NEXT-SESSION.md`
- `README.md`
- `CHANGELOG.md`

Changes:
- Remove `P1B.12` from next-work recommendations.
- Promote `P1F.02` as the next priority.
- Record implementation/verification.
- Update roadmap progress counts in root docs.
- Add a changelog note for the integration-coverage reconciliation.

## Documentation Updates

- `ROADMAP.md`: rewrite P1B.12 to the real auth-only scope, mark complete, update counts, and remove stale global references.
- `NEXT-WORK.md`: remove P1B.12 from open work and promote `P1F.02`.
- `NEXT-SESSION.md`: record implementation and verification.
- `README.md`: update counts after P1B.12 closes.
- `CHANGELOG.md`: note the auth integration coverage reconciliation.
- `ARCHITECTURE.MD`: no change required.
- `AGENTS.md`: no change required.
- Decision records: no new DEC required.
- Runbooks/API docs/migration notes: no change required.

## Test Strategy

- Extend `packages/api/src/middleware/auth.integration.test.ts` to verify:
  - unknown key → `401 INVALID_API_KEY`
  - revoked direct key → `401 INVALID_API_KEY`
  - REDIRECT success increments usage on `newHash`
  - free-tier quota rejection does not increment beyond the cap
  - a pre-increment 4xx path creates no usage row
  - atomic quota race results in exactly `50` successes / `50` `QUOTA_EXCEEDED`, final `requestCount === 50`
- Preserve current assertions for burst limiting, refill, key isolation, weighted credits, paid overage, product gating, payment overdue, and REDIRECT failure modes.

## Risk & Rollback

- Risk: quota-race test is flaky.
  - Mitigation: disable burst limiting in that test with a high or null `rateLimit`, use a 1-credit endpoint, assert only after `Promise.all`.
  - Rollback: revert only the race test and rework it.
- Risk: stale scope remains in docs.
  - Mitigation: explicitly remove webhook / first-key / audit bullets from P1B.12.
  - Rollback: revert docs-only changes without touching tests.
- Risk: new assertions accidentally test non-auth behavior.
  - Mitigation: keep assertions pinned to middleware outcomes and usage-row effects only.

## Open Questions

None blocking.

Assumptions:
- P1B.12 is integration-only.
- No new seed/smoke script.
- No audit-table harness.
- `CHANGELOG.md` continues to track internal ticket-closure milestones.

## Estimate

- Phase 1: 0.5–1 day
- Phase 2: 0.25–0.5 day
- Phase 3: 0.25 day

Total: 1–1.75 days

## File Checklist

| Phase | File | Action | Doc update |
|---|---|---|---|
| 1 | `packages/api/src/middleware/auth.integration.test.ts` | Modify | No |
| 2 | `ROADMAP.md` | Modify | Yes |
| 3 | `plans/P1B.12-implementation-plan.md` | Create | Yes |
| 3 | `NEXT-WORK.md` | Modify | Yes |
| 3 | `NEXT-SESSION.md` | Modify | Yes |
| 3 | `README.md` | Modify | Yes |
| 3 | `CHANGELOG.md` | Modify | Yes |
