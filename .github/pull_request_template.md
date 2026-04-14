## Summary

<!-- 1-3 sentences. What does this PR do and why? Link relevant issues. -->

## Scope

- [ ] This PR is **one logical change** (not "search tuning + doc audit + infra tweak")
- [ ] Branch name follows `feat/`, `fix/`, `chore/`, or `docs/` prefix convention

## Changes

<!-- Bullet-point list of what changed. -->

-

## Impact

- [ ] No prod-affecting changes, **OR**
- [ ] Prod impact analysis included below (resources affected, traffic data, rollback URL implications)

## Verification

Tick each item or write `N/A — <reason>`. Do NOT leave boxes unchecked without explanation.

**Always required:**

- [ ] Claims in this PR description are verified (not assumed) — cite command output or files

**Required when code changes:**

- [ ] `pnpm typecheck` passes — or `N/A — docs/config-only PR`
- [ ] `pnpm lint` passes — or `N/A — docs/config-only PR`
- [ ] `pnpm test` passes — or `N/A — docs/config-only PR`

**Required when specific areas change:**

- [ ] Search/query code (`packages/api/src/search/**`, `routes/**`, `shared/src/validation.ts`): `pnpm --filter @prontiq/api test:integration` passes against real OpenSearch — or `N/A — not a search/query change`
- [ ] Infra changes (`sst.config.ts`, `.github/workflows/`): `sst diff --stage prod` reviewed and matches intent — or `N/A — no infra change`

## Overrides (if any)

<!--
If this PR breaks a CLAUDE.md rule with user approval, name the rule and why.
Leave as "None" if no overrides.
-->

None.

## AI-Code Review Checklist

<!-- If AI tools (Copilot, Claude, Codex, etc.) were used, verify: -->

- [ ] AI-generated code has been reviewed line-by-line by a human
- [ ] No hallucinated imports, APIs, or dependencies were introduced
- [ ] No secrets, credentials, or PII were hardcoded
- [ ] Error handling is correct (not overly broad catch-all or swallowed errors)
- [ ] Security-sensitive logic was verified against documentation (auth, crypto, input validation)
- [ ] Tests actually assert meaningful behavior (not just "it doesn't throw")
- [ ] License compatibility checked for any new dependencies
- [ ] AI-suggested patterns are consistent with existing codebase conventions

## Rollback

<!-- How to revert if something goes wrong? -->

Revert this PR via `git revert <merge-commit>`.
