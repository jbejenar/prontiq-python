# NEXT-SESSION.md — Session Execution Log

> Per-session summary of what happened. Newest session first.
> Purpose: continuity across session breaks without reading git log.

---

## Session 12 — 2026-04-17 → 2026-04-18

**Focus:** P1B.05 PR 2/3 — Clerk webhook handler. Repo audit; PR 1 (control-plane recovery) → prod; PR 2 (webhook handler) → dev → prod after iterating through 7 review-bot findings + a CI race + a deploy-script architectural rewrite.

### Shipped to prod

- **PR #94 — `@prontiq/control-plane` package (P1B.05 PR 1/3 + closes P1B.07).** Recovered the `provisionOrg` service from prior uncommitted dist artefacts; added `writeAudit` / `buildAuditTransactItem` helpers; added `OrgEnvelopeRecord` + `AuditRecord` to `@prontiq/shared`; ADR-002 (`docs/decisions/002-control-plane-package.md`) captures (a) why control-plane is a separate package, (b) why we recovered the dist instead of rewriting, (c) the dual audit API rationale, (d) four hardening contracts surfaced during 4 rounds of code review (read-result discriminated union, audit idempotency via eventId+now, welcome-email boundary guard, unified DDB error classifier with safe-default-on-ambiguity). 51 control-plane tests + 1 integration test against DDB Local.
- **PR #95 — Clerk webhook handler + SST infra (P1B.05 PR 2/3 v1).** First version. Wired `POST /webhooks/clerk` on existing PqApi → new `PqClerkWebhook` Lambda that calls `provisionOrg`. Used `sst.Secret` (SSM-backed). Merged but failed deploy-dev with `SecretMissingError`.
- **PR #97 — Hotfix replacing #96.** Switched secrets from `sst.Secret` (SSM) to `process.env` (matches existing `WELCOME_EMAIL_FROM` GitHub-Environment pattern). Plus 5 review-bot findings addressed (Bug 1 admin-role gate `org:admin` not just `admin`; Bug 2 verified primary email via `@clerk/backend` users.getUser; Bug 3 wire `CLERK_ADMIN_ROLES` end-to-end through deploy plumbing; Bug 4 `Verification.status === "verified"` check; Bug 5 `getAdminRoles` whitespace fallback; Bug 6 `$util.secret()` Pulumi state encryption; Bug 7 trim secret values before validation).
- **PR #98 — Hotfix: drop `AWS_REGION` from PqClerkWebhook env.** Lambda reserved key; `CreateFunction` rejected explicit values. Doc-comment so it can't sneak back.
- **Prod deploy (`Deploy to Production` workflow on `a8f181b`)** triggered manually after dev was verified end-to-end on real Svix traffic (`org_3CTU4Oh1XTqVdEGcyTBGqRWujCm` provisioned: Stripe customer + envelope + audit row, all atomic; 4 subsequent retries returned `already_exists` with zero side effects). Prod smoke-tested with non-admin role payload — handler skipped correctly in 13ms.

### Verification evidence

- 129 tests pass workspace-wide (10 shared + 50 control-plane + 21 ingestion + 20 api + 28 webhooks).
- 4 integration tests pass against `amazon/dynamodb-local:2.5.2` (1 control-plane, 3 webhooks).
- Dev `prontiq-keys-dev` has `ORG#org_3CTU4Oh1XTqVdEGcyTBGqRWujCm` envelope with `tier: "free"`, `hasFirstKey: false`, `stripeCustomerId: cus_UM5zw8xl8HgS9n`.
- Dev `prontiq-audit-dev` has 1 `ORG_PROVISIONED` row (idempotency invariant proven across 5 deliveries).
- Stripe Dashboard shows 1 customer with `metadata.orgId: org_3CTU4Oh1XTqVdEGcyTBGqRWujCm`.
- Prod `POST /webhooks/clerk` returns 401 on unsigned, 200 `{skipped: true, reason: "non_admin_membership"}` on signed non-admin payload, all secrets present with correct prefixes (`whsec_`, `sk_`, `sk_`).
- `PqClerkWebhookErrors` CloudWatch alarm in OK state on both dev + prod.

### Hard lessons (added to memory / process)

