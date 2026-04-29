# P1C.02 Implementation Plan — Console Overview Page

## Intent

P1C.02 is partially done: the console overview route exists, but it must be
audited against the current Lago entitlement projection work already merged on
`main`. The implementation turns `/` in `apps/console` into a live, safe account
overview using the shipped P1C.03 account/key APIs and the Lago-derived
enforcement projection returned by `GET /v1/account/status`.

One-sentence intent: make the console landing page summarize account setup,
key posture, and safe quickstarts without exposing raw key material or
duplicating the `/keys` mutation surface.

## Current State

- `apps/console/app/(dashboard)/page.tsx` exists but hard-codes plan `Free`,
  usage `4,200 / 10,000`, and placeholder cards.
- P1C.03 is complete and provides `GET /v1/account/status` and
  `GET /v1/account/keys` through `apps/console/lib/account-api.ts`.
- `/keys` owns setup recovery, first-key creation, create/rotate/revoke,
  reveal-once raw-key handling, audit, and key limits.
- Console already has TanStack Query in `app/providers.tsx` and a test pattern
  for mocked Clerk/account API calls in `keys-panel.test.tsx`.
- No safe org-level usage-summary endpoint exists; usage charts remain P1C.04.

## Constraints

- Existing raw keys are not recoverable and must not be rendered, copied,
  logged, persisted, or inferred.
- Overview is read-only: no setup, create, rotate, revoke, or Lago/Stripe calls.
- Overview may call only existing account status/key-list APIs.
- Public/private OpenAPI specs do not change.
- Billing remains P1C.05 and Lago-backed through a future Vercel BFF; P1C.02
  does not call Lago or Stripe from the browser.
- Usage remains P1C.04; P1C.02 removes fake numbers instead of adding a backend
  usage endpoint.
- `activeKeyCount` is a Lago-derived local enforcement projection. If it says
  active keys exist but `/v1/account/keys` returns no rows, the overview must
  render an explicit retry/drift state instead of "no keys yet".

## Approach

### Phase 1 — Live Overview State

- Add shared query-key helpers for account status, keys, and audit, then use
  them from both `/keys` and overview to avoid cache-key drift.
- Replace the static dashboard with a server shell rendering a client
  `OverviewPanel`.
- `OverviewPanel` uses `useAuth()` and TanStack Query:
  - no active org: show organization-selection state and make no API calls
  - `provisioned=false`: show setup-required state and link to `/keys`
  - `hasFirstKey=false`: show first-key state and link to `/keys`
  - existing keys: show Lago plan code, active-key count, max keys, role, and up
    to three masked key rows
  - projection drift: when `activeKeyCount > 0` but key-list returns no rows,
    show an explicit retry/drift state

### Phase 2 — Safe Quickstart and Placeholder Removal

- Remove all fake usage values, including `4,200 / 10,000`.
- Add curl, TypeScript, and Python snippets that use `<YOUR_API_KEY>` and
  `NEXT_PUBLIC_API_URL`. Browser-rendered snippets must not reference
  `process.env.PRONTIQ_API_KEY`.
- Copy buttons copy placeholder snippets only.
- Usage card explicitly points to P1C.04.
- Billing card explicitly points to P1C.05/Lago-backed billing and does not
  expose Stripe-hosted UX.

### Phase 3 — Docs and Verification

- Update architecture and console docs to define overview as a read-only summary
  surface.
- Mark roadmap/current-work/session docs as implemented-for-review, not shipped,
  until merge/deploy verification completes.
- Run console tests, typecheck, and lint.
- Run browser smoke on the Vercel preview after PR creation.

## Documentation Updates

- `ARCHITECTURE.MD`: revise Console Structure so Overview is a read-only
  account/key summary that links to `/keys`, shows Lago-derived enforcement
  projection, surfaces status/key-list drift, and cannot reveal existing raw
  keys.
- `apps/console/README.md`: document Overview behavior and local commands.
- `apps/console/HINTS.md`: add explicit no-raw-key/no-mutation/no-fake-usage
  overview rules and the status/key-list drift guard.
