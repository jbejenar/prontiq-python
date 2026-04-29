# P1C.02 Implementation Plan — Console Overview Page

## Intent

P1C.02 replaces the static console overview placeholders with a live, safe
account overview that helps a signed-in developer recover setup, create their
first key, understand current key/plan posture, and copy runnable quickstart
snippets without ever revealing an existing raw API key.

One-sentence intent: build the console landing page on top of the shipped P1C.03
account/key contract, not the stale pre-P1C.03 assumption that raw keys can be
recovered from storage.

## Current State

### Code

- `apps/console/app/(dashboard)/page.tsx` is a server component with static
  cards, static usage (`4,200 / 10,000`), and static endpoint rows.
- `apps/console/app/(dashboard)/keys/keys-panel.tsx` already implements the
  live missing-org -> setup -> first-key -> list state machine, reveal-once raw
  key modal, rotate/revoke with step-up, audit panel, and key-limit indicator.
- `apps/console/lib/account-api.ts` already exposes the private account client:
  `getStatus`, `runSetup`, `listKeys`, `listAudit`, `createKey`, `rotateKey`,
  and `revokeKey`.
- `apps/console/app/providers.tsx` already provides TanStack Query.
- `apps/console/components/console/console-shell.tsx` links Overview to `/`,
  Keys to `/keys`, and the remaining Usage/Billing/Playground/Danger Zone items
  to same-page anchors.
- `packages/api/src/routes/keys.ts` exposes `GET /v1/account/status` and `GET
  /v1/account/keys`; those are enough for safe overview key/plan posture.
- There is no dedicated org-level usage-summary endpoint yet. Usage counters
  exist in DynamoDB under API-key hashes, but exposing org-level usage safely
  needs backend API design rather than client-side table access.

### Documentation

- `ROADMAP.md` now marks P1C.03 complete and rewrites P1C.02 so it cannot
  reintroduce existing-key reveal.
- `NEXT-WORK.md` now moves active work to P1C.02 and records the P1C.03 closeout.
- `NEXT-SESSION.md` now records PR #186 and prod deploy run `25094034637`.
- `ARCHITECTURE.MD` already documents P1C.03 key lifecycle and private account
  endpoints; it needs a short overview-page subsection after implementation.
- `docs/private-api/account-keys.md` documents the account/key endpoints used by
  the overview.
- `apps/console/README.md` and `apps/console/HINTS.md` describe console patterns
  and should be updated if the overview introduces reusable components.

### Assumptions The Old Ticket Made That Are No Longer True

- Existing raw keys cannot be revealed or copied. Only create/rotate responses
  carry raw keys once.
- Overview should not duplicate the Keys page. It should summarize and deep-link.
- Usage numbers must not be fabricated. If P1C.02 does not add a safe usage
  summary endpoint, the overview must show honest "usage surface coming in
  P1C.04" copy.
- Billing controls must not call Stripe directly or revive AWS
  `/v1/account/billing*`; P1C.05 owns Lago-backed billing UI.

## Constraints

- Existing-key display is masked metadata only: `keyPrefix`, label, created date,
  last-used date, products.
- Raw `pq_live_*` values must never be persisted, logged, stored in
  localStorage/sessionStorage, or rendered for pre-existing keys.
- Console uses Clerk session tokens through `getToken()` and
  `NEXT_PUBLIC_API_URL`; no Vercel BFF is added for P1C.02.
- Public and private OpenAPI specs stay separate. No `/v1/account/*` route can
  enter `packages/docs/openapi.json`.
- Billing remains Lago-centered: the overview may link to billing follow-up work
  but must not add Stripe-hosted UX as the target path.
- P1C.04 owns detailed usage charts. P1C.02 may only show a lightweight
  real-data snapshot or a clearly labelled placeholder.
- P1C.03 remains the owner of key CRUD, audit, step-up, and key limits.

## Approach

Use the existing private account client and Query provider to make
`apps/console/app/(dashboard)/page.tsx` a thin server shell that renders a new
client component, `overview-panel.tsx`.

Chosen approach:

- Reuse `GET /v1/account/status` and `GET /v1/account/keys` for live overview
  state.
- Render the primary CTA based on status:
  `provisioned=false` -> setup recovery, `hasFirstKey=false` -> create first key
  on `/keys`, existing keys -> manage keys on `/keys`.
- Show masked key metadata and active-key count, not raw values.
- Provide quickstart snippets using `<YOUR_API_KEY>` and explain that the raw key
  appears once on the Keys page after create/rotate.
- Keep usage as a real-data-only panel. For the first mergeable slice, remove
  fabricated numbers and show the planned P1C.04 handoff unless a small backend
  summary endpoint is explicitly added during implementation planning.

