# `plans/P1C.07-implementation-plan.md` — Tailwind v3.4 + shadcn/ui Frontend Base

## Intent

Implement the shared frontend tooling and shell foundation required before `P1C.01`, `P1C.02`, and `P1C.03`: Tailwind v3.4, app-local shadcn/ui primitives, dark mode, responsive navigation, frontend Vitest, and a real Clerk auth boundary in `apps/console` that does not break keyless root builds.

## Current State

- `P1C.00` had already scaffolded `apps/landing`, `apps/console`, `packages/tokens`, and the shared content contract.
- The scaffold state had no Tailwind/PostCSS config, no app-local `components/ui/*`, no theme provider, no app-local frontend tests, and no real Clerk boundary.
- `apps/landing` incorrectly reused the root `frontend-dev-workflow.test.mjs` as its app `test` script.
- `apps/console` had no app-local `test` script.
- `@prontiq/tokens` emitted only placeholder values and did not expose the semantic HSL token surface needed by shadcn/Tailwind.
- Known repo-specific Clerk failures already existed:
  - `ClerkProvider` crashed build without `publishableKey`
  - `UserButton` broke prerender when placed in the wrong boundary

## Constraints

- No backend API, billing, auth semantics, OpenAPI contracts, or deploy workflow changes.
- No shared `packages/ui` package.
- Tailwind remains on the v3.4 path.
- `@prontiq/tokens` keeps stable `./preset` and `./tokens.css` entrypoints.
- `P1C.07` does not implement live landing demo, pricing, TanStack Query, Playwright, or real console data fetching.
- Root commands must remain green from a fresh checkout.

## Approach

- Expand `@prontiq/tokens` into a semantic HSL alias layer consumed by Tailwind/shadcn.
- Add Tailwind/PostCSS, app-local shadcn source, theme providers, and Vitest + Testing Library to both apps.
- Extend the existing frontend helper scripts so app-local `test` commands are self-sufficient from a fresh checkout.
- Add a real Clerk boundary to `apps/console`, but gate it on env presence so local/CI builds still succeed without Clerk keys.
- Build a minimal real landing shell and console shell without bringing in live data or feature work.

## Phases

### Phase 1 — Token contract and frontend tooling

- Expand `@prontiq/tokens` to emit semantic HSL CSS vars, compatibility `--color-*` aliases, and the Tailwind preset surface needed by shadcn.
- Add Tailwind/PostCSS config, app-local `@/*` aliases, and Next ESLint plugin support for both apps.

### Phase 2 — App-local shadcn base, themes, and frontend tests

- Add app-local shadcn primitives and support components to both apps.
- Add `next-themes`, theme toggles, runtime font loading, and app-local Vitest + Testing Library.
- Extend `scripts/run-frontend-task.mjs` and `scripts/frontend-dev-workflow.test.mjs` so `test` is fresh-checkout-safe.

### Phase 3 — Real console Clerk boundary and shell

- Add separate public/server env seams plus a `clerkEnabled` runtime helper.
- Add an env-gated Clerk provider, protected dashboard layout, public sign-in route, and responsive console shell.
- Keep all console data static/stubbed in this ticket.

### Phase 4 — Landing shell and docs closeout

- Replace the landing placeholder with a token-aware shell.
- Update roadmap, strategy, architecture, app READMEs/HINTS, and sprint-tracking docs so `P1C.07` is closed and `P1C.01` becomes next.

## Documentation Updates

- `README.md`
- `AGENTS.md`
- `ARCHITECTURE.MD`
- `docs/FRONTEND-STRATEGY.md`
- `ROADMAP.md`
- `CHANGELOG.md`
- `NEXT-WORK.md`
- `NEXT-SESSION.md`
- `apps/landing/README.md`
- `apps/landing/HINTS.md`
- `apps/console/README.md`
- `apps/console/HINTS.md`
- `packages/tokens/README.md`
- `packages/tokens/HINTS.md`

No new DEC, API contract doc, runbook, or migration note was required.

## Test Strategy

- `@prontiq/tokens` contract tests for emitted CSS/preset artifacts.
- App-local component tests for theme toggles, landing shell, Clerk gating, and console shell behavior.
- App-local `build`, `typecheck`, and `test` for both apps.
- Root `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test`.

## Risk & Rollback

- Clerk env absence breaking console builds: mitigated with env gating and client wrappers.
- Token-format churn breaking Tailwind/shadcn: mitigated with contract tests and compatibility aliases.
- Frontend helper changes breaking fresh-checkout test/build ergonomics: mitigated with helper regression tests.

Rollback is phase-local and requires only git revert; no data or infrastructure mutation is involved.

## Open Questions

None blocking.

## Estimate

- Phase 1: 0.5–1 day
- Phase 2: 1–1.5 days
- Phase 3: 1–1.5 days
- Phase 4: 0.5–1 day

Total: 3–5 days
