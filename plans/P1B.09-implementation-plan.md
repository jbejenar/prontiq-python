# P1B.09 — Burst Rate Limiter Middleware

## Intent

Close P1B.09 by extracting the already-live per-key burst limiter out of `auth.ts` into a dedicated middleware/module, preserving the current wire behavior (`RATE_LIMITED` + `Retry-After` + existing `X-RateLimit-*` headers), adding the missing unit/integration coverage, and reconciling the roadmap/docs so the ticket is explicitly shipped instead of half-live and half-pending.

## Current State

- Burst limiting already exists in `packages/api/src/middleware/auth.ts`.
- There is no dedicated `packages/api/src/middleware/rate-limit.ts`, even though the ticket DoD calls for one.
- `packages/api/src/middleware/auth.integration.test.ts` already covers one burst-limit path, but not refill, key isolation, direct unit tests, or the no-orphan-usage invariant.
- `ARCHITECTURE.MD` already documents the burst limiter as part of the shipped auth model.
- Several docs still treat `RATE_LIMITED` or P1B.09 as future/pending.

## Constraints

- No infrastructure, schema, secret, or environment changes.
- No changes to public error/header semantics:
  - `RATE_LIMITED`
  - `Retry-After`
  - existing `X-RateLimit-*` / `X-Payment-Overdue`
- Keep the limiter per-key, per-instance, in-memory, single-bucket.
- Keep limiter rejection before usage increment.

## Approach

- Extract token-bucket state/math into `packages/api/src/middleware/rate-limit.ts`.
- Keep `auth.ts` as the orchestrator for auth, product gating, quota handling, and background quota-email enqueue.
- Add direct unit coverage for token-bucket behavior.
- Expand auth integration coverage to prove refill, isolation, and no usage writes on `RATE_LIMITED`.
- Reconcile roadmap/root/docs so P1B.09 is clearly marked complete and `RATE_LIMITED` is documented as live.

## Phases

### Phase 1 — Extract module

- Create `packages/api/src/middleware/rate-limit.ts`
- Update `packages/api/src/middleware/auth.ts` to delegate burst limiting there
- Preserve the existing auth response contract

### Phase 2 — Complete tests

- Create `packages/api/src/middleware/rate-limit.test.ts`
- Extend `packages/api/src/middleware/auth.integration.test.ts`
- Update `packages/api/package.json` so the new unit test runs in `pnpm --filter @prontiq/api test`

### Phase 3 — Reconcile docs

- Update `ROADMAP.md`, `ARCHITECTURE.MD`, `README.md`, `AGENTS.md`, `NEXT-WORK.md`, `NEXT-SESSION.md`, and `CHANGELOG.md`
- Update `packages/docs/guides/rate-limits.mdx` and `packages/docs/guides/authentication.mdx`

## Documentation Updates

- `ROADMAP.md`: mark P1B.09 complete, check off each DoD line, update counts, and replace future evidence with shipped evidence
- `ARCHITECTURE.MD`: align §5.4.1 with the extracted module shape
- `README.md`: reflect that auth includes burst limiting
- `AGENTS.md`: reflect burst limiting in the live stack summary
- `NEXT-WORK.md`: remove P1B.09 from pending work and promote P1B.12
- `NEXT-SESSION.md`: record implementation/verification
- `CHANGELOG.md`: add shipped note for P1B.09
- `packages/docs/guides/rate-limits.mdx`: document per-key burst limiting + `Retry-After`
- `packages/docs/guides/authentication.mdx`: document `RATE_LIMITED` as live

No new DEC, HINTS, runbook, migration note, or OpenAPI schema changes required.

## Test Strategy

- Unit: token consumption, refill, cap, bypass, key isolation
- Integration: burst exhaustion, refill recovery, isolated keys, no usage increment on `RATE_LIMITED`
- Manual: low-rate-limit dev key, quick double request, observe 429 then later success, confirm usage row unchanged for rejected request

## Risk & Rollback

- Risk: extraction changes behavior or ordering
  - Mitigation: preserve exact wire contract and add regression coverage
- Risk: rejected requests still increment usage
  - Mitigation: explicit integration test
- Rollback: revert API runtime changes only; no data repair expected unless a bad deploy writes unexpected usage rows

## Open Questions

None blocking.

## Estimate

- Phase 1: 0.5 day
- Phase 2: 0.5 day
- Phase 3: 0.5 day

Total: 1–1.5 days

## File Checklist

| Phase | File | Action | Doc update |
|---|---|---|---|
| 1 | `packages/api/src/middleware/rate-limit.ts` | Create | No |
| 1 | `packages/api/src/middleware/auth.ts` | Modify | No |
| 2 | `packages/api/src/middleware/rate-limit.test.ts` | Create | No |
| 2 | `packages/api/src/middleware/auth.integration.test.ts` | Modify | No |
| 2 | `packages/api/package.json` | Modify | No |
| 3 | `plans/P1B.09-implementation-plan.md` | Create | Yes |
| 3 | `ROADMAP.md` | Modify | Yes |
| 3 | `ARCHITECTURE.MD` | Modify | Yes |
| 3 | `packages/docs/guides/rate-limits.mdx` | Modify | Yes |
| 3 | `packages/docs/guides/authentication.mdx` | Modify | Yes |
| 3 | `README.md` | Modify | Yes |
| 3 | `AGENTS.md` | Modify | Yes |
| 3 | `NEXT-WORK.md` | Modify | Yes |
| 3 | `NEXT-SESSION.md` | Modify | Yes |
| 3 | `CHANGELOG.md` | Modify | Yes |

`P1B.09: 3 phases, 10 doc updates, 0 open questions.`
