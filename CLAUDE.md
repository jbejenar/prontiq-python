# CLAUDE.md — Session Rules

## Read First

1. **Read `NEXT-WORK.md`** (< 100 lines) for the active sprint.
2. **Read `.github/pull_request_template.md`** — the PR template is the authoritative enforcement of PR discipline. Every PR must fill it out.
3. Do NOT read the full `ROADMAP.md` or `ARCHITECTURE.MD` unless a specific ticket requires it. Use `grep`.

## Work Rhythm

- **One ticket at a time.** Finish all DoD checkboxes before moving on.
- **One ticket can produce multiple PRs.** A ticket is a unit of work; a PR is a unit of change.
- **Update `NEXT-WORK.md` and `ROADMAP.md`** when marking DoD items complete.
- **Update `NEXT-SESSION.md`** at session end.

## Process Defaults

The PR template enforces these. The agent follows them by default and asks the user before overriding:

- **Never push directly to `main`.** Every change goes through a PR.
- **One PR per logical change.** Unrelated staleness → separate PR or ticket.
- **Branch prefix:** `feat/`, `fix/`, `chore/`, `docs/`.
- **Never force-push** to `main` or any user-pulled branch.
- **Never skip hooks** (`--no-verify` etc.) unless the user explicitly asks.
- **The agent opens PRs; the user merges them.** Exception: bot PRs after CI + audit.

## Infrastructure Defaults

- **All infra via `sst.config.ts`.** Never `aws ... create/delete` as a workaround.
- **State drift → fix with SST** (`sst refresh`, `import`, `sst state remove`). Never route around with AWS CLI.
- **Destroy resources by removing declarations** and deploying. SST handles teardown.
- **Run `sst diff --stage prod`** before merging any prod-affecting PR.
- **No AWS resources without explicit user approval.** Describe, wait, then create.
- **Secrets** go in SST secrets or GitHub Actions secrets. Never commit or log them.
- **CloudFront/DNS teardowns are permanent.** Rollback creates new URLs — flag this if anything external depends.

## Deploy Defaults

- **Code → PR → CI → dev verify → prod.** No skipping dev.
- **Integration tests required pre-merge** for `packages/api/src/search/**`, `packages/api/src/routes/**`, `packages/shared/src/validation.ts`.
- **Prod deploys are manual and deliberate.** Get user confirmation with `sst diff` output.

## Review Defaults

- **Root cause, not adjacent symptoms.** If a reviewer flags the same issue twice, the last fix wasn't the fix.
- **Honest PR descriptions.** Name every breaking/prod-affecting change. No hiding.
- **Verify claims, don't assume them.** PRs saying "zero traffic" or "no integrations" must cite the command output.
- **Tests prove the fix.** A bug fix without a regression test is incomplete.

## Code Rules

- **ESM only.** Imports use `.js` extension. All packages `"type": "module"`.
- **Strict TypeScript.** `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`.
- **No `any`.** Use `unknown` with narrowing. Exception: OpenSearch response types (`AnyRecord`).
- **Zod for all validation.** Params, manifests, env vars.
- **OpenAPI from code.** `@hono/zod-openapi` `createRoute()`. Never hand-write the spec.
- **No vendor in hot path.** API key verification uses DynamoDB, never Unkey.
- **Index by alias**, never versioned name. Queries use `PRODUCT_REGISTRY[product].alias`.

## Build & Test

```bash
pnpm build            # Build all packages via Turborepo
pnpm typecheck        # Type-check all packages
pnpm lint             # Lint all packages
pnpm test             # Run all tests
pnpm --filter @prontiq/api test:integration   # Real OpenSearch integration tests
```

## Architecture

- **Manifest contract** is the platform boundary. See `ARCHITECTURE.MD` §5.1.2.
- **Product registry** in `packages/shared/src/constants.ts` is the source of truth for products.
- **Blue-green index deployment** with atomic alias swap. See `ARCHITECTURE.MD` §5.2.
- **SST v4 + Pulumi.** Not CloudFormation.
- **Hono + @hono/zod-openapi.** OpenAPI spec auto-generated from Zod.

## Enforcement

CLAUDE.md describes defaults. Enforcement lives in:

- `.github/pull_request_template.md` — every PR fills the checklist.
- `.github/workflows/ci.yml` — required checks (lint, typecheck, build, test, integration-test, spec-drift, and post-deploy `smoke-dev` once branch protection is available).
- GitHub branch protection — **not yet configured** (see follow-up below). As of 2026-05-03, the GitHub API returns HTTP 403 for branch protection on this private repo unless GitHub Pro is enabled or the repo becomes public.

**Follow-up required (post-merge):** configure branch protection on `main` via repo Settings → Branches:

- Require PR review before merge
- Require status checks: `check`, `integration-test`, `smoke-dev`
- Require branches up to date
- Include administrators