- **Discipline matters between tickets.** I shipped PR #94 → merged → IMMEDIATELY started PR 2 work without waiting for dev verify or prod promotion. User ("discipline... do we not wait for dev deploy then prod?") corrected. Sequence is: PR → CI → merge → CI auto-deploy-dev → manual dev smoke → `sst diff --stage prod` (via GitHub Actions, not local) → manual prod deploy via Deploy to Production workflow → manual prod smoke. No skipping.
- **Pre-merge risk register IS a checklist, not just commentary.** I flagged "verify the admin-role identifier against an actual payload before merging" as Risk #6 in PR #95's plan but didn't actually do it; bot caught Bug 1 (`admin` ≠ `org:admin`) — would have been a CRITICAL silent-failure bug in prod. Future risk-register items must be done, not noted.
- **Existing conventions trump new patterns.** I introduced `sst.Secret()` in PR #95 without recognising the codebase's existing convention is GitHub Environment vars/secrets exported via the deploy workflow's `env:` block (matching `WELCOME_EMAIL_FROM`). The two patterns can't coexist for one value. Always grep for the existing pattern before introducing a new one.
- **The build script's recursive deletion was a latent bug** (added by ts-package-build.mjs walking tsconfig references and deleting upstream dist). Pre-PR-94 it never surfaced because no concurrent reads of shared/dist happened during builds; PR 94 introduced control-plane as a downstream of shared and triggered the race. Fix: each package's build only cleans its own outputs; `tsc --build` (no `--force`) respects upstream tsbuildinfo.
- **Lambda has reserved env keys.** `AWS_REGION` is one — runtime auto-populates it, `CreateFunction` rejects explicit values. Caught only at deploy time because SST/Pulumi config eval and `pnpm typecheck` both accept the value locally.

### Next session should start with

1. Read NEXT-WORK.md.

2. **P1B.05 PR 3/3 — `POST /v1/account/setup` recovery endpoint.** Plan it as a separate `PqAccount` Lambda on the existing `PqApi` so the address-API `$default` Lambda's IAM stays minimal. Architectural notes captured in `docs/decisions/002-control-plane-package.md`.

   **Auth contract (single source of truth for this endpoint):**
   - Verify the `Authorization: Bearer <jwt>` header via `@clerk/backend`'s `verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY })`. This delegates JWKS resolution to the Clerk Backend API — no `CLERK_ISSUER` / `CLERK_JWKS_URL` / `jwtKey` needed for verification.
   - **Required env var:** `CLERK_SECRET_KEY` only. Already configured in the dev + prod GitHub Environment secrets (operator set 2026-04-17). Wired through the deploy workflows' `env:` block alongside the webhook's existing `CLERK_SECRET_KEY` use.
   - **Not used by this endpoint:** `CLERK_ADMIN_ROLES` (webhook-only — for the `organizationMembership.created` role gate), `CLERK_ISSUER` / `CLERK_JWKS_URL` (used by the frontend Clerk SDK and the future `/account` page in P1C, not by API-side JWT verify under the secretKey model).
   - **Claims extracted from the verified JWT:** `sub` → `userId`, `org_id` → `orgId`. If `org_id` is absent (user is signed in but has no active org context), return `400 NO_ACTIVE_ORG` per the existing API error envelope.
   - **Email resolution:** mirror the webhook's pattern — call `clerkClient.users.getUser(userId)` via the same `@clerk/backend` client and use the verified primary email (the `Bug 4` invariant from PR #97 — never trust client-side claims for the `ownerEmail` going to Stripe).

   **Implementation flow:**
   - New `packages/api/src/middleware/clerk-jwt.ts` — Hono middleware that verifies the JWT and sets `c.set("clerkPrincipal", { userId, orgId })`.
   - New `packages/api/src/routes/account.ts` — `POST /v1/account/setup` route. Reuses `createProvisioningService` from `@prontiq/control-plane`. Maps `ProvisioningResult.status` → 200 (`already_exists`), 201 (`created`), 503 (`retryable_failure`), 500 (`fatal_failure`).
   - New `packages/api/src/account-handler.ts` — separate Lambda entry point (mounts only the Clerk-JWT middleware + account routes; does NOT include the address routes or API-key auth middleware).
   - `sst.config.ts` — `api.route("ANY /v1/account/{proxy+}", { handler: ".../account-handler.handler", link: [...], permissions: [SES], environment: { CLERK_SECRET_KEY, STRIPE_SECRET_KEY, ... } })`. Reuse the same `REQUIRED_WEBHOOK_SECRETS` fail-fast guard pattern (or factor it to cover the account Lambda too).
   - Update CORS on `PqApi` to include `POST` + `Authorization` (currently `GET` + `X-Api-Key` only) so the future browser dashboard can call this endpoint.

3. **Operator follow-up that doesn't block next ticket:** SES domain identity verify for `prontiq.dev` in `ap-southeast-2` + sandbox-out request. Steps in `docs/runbooks/clerk-webhook.md`. Until done, every webhook delivery logs `emailSent: false` (provisioning durability unaffected).

4. **Observability gap noted but deferred:** when `sendSignedSesEmail` returns `false` (SES-rejected `response.ok`), no log line tells the operator why. Worth adding a `console.warn` with the SES response status code — small follow-up on the next webhook PR.

