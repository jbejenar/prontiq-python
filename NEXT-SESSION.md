# NEXT-SESSION.md — Session Execution Log

> Per-session summary of what happened. Newest session first.
> Purpose: continuity across session breaks without reading git log.

---

## Session 8 — 2026-04-16

**Focus:** P1B.02 — Key Module (crypto primitives)

**Completed:**

- [x] `packages/shared/src/keys.ts` with `generateKey()` + `hashKey()` — pure `node:crypto`, no AWS SDK, no DDB
- [x] `packages/shared/src/keys.test.ts` — 10 unit tests (shape, prefix, length, hex regex, determinism, known SHA-256 vector, 1000-call dedupe)
- [x] Re-exported from `packages/shared/src/index.ts`
- [x] Added `test` script to `@prontiq/shared` (`node --test dist/keys.test.js`, matches ingestion convention)
- [x] Wired `@types/node` into `packages/shared` (devDep + `types: ["node"]` in tsconfig) — required because the composite shared project wasn't auto-including `@types/*`
- [x] Roadmap: P1B.02 status → done, all DoD boxes checked, P1B summary 0/13 → 1/13, total 22/76 → 23/76
- [x] NEXT-WORK.md: P1B.02 struck through in sequence, added to Recent ships

**Verification evidence:**

- `pnpm --filter @prontiq/shared test` → 10/10 pass
- `pnpm lint` → clean
- `pnpm typecheck` → clean
- `pnpm build` → clean
- `pnpm test` → all packages pass (shared 10, api 13, ingestion 21)
- `grep -E "^import" packages/shared/src/keys.ts` → single `node:crypto` import, no AWS SDK / Unkey

**Honest caveats:**

- Roadmap DoD evidence line said "Vitest run" but the repo already standardised on `node:test` (see `packages/ingestion/src/lib.test.ts`). Followed the repo convention to avoid introducing a parallel test framework.
- Shared package previously had no `test` script — added one rather than letting the turbo `test` task silently skip the package.

**Next session should start with:**

1. Read NEXT-WORK.md
2. P1B.04 — DynamoDB Tables (SST v4 declarations for `prontiq-keys`, `prontiq-usage`, `prontiq-audit`, `prontiq-ses-suppressions`). This is the next parallel-safe ticket; only P0.02 is required, and that's already done. **New AWS resources → flag for user approval in the PR per IMMUTABLE RULE 3.**
3. P1B.01 (Clerk) and P1B.03 (Stripe) both require external account setup — defer until the user confirms accounts/secrets are ready.
4. After P1B.04 ships, P1B.04b becomes unblocked (requires P1B.02 ✅ + P1B.04).

---

## Session 7 — 2026-04-14

**Focus:** Search relevance + comprehensive doc audit

**Completed:**

- [x] PR #38 — autocomplete `operator: "and"` + `fuzziness: "AUTO"` (fixes typo'd-prefix queries so the right street type ranks first)
- [x] Validate fuzzy matching for typo'd full addresses
- [x] Suburb lookup: fuzzy keyword match with `prefix_length: 1`, returns matched suburb name (not input echo)
- [x] Postcode + suburb lookups: `limit` query param (default 10)
- [x] Roadmap: P1A.11 ticket added, P1D.01/P1D.04/P1F.01 marked complete, P1A.03 confidence value fixed (0 → "none")
- [x] README: stack updated (SST v3→v4, SDKs live), progress table refreshed (20/70 done)
- [x] NEXT-WORK.md: full refresh — current URLs, recent ships, P1B as next sprint
- [x] AGENTS.md: stack note updated
- [x] CHANGELOG.md: populated with Unreleased + 2026-04-13 entries

**Honest caveats:**

- Fuzzy behavior on `search_as_you_type` n-gram subfields is undocumented in OpenSearch — needs dev verification once PR #38 deploys
- Latency impact of fuzzy + prefix_length untested (expected sub-30ms)

**Next session should start with:**

1. Read NEXT-WORK.md
2. Verify PR #38 on dev API after CI deploy: `q=9+endeavour+cuo` returns COURT first; `q=9+endevour+court` finds via fuzzy
3. If verified, deploy PR #38 to prod
4. Begin P1B (auth & billing): Clerk → Stripe → DynamoDB provisioning chain (DDB-native keys — Unkey removed; see ADR-001)

---

## Session 6 — 2026-04-13 (evening)

**Focus:** `api.prontiq.dev` custom domain + ECR state issue

**Completed:**

