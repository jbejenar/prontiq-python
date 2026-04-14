# CLAUDE.md — Session Rules

## Read Discipline

1. **Start every session** by reading `NEXT-WORK.md` (< 100 lines). This is the active sprint.
2. **Do NOT read** the full `ROADMAP.md` (3600+ lines) or `ARCHITECTURE.MD` (1,451 lines) unless you need specific context. Use grep.
3. **Reference files** are listed in `NEXT-WORK.md`. Read them only when working on the relevant ticket.

## Execution Rules

- **One ticket at a time.** Start a ticket, finish it (all DoD checkboxes), update `NEXT-WORK.md` and `ROADMAP.md`, then move to the next.
- **Mark progress immediately.** When you complete a DoD item, check the box in both `ROADMAP.md` and `NEXT-WORK.md`.
- **Update NEXT-SESSION.md** at the end of each session with what you completed and what the next session should do.
- **Do not skip DoD items.** If a checkbox exists, it must be done before the ticket is marked complete.

## Branch & PR Discipline — Hard Rules

These rules are not negotiable without explicit user approval for the specific change.

- **Never push directly to `main`.** Every change goes through a PR, including one-line fixes, docs, typos, and "small" config tweaks. No exceptions.
- **One PR per logical change.** If you notice unrelated staleness while working on a task, file a ticket or open a separate PR. Doc audit + feature = two PRs.
- **Branch naming:** `feat/`, `fix/`, `chore/`, `docs/` prefix + kebab-case description.
- **Stated task is the only task.** Noticing a slow deploy, stale doc, or adjacent bug does not authorise expanding the PR. Ask the user first, or file a ticket.
- **Never force-push** to `main` or to any branch the user has pulled.
- **Never skip hooks** (`--no-verify`, `--no-gpg-sign`, etc) unless the user explicitly asks. If a hook fails, fix the underlying issue.

## Infrastructure Discipline — Hard Rules

- **Infra changes via `sst.config.ts` only.** Deploy through SST (`sst deploy --stage <stage>` or CI). Never use `aws ... create-...` / `aws ... delete-...` as a workaround when SST is the source of truth.
- **If SST state is broken, fix the state.** Use `sst refresh`, the `import` resource option, or `sst state remove` — documented Pulumi mechanisms. Do NOT route around SST with AWS CLI; it creates state drift that breaks the next deploy.
- **Destroying resources:** remove the declaration from `sst.config.ts`, commit, deploy. SST/Pulumi handles teardown. Never delete via AWS CLI to "save time".
- **Certificates, DNS, custom domains:** always via IaC. Manual steps (e.g. Vercel DNS records) must be clearly documented in the PR description as prerequisites.
- **Never create AWS resources without explicit user approval.** This includes ACM certs, IAM roles, S3 buckets, and any `aws ... create-...` command. Describe what will be created and wait for "yes".
- **Sensitive env vars and secrets** go in SST secrets or GitHub Actions secrets. Never commit, never echo in logs.

## Deploy Discipline — Hard Rules

- **Code → PR → CI → dev verify → prod.** Skipping dev verification for "it's just a small change" is how the `crese=0` bug reached prod.
- **Integration tests must pass before merge.** Mock/DSL tests catch query construction, not behavior. For search/query/OpenSearch changes, real-engine integration tests (or equivalent) are required pre-merge. Smoke tests are NOT a pre-merge gate.
- **After merge, verify dev before prod.** Wait for `deploy-dev` to complete, run smoke tests against dev, then deploy prod.
- **Prod deploys are manual and deliberate.** Never trigger `sst deploy --stage prod` without confirming the intended changes with the user.
- **State drift is a bug, not a workaround.** If `sst deploy` fails due to drift, stop and fix the drift cleanly — don't paper over it.

## Review & Quality Discipline

- **Address reviewer feedback at the root cause.** If a reviewer flags the same concern across multiple commits, the last fix was adjacent to the problem, not fixing it. Escalate to a fuller solution, don't keep patching symptoms.
- **Honest PR descriptions.** Every breaking change, every prod-affecting change, every scope expansion must be called out explicitly. Don't hide "will tear down prod resources" inside an optimisation PR.
- **Tests prove the fix.** A fix without a test that would have caught the original bug is not complete.
- **Self-audit before marking "ready".** Before asking for review, verify claims in the PR description are actually true (run the commands, check the tests, confirm the assertions).

## Code Rules

- **ESM only.** All imports use `.js` extension. All packages use `"type": "module"`.
- **Strict TypeScript.** `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`.
- **No `any`.** Use `unknown` with type narrowing. Exception: OpenSearch response types (use the `AnyRecord` pattern in `queries.ts`).
- **Zod for all validation.** API parameters, manifest contract, env vars.
- **OpenAPI from code.** Use `@hono/zod-openapi` `createRoute()` — never write OpenAPI spec by hand.
- **No vendor in hot path.** API key verification uses DynamoDB, never Unkey. See ARCHITECTURE.MD section 5.4.
- **Index by alias, never by versioned name.** Queries use `PRODUCT_REGISTRY[product].alias`.

## Build & Test

```bash
pnpm build            # Build all packages (via Turborepo)
pnpm typecheck        # Type-check all packages
pnpm lint             # Lint all packages
pnpm test             # Run all tests
pnpm --filter @prontiq/api typecheck   # Single package
```

## Key Architecture Decisions

- **Manifest contract** is the platform boundary. See ARCHITECTURE.MD section 5.1.2.
- **Product registry** in `packages/shared/src/constants.ts` is the source of truth for products.
- **Blue-green index deployment** with atomic alias swap. See ARCHITECTURE.MD section 5.2.
- **SST v4 + Pulumi** for infrastructure. Not CloudFormation.
- **Hono + @hono/zod-openapi** for API. OpenAPI spec auto-generated.
