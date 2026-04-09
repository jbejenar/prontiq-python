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

## Branch Safety

- Work on `main` for now (solo developer phase).
- When collaborators join: feature branches, PR required, CI must pass.
- Never force push to main.

## Key Architecture Decisions

- **Manifest contract** is the platform boundary. See ARCHITECTURE.MD section 5.1.2.
- **Product registry** in `packages/shared/src/constants.ts` is the source of truth for products.
- **Blue-green index deployment** with atomic alias swap. See ARCHITECTURE.MD section 5.2.
- **SST v3 + Pulumi** for infrastructure. Not CloudFormation.
- **Hono + @hono/zod-openapi** for API. OpenAPI spec auto-generated.