- `ROADMAP.md`: record P1C.02 implementation status for review; leave final
  completion until merge/deploy.
- `NEXT-WORK.md`: record P1C.02 implementation branch status.
- `NEXT-SESSION.md`: record implementation and remaining review/deploy steps.
- `plans/P1C.02-implementation-plan.md`: replace the planning draft with this
  implementation-ready plan.
- No DEC, API docs, changelog, runbook, migration note, OpenAPI generation, or
  infrastructure update is needed.

## Test Strategy

- Add `overview-panel.test.tsx` covering:
  - no active org makes no account API calls
  - missing-org state links to `/keys`
  - first-key state links to `/keys`
  - existing-key state renders masked metadata only
  - member/admin states remain read-only on overview
  - quickstart snippets use `<YOUR_API_KEY>` and configured API URL
  - quickstart snippets do not reference browser-inaccessible environment
    variables
  - rendered output and browser storage do not contain raw `pq_live_*` keys
  - fake usage value `4,200 / 10,000` is absent
  - `activeKeyCount > 0` with an empty key list renders explicit drift/retry UI
  - key-list errors render retry UI, not an empty-list false positive
- Regenerate OpenAPI and run `scripts/openapi-boundary.test.mjs` to confirm the
  public spec is unchanged and private account routes remain private.
- Run `git diff --check` to catch merge-conflict whitespace damage.
- Run:
  - `pnpm --filter console test`
  - `pnpm --filter console typecheck`
  - `pnpm --filter console lint`
  - `pnpm --filter console build`

## Risk & Rollback

- Raw-key leak: mitigated by using only status/list APIs and tests scanning
  rendered output/storage. Roll back by reverting the UI PR.
- Duplicate mutation behavior: mitigated by linking to `/keys` only. Rollback
  has no data repair.
- Misleading usage state: mitigated by removing fake usage numbers and deferring
  real charts to P1C.04. Rollback has no data repair.
- Status/key-list drift hidden as "no keys": mitigated by explicit drift copy
  and retry. Rollback has no data repair but would reintroduce misleading UX.

Nothing in this ticket is irreversible.

## Open Questions

None. Defaults locked:

- no usage-summary endpoint in P1C.02
- overview remains read-only
- `/keys` remains the only key/setup mutation surface

## Estimate

- Phase 1: 0.5-1 day
- Phase 2: 0.5 day
- Phase 3: 0.5 day

Total: 1.5-2 days excluding deploy wait time.

## File Checklist

| Phase | File                                                   | Change                                                               | Doc Update |
| ----- | ------------------------------------------------------ | -------------------------------------------------------------------- | ---------- |
| 1     | `apps/console/lib/account-query-keys.ts`               | Shared account query keys                                            | No         |
| 1     | `apps/console/app/(dashboard)/keys/keys-panel.tsx`     | Consume shared query keys                                            | No         |
| 1     | `apps/console/app/(dashboard)/page.tsx`                | Replace static overview shell                                        | No         |
| 1     | `apps/console/app/(dashboard)/overview-panel.tsx`      | Live read-only overview                                              | No         |
| 2     | `apps/console/app/(dashboard)/overview-panel.test.tsx` | Component coverage                                                   | No         |
| 3     | `ARCHITECTURE.MD`                                      | Document overview contract                                           | Yes        |
| 3     | `apps/console/README.md`                               | Document overview behavior, no fake usage, and no browser Lago calls | Yes        |
| 3     | `apps/console/HINTS.md`                                | Add overview guardrails                                              | Yes        |
| 3     | `ROADMAP.md`                                           | Record implementation-for-review                                     | Yes        |
| 3     | `NEXT-WORK.md`                                         | Update active work status                                            | Yes        |
| 3     | `NEXT-SESSION.md`                                      | Record handoff                                                       | Yes        |
| 3     | `plans/P1C.02-implementation-plan.md`                  | Replace planning draft                                               | Yes        |

P1C.02: 3 phases, 7 doc updates, 0 open questions.