Rejected approach:

- Revealing/copying existing raw keys from overview. Impossible with hash-only
  storage and unsafe by design.
- Reading DynamoDB usage directly from the browser. Violates security and
  architecture boundaries.
- Implementing billing reads in AWS private account APIs. Superseded by the Lago
  BFF direction.

## Phases

### Phase 1 — Documentation Closeout and Contract Correction

Files touched:

- `ROADMAP.md`
- `NEXT-WORK.md`
- `NEXT-SESSION.md`
- `plans/P1C.02-implementation-plan.md`

Contracts changed:

- P1C.03 becomes complete.
- P1C.02 DoD changes from raw-key reveal to masked-key summary and safe
  quickstart.

Data migrations:

- None.

Feature flags:

- None.

Rollout order:

- Merge before implementation so the ticket contract is correct.

### Phase 2 — Live Overview UI

Files touched:

- `apps/console/app/(dashboard)/page.tsx`
- `apps/console/app/(dashboard)/overview-panel.tsx` (new)
- `apps/console/app/(dashboard)/overview-panel.test.tsx` (new)
- `apps/console/components/console/console-shell.tsx` if nav copy or anchors
  need adjustment

Contracts introduced or changed:

- No backend contract changes.
- Overview becomes a client-rendered account state consumer.

Data migrations:

- None.

Feature flags:

- None.

Rollout order:

1. Add client overview component.
2. Replace static page placeholders.
3. Keep `/keys` as the only surface that creates/reveals raw keys.

### Phase 3 — Safe Quickstart and Usage Placeholder Removal

Files touched:

- `apps/console/app/(dashboard)/overview-panel.tsx`
- `apps/console/app/(dashboard)/overview-panel.test.tsx`
- Optional: `apps/console/components/console/quickstart-snippet.tsx` if snippet
  rendering becomes reusable

Contracts introduced or changed:

- Quickstart copy uses `<YOUR_API_KEY>`. P1C.02 does not transfer raw key state
  from `/keys`.
- Usage card either uses a future endpoint or explicitly shows that P1C.04 owns
  charts. For this ticket, do not add fabricated usage numbers.

Data migrations:

- None.

Feature flags:

- None.

Rollout order:

1. Add copyable curl/TypeScript/Python snippets with placeholder API key.
2. Remove static usage numbers.
3. Add tests asserting no `pq_live_*` sample secret is rendered.

### Phase 4 — Docs, Tests, and Smoke

Files touched:

- `ARCHITECTURE.MD`
- `apps/console/README.md`
- `apps/console/HINTS.md`
- `CHANGELOG.md` if present; otherwise no changelog update
- `NEXT-WORK.md`
- `NEXT-SESSION.md`

Contracts introduced or changed:

- Document overview as a summary/orchestration surface, not a credential
  recovery surface.

Data migrations:

- None.

Feature flags:

- None.

Rollout order:

1. Update docs with final behavior.
2. Run console tests/typecheck/lint.
3. Manual browser smoke after preview deploy.

## Documentation Updates

- `ARCHITECTURE.MD`: Add/update console overview section to state that overview
  consumes account status and key metadata, links to `/keys`, and cannot reveal
  existing raw keys.
- `DEC-{NNN}`: Not needed. No new non-obvious architecture decision is being
  made; this follows P1C.03's existing hash-only/reveal-once key model.
- `HINTS.md`: Update `apps/console/HINTS.md` with the rule that overview must not
  render or persist raw API keys and must use TanStack Query with `accountApi`.
- `READMEs`: Update `apps/console/README.md` to describe overview behavior and
  test commands if new component tests are added.
- `CHANGELOG`: Not needed unless the repo has an active changelog file; this is
  pre-production console behavior.
- API / contract docs: No new API docs if Phase 2 only uses existing endpoints.
  If a usage-summary endpoint is added, document it in `docs/private-api/*` and
  `packages/api/openapi.private.json` only.
- Runbooks: No new runbook required. If browser smoke steps change, add a short
  note to `docs/runbooks/api-key-lifecycle.md`.
- Migration notes: Not needed. No persisted data shape changes.
- `ROADMAP.md`: Mark P1C.02 DoD items as complete only after implementation and
  deploy verification.
- `NEXT-WORK.md`: Move active work from planning to implementation status after
  the PR opens.
- `NEXT-SESSION.md`: Record implementation, verification, preview URL, and any
  manual smoke evidence.

## Test Strategy

### Unit / Component

