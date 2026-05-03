# P1F.04 — Post-Deploy Smoke Coverage Extension Implementation Plan

## Intent

Every dev and prod deploy must run a real customer-path Address API smoke
against the deployed stage URL, using dedicated stage-owned API keys, while
documenting which smokes are safe for CI and which remain runbook/manual only.

## Current State

`P1F.04` is pending in `ROADMAP.md`. `smoke-dev` exists after `deploy-dev`, but
only runs Clerk/account/key/usage smokes. `deploy-prod.yml` has no post-deploy
smoke job. `packages/api/src/scripts/smoke-test.ts` is operator-runnable only
and requires `PRONTIQ_KEY`.

GitHub Environment secrets for `dev` and `prod` currently need a dedicated
`PRONTIQ_KEY`. GitHub branch protection is externally blocked for this private
repo until GitHub Pro is enabled or the repo becomes public.

## Constraints

- Lago and Clerk stay off the Address API smoke path.
- Raw API keys, hashes, headers, query payloads, secrets, and customer data must
  never be printed in logs, docs, PRs, or evidence.
- CI-every-deploy smokes may create normal usage and billing-event evidence only
  through dedicated smoke orgs/keys.
- CI smokes must not mutate account lifecycle, key lifecycle, plan state,
  billing plan state, or destructive UI flows.
- Prod smoke failure blocks the workflow from going green but does not roll
  back an already-deployed runtime.

## Approach

Keep `pnpm --filter @prontiq/api smoke` as the canonical command because the
roadmap DoD verifies that exact command. Harden the Address API smoke into an
importable, testable runner while preserving its CLI contract. Wire the runner
into `smoke-dev` and a new `smoke-prod` job using stage-scoped `PRONTIQ_KEY`
GitHub Environment secrets.

Document smoke classification with both category and stage scope so future
operators do not reintroduce prod Clerk-authenticated smokes.

## Phases

1. Plan and smoke-boundary docs.
2. Address smoke runner hardening and tests.
3. Dev/prod workflow wiring and workflow contract tests.
4. Dedicated smoke fixture and GitHub secret provisioning.
5. Evidence, roadmap, changelog, and session closeout.

## Documentation Updates

- `docs/decisions/042-post-deploy-smoke-boundary.md`
- `docs/runbooks/smoke-classification.md`
- `docs/runbooks/lago-live-smoke.md`
- `docs/runbooks/prod-go-live-cleanup.md`
- `docs/operations/p1f04-post-deploy-smoke-evidence.md`
- `.github/pull_request_template.md`
- `CLAUDE.md`
- `AGENTS.md`
- `packages/api/HINTS.md`
- `packages/control-plane/HINTS.md`
- `README.md`
- `ARCHITECTURE.MD`
- `CHANGELOG.md`
- `ROADMAP.md`
- `NEXT-WORK.md`
- `NEXT-SESSION.md`

No OpenAPI docs, private API docs, schema migrations, or billing-meter contract
changes are required.

## Test Strategy

- Unit-test the smoke runner with injected fetch/log functions.
- Add workflow contract tests for `smoke-dev` and `smoke-prod`.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`.
- Review `sst diff --stage prod`; expected infra delta is none.
- Verify live dev and prod workflow runs after secrets are set.
- Validate prod red-run behavior through `force_smoke_failure=true`.

## Risk & Rollback

- Missing/expired smoke key: rotate the dedicated fixture and update the GitHub
  Environment secret.
- Secret leakage: revoke the key immediately, rotate the secret, and invalidate
  affected evidence.
- False red prod workflow: inspect smoke logs, rotate fixture if needed, or
  revert the workflow PR. Runtime rollback is not automatic.
- Branch protection remains an external follow-up until GitHub supports it for
  this repo.

## Open Questions

None.

## Estimate

2.5-3.5 engineering days, plus operator time to provision smoke keys and run
dev/prod workflow evidence.

## Checklist

| Phase | Files / systems                                          | Docs?         |
| ----- | -------------------------------------------------------- | ------------- |
| 1     | Plan, DEC-042, smoke classification runbook              | Yes           |
| 2     | `smoke-test.ts`, smoke runner tests                      | Yes           |
| 3     | `ci.yml`, `deploy-prod.yml`, workflow contract test      | Yes           |
| 4     | GitHub `dev.PRONTIQ_KEY`, `prod.PRONTIQ_KEY`, smoke keys | Evidence only |
| 5     | Roadmap, session docs, changelog, README, HINTS/AGENTS   | Yes           |

P1F.04: 5 phases, 17 doc updates, 0 open questions.