---

## Session 11 — 2026-04-17 (earlier)

**Focus:** P1B.05 PR 1/3 — `@prontiq/control-plane` package recovery. PR #94. Shipped to prod 2026-04-17. See PR #94 description + `docs/decisions/002-control-plane-package.md` for the four hardening contracts surfaced through 4 rounds of code review.

---

## Session 10 — 2026-04-17 (audit + planning)

**Focus:** Audit roadmap-vs-built, surface "ghost" `packages/control-plane/dist/` (compiled but never committed source), plan P1B.05 with 3-PR breakdown. Plan written to `~/.claude/plans/ok-scan-the-repo-composed-dragon.md` (gitignored).

---

## Session 9 — 2026-04-16

**Focus:** P1B.04 — DynamoDB Tables (4 tables + schema)

**Completed:**

- [x] `sst.config.ts`: 4 new `sst.aws.Dynamo` components (`PqAuthKeys`, `PqAuthUsage`, `PqAuthAudit`, `PqSesSuppressions`) with stage-qualified physical names (`prontiq-keys`, `prontiq-usage`, `prontiq-audit`, `prontiq-ses-suppressions` in prod; `-{stage}` suffix elsewhere). Additive to the legacy `PqKeys` table — no hot-path linkage yet (that's P1B.04b).
- [x] `PqAuthUsage` has the `newHash-redirect-index` GSI with `KEYS_ONLY` projection — required by P1B.10 billing cron for rotation-chain attribution.
- [x] `PqAuthKeys` has `orgId-index` GSI for the CREATE handler's key-limit check and LIST handler's per-org query.
- [x] TTL enabled on `prontiq-usage`, `prontiq-audit`, `prontiq-ses-suppressions` (attribute name `ttl`). Value semantics (90d/365d/etc.) owned by writer tickets (P1B.07/.08).
- [x] All tables default to `PAY_PER_REQUEST` (SST default, verified at `.sst/platform/src/components/aws/dynamo.ts:522`).
- [x] `packages/api/src/middleware/redirect-gsi.integration.test.ts` — 2-test smoke suite (indexed-match + sparse-miss), verified against `amazon/dynamodb-local:2.5.2` locally.
- [x] `packages/api/package.json`: `test:integration` script runs both OpenSearch and DDB suites.
- [x] `.github/workflows/ci.yml`: added `dynamodb` service container to `integration-test` job + readiness poll + `DYNAMODB_TEST_URL` env.
- [x] Roadmap: P1B.04 status → `in-progress`, 6/7 DoD boxes checked, last box deferred pending user `sst diff --stage prod`.
- [x] NEXT-WORK.md: P1B.04 struck through (pending merge), added to Recent ships with unlock notes.

**Verification evidence:**

- `pnpm lint` → clean (all 4 packages)
- `pnpm typecheck` → clean (5 packages, cached)
- `pnpm build` → clean
- `pnpm test` → 23/23 pass (shared 10, api 13)
- REDIRECT GSI integration test against DDB Local 2.5.2 → 2/2 pass (`✔ REDIRECT GSI returns exactly one item keyed by newHash`, `✔ REDIRECT GSI returns zero items for unknown newHash`)
- `pnpm generate:openapi` → no diff (no route changes this ticket)

**Deliberately not done (scope boundary):**

- No link of new tables into the API Lambda handler. The hot-path rewrite (hash-based GetItem, REDIRECT fallback, usage-table writes) is P1B.04b.
- No data migration from the legacy `PqKeys` table — that's P1B.04b.
- No `sst diff --stage prod` capture — autonomous session has no prod credentials. User runs this before merge per CLAUDE.md infra rule; that's the 7th DoD box.

**Autonomy boundary note (IMMUTABLE RULE 3):**

This PR creates 4 new AWS DynamoDB tables on merge-to-main via the dev deploy. Documented in PR body. User review at merge time is the approval gate.

**Next session should start with:**

1. Read NEXT-WORK.md.
2. After user merges this PR and runs `sst diff --stage prod` (checks the 7th DoD box), flip P1B.04 to `status: done`, bump summary counters (P1B 1/13 → 2/13, total 23/76 → 24/76).
3. P1B.04b is now unblocked (needs P1B.02 ✅ + P1B.04 ✅). That ticket is the atomic schema-and-middleware cutover: migrate data from legacy `ApiKeyTable` → new `prontiq-keys`, rewrite `auth.ts`/`usage.ts` for hash-based GetItem + REDIRECT fallback + usage-table writes, rotate the seed key `pq_live_prod_000000000000000000000000`. Start there.
4. P1B.01 (Clerk) and P1B.03 (Stripe) still require external account setup — defer until the user confirms accounts/secrets are ready.

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