- `overview-panel.test.tsx` covers:
  - loading and error states
  - `provisioned=false` renders setup CTA
  - `provisioned=true` and `hasFirstKey=false` renders first-key CTA to `/keys`
  - existing-key state renders masked key metadata only
  - member users can view overview but see admin-only key actions as links, not
    mutation buttons
  - snippets use `<YOUR_API_KEY>` and `NEXT_PUBLIC_API_URL`
  - no rendered text, localStorage, or sessionStorage value matches `pq_live_*`
  - static usage number `4,200 / 10,000` is absent

### Integration

- No new backend integration tests if no backend route is added.
- If a usage-summary endpoint is added, add `node:test` integration coverage for
  member access, org scoping, usage aggregation, and private OpenAPI generation.

### Contract

- Run `pnpm exec node scripts/generate-openapi.mjs`.
- Run `node --test scripts/openapi-boundary.test.mjs`.
- Confirm `packages/docs/openapi.json` is unchanged unless public data routes
  changed, which they should not.

### End-to-End / Manual

- Preview deploy manual smoke:
  - Sign in as a dev test user with an existing key.
  - Overview loads live active-key count and masked key metadata.
  - Quickstart snippets copy with `<YOUR_API_KEY>`.
  - `/keys` link opens the full key-management page.
  - Address API still succeeds with a separately held test key.
- Dev deploy smoke:
  - Repeat preview smoke against the dev deployment.
- Prod deploy smoke:
  - Use a labelled prod test org only; no customer data.

## Risk & Rollback

- Risk: Overview accidentally renders raw key material.
  - Mitigation: no raw key source is queried; tests scan rendered output and
    browser storage for `pq_live_*`.
  - Rollback: revert the overview PR; `/keys` remains functional.
- Risk: Overview duplicates key-management mutations and creates inconsistent UX.
  - Mitigation: P1C.02 links to `/keys`; P1C.03 remains mutation owner.
  - Rollback: revert UI changes only; no data repair required.
- Risk: Usage panel shows stale/fake data and misleads users.
  - Mitigation: remove hard-coded numbers; show real-data-only copy until P1C.04.
  - Rollback: revert panel copy; no data repair required.

Nothing in this ticket is irreversible if implemented as planned.

## Open Questions

1. Should P1C.02 add a small `GET /v1/account/usage-summary` endpoint now, or
   should usage stay explicitly deferred to P1C.04? Owner: product/engineering.
   Default for implementation: defer to P1C.04 to keep P1C.02 small.
2. Should the overview include a "create first key" action inline, or only link
   to `/keys` where the reveal-once modal already exists? Owner: product.
   Default for implementation: link to `/keys` to avoid duplicating raw-key UI.

## Estimate

- Phase 1: 0.5 day. Documentation-only; no blocker.
- Phase 2: 0.5-1 day. Main blocker is preserving the P1C.03 state-machine
  semantics without duplicating mutation code.
- Phase 3: 0.5 day. Straightforward UI/test work if usage is deferred.
- Phase 4: 0.5 day. Depends on preview deploy availability for manual smoke.

Total: 1.5-2.5 days if usage is deferred; add 1-2 days if a backend
usage-summary endpoint is pulled into scope.

## File Checklist

| Phase | File | Change | Doc Update |
| --- | --- | --- | --- |
| 1 | `ROADMAP.md` | Close P1C.03; correct P1C.02 DoD | Yes |
| 1 | `NEXT-WORK.md` | Move active work to P1C.02 | Yes |
| 1 | `NEXT-SESSION.md` | Record P1C.03 closeout and next step | Yes |
| 1 | `plans/P1C.02-implementation-plan.md` | Add implementation plan | Yes |
| 2 | `apps/console/app/(dashboard)/page.tsx` | Replace static overview with live shell | No |
| 2 | `apps/console/app/(dashboard)/overview-panel.tsx` | New live overview component | No |
| 2 | `apps/console/app/(dashboard)/overview-panel.test.tsx` | Component tests | No |
| 2 | `apps/console/components/console/console-shell.tsx` | Optional nav/copy adjustment | No |
| 3 | `apps/console/components/console/quickstart-snippet.tsx` | Optional reusable snippet component | No |
| 4 | `ARCHITECTURE.MD` | Document overview as summary surface | Yes |
| 4 | `apps/console/README.md` | Document overview behavior and tests | Yes |
| 4 | `apps/console/HINTS.md` | Document no raw-key reveal on overview | Yes |
| 4 | `docs/private-api/*` | Only if a backend usage endpoint is added | Conditional |
| 4 | `NEXT-WORK.md` | Update implementation/deploy status | Yes |
| 4 | `NEXT-SESSION.md` | Record final verification | Yes |

P1C.02: 4 phases, 8 doc updates, 2 open questions.