- [x] PR #36 merged — added domain config to ApiGatewayV2
- [x] PR #37 merged — fixed ECR state drift via Pulumi `import`, holistic stage-qualification (ECR repo, task family, log group, custom domain all gated to prod)
- [x] ACM cert validated (after CAA record fight — Vercel needed `0 issue "amazon.com"` at root)
- [x] Vercel CNAME: `api.prontiq.dev` → API Gateway domain
- [x] Prod deploy successful, all 6 endpoints verified on `api.prontiq.dev`
- [x] Seeded prod API key in DynamoDB (`pq_live_prod_000000000000000000000000`)

**Issues encountered:**

- ACM kept failing with CAA_ERROR until root-level `amazon.com` CAA record was added
- ECR repo existed in AWS but not in SST state (from interrupted earlier deploy) — required `import` directive

---

## Session 5 — 2026-04-13 (afternoon)

**Focus:** Speakeasy TypeScript SDK pipeline

**Completed:**

- [x] PR #33 merged — Speakeasy config (`.speakeasy/workflow.yaml`, `.speakeasy/gen.yaml`)
- [x] PR #37 (above) merged related ECR/domain fixes
- [x] CI spec-drift gate added (regenerates `openapi.json` from Zod, fails if stale)
- [x] Pinned Speakeasy version (v1.761.3)
- [x] `validate.confidence: 0` → `"none"` for clean string enum (Speakeasy can't handle mixed string/int union)
- [x] Speakeasy generated `@prontiq/sdk` v0.1.0 (PR #35 merged) — published structure ready for npm

**Manual steps required:**

- `SPEAKEASY_API_KEY` GitHub secret (added)
- `NPM_TOKEN` GitHub secret (still pending)
- Workflow permissions: "Allow GitHub Actions to create and approve pull requests" (enabled)

---

## Session 4 — 2026-04-13 (morning)

**Focus:** Mintlify docs

**Completed:**

- [x] PR #32 merged — full Mintlify rewrite, Luma theme, 18 MDX pages
- [x] OpenAPI playground integrated, all 6 endpoints
- [x] `docs.prontiq.dev` live
- [x] PR #34 merged — removed "early access" framing, fixed broken dashboard links
- [x] Sidebar navigation fix (groups nested in tabs)
- [x] Root URL redirect to `/guides/introduction`

---

## Session 3 — 2026-04-10

**Focus:** P1A.01 OpenAPI route migration + roadmap audit

**Completed:**

- [x] Merged staging cleanup through PR #11 and updated `main` locally
- [x] Started branch `codex/openapi-address-routes`
- [x] Migrated all 6 address routes from plain Hono handlers to `@hono/zod-openapi` `createRoute()` definitions
- [x] Registered unauthenticated `GET /openapi.json` before `/v1/*` auth middleware
- [x] Reused shared Zod query schemas and added OpenAPI descriptions for address query parameters
- [x] Added response schemas for success and common API errors
- [x] Added `X-Api-Key` OpenAPI security metadata to authenticated address operations
- [x] Fixed `/v1/address/reverse` OpenAPI params so `lat` and `lon` are required numeric query params while preserving runtime string coercion
- [x] Verified the built app returns OpenAPI 3.1 with all 6 `/v1/address/*` paths locally
- [x] Updated ROADMAP.md, NEXT-WORK.md, README.md, and this session log

**No new infrastructure:** This session changed API code and documentation only. Mintlify setup remains future work and will create docs infrastructure when started.

**Residual blockers found during audit:**

- P0.03 remains pending: main CI run `24234119406` passes `check` but fails `deploy-dev`
- CI deploy blocker 1: SST Lambda bundling cannot resolve workspace package `@prontiq/shared`
- CI deploy blocker 2: GitHub Actions deploy role lacks `s3:PutObjectTagging` on the SST asset bucket
- P0.06 remains partially blocked externally: live `/v1/health/opensearch` returns green cluster, but the `addresses` alias is absent from the live OpenSearch alias list

**Next session should start with:**

1. Read NEXT-WORK.md
2. Fix P0.03 residuals: SST workspace package bundling and `s3:PutObjectTagging` IAM permission
3. Re-run main CI and record the passing deploy-dev workflow URL
4. If Mintlify account is ready, plan P1D.01 explicitly as new docs infrastructure

---

## Session 1 (continued) — 2026-04-09

**Focus:** P0 execution — shipped infrastructure foundation

**Completed:**

- [x] P0.4 — ESLint 9 flat config + Prettier + lint-staged (zero errors, all packages pass)
- [x] P0.5 — Dependabot configured (.github/dependabot.yml — npm, weekly, grouped AWS SDK + dev deps)
- [x] P0.1 — IAM deploy role `prontiq-platform-deploy-role` created
  - OIDC trust for `repo:jbejenar/prontiq-platform:*`
  - Full permissions: Lambda, APIGW, DynamoDB, IAM, CW, OpenSearch, S3, WAF, EventBridge, Step Functions, SNS, SQS, CloudFront, ECR, SSM + Pulumi state
- [x] P0.2 — SST v3 bootstrap + first deploy
  - Fixed: Clerk `<ClerkProvider>` crashes build without publishableKey → made conditional
  - Fixed: Clerk `<UserButton>` crashes prerender → removed from initial scaffold
  - Fixed: OpenSearch client crashes Lambda init with empty endpoint → lazy initialization
  - Fixed: duplicate `deploy:staging` in package.json
  - API live: `https://59jym47ia1.execute-api.ap-southeast-2.amazonaws.com`
  - Dashboard live: `https://d2ttwndpb06ei3.cloudfront.net`
  - Health: `/v1/health` → `{"status":"ok"}`
  - Auth: `/v1/address/autocomplete` → `401 MISSING_API_KEY` with request_id
- [x] ROADMAP.md created: 69 tickets across 11 epics, 5 phases
- [x] Planning artifacts: NEXT-WORK.md, NEXT-SESSION.md, CLAUDE.md

**Roadmap progress:** 5/69 tickets (P0.1, P0.2, P0.4, P0.5 done; P0.3 needs CI test, P0.6 needs OpenSearch)

**Next session should start with:**

1. Read NEXT-WORK.md
2. P0.6 — OpenSearch connectivity (set OPENSEARCH_ENDPOINT env, test SigV4 query)
3. P0.3 — Push to GitHub, verify CI workflow
4. P1A.1 — Migrate routes to @hono/zod-openapi (OpenAPI spec generation)
5. P1A.2-7 — Verify address endpoints against real OpenSearch data

---

## Session 1 (initial) — 2026-04-09

**Focus:** Repo scaffolding + architecture audit

**Completed:**

- [x] Read ARCHITECTURE.MD (1,148 lines at start)
- [x] Audited architecture as Google Senior Fellow: found 6 critical + 6 significant issues
  - C1: mappings.json shared across versions → per-version
  - C2: SHA-256 re-streams files → S3 native checksums
  - C3: Rate limiting state unspecified → API Gateway + DynamoDB sliding window
  - C4: Index naming inconsistent → standardized `{product}-{version}`
  - C5: No NDJSON content validation → sampling step added
  - C6: SST v3 deploy role wrong permissions → Pulumi state backend
  - S1-S6: OpenSearch HA trigger, caching, usage reliability, key-rotation REDIRECT semantics, retention, idempotency lock
  - M1-M9: Health endpoint, request ID, WAF, force merge, cold starts, Clerk migration, billing, connections
- [x] Wrote zero-downtime index lifecycle section (5.2) with blue-green deployment, alias swap, rollback, backups, capacity planning
- [x] Applied all fixes to ARCHITECTURE.MD (now 1,451 lines)
- [x] Scaffolded monorepo: 10 packages, 66 files
  - `@prontiq/shared`: types, constants, Zod schemas (real code)
  - `@prontiq/api`: Hono app, 6 address routes, auth/usage/request-id middleware, OpenSearch queries (real code)
  - `@prontiq/dashboard`: Next.js 15 + Clerk skeleton
  - `@prontiq/ingestion`: 6 Step Function handler stubs
  - `@prontiq/webhooks`: 3 webhook handler stubs
  - `@prontiq/docs`: Mintlify config
  - Plugins: 3 stubs
- [x] Ran ariscan --fix: generated AGENTS.md, .agentignore, .devcontainer, .husky, CODEOWNERS, PR template, ADR template, CHANGELOG, .gitleaks.toml
- [x] Audited scaffold (round 2): found 12 bugs
  - SST not in package.json, missing index.ts files, no global error handler, type mismatch, SHA-256 accepts non-hex, env vars not linked, Infinity breaks JSON, missing Clerk middleware, product context bug
- [x] Fixed all 12 bugs
- [x] Audited scaffold (round 3): 0 new real bugs (2 false positives verified)
- [x] All packages build clean: `turbo build` passes
- [x] Created ROADMAP.md: 69 tickets across 11 epics, 5 phases
- [x] Created NEXT-WORK.md, NEXT-SESSION.md, CLAUDE.md

**Roadmap progress:** 0/69 tickets (scaffolding complete, P0 ready to start)

**Next session should start with:**

1. Read NEXT-WORK.md
2. P0.4 (ESLint + Prettier) — no blockers, can do immediately
3. P0.5 (Dependabot) — no blockers, quick win
4. P0.1 (IAM role) — requires AWS console/CLI access
5. Then P0.2 (SST bootstrap) once role exists
