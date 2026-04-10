# NEXT-WORK.md — Active Sprint

> Extracted from ROADMAP.md. This is what agents should work on NOW.
> Last updated: 2026-04-10

## Current Phase: P0 → P1A transition

### P0 Remaining (2 tickets)

**P0.3 — CI/CD Pipeline End-to-End**

- [x] GitHub Actions `check` job has been exercised on `main`
- [ ] `deploy-dev` succeeds from GitHub Actions
- [ ] SST Lambda bundle resolves workspace package `@prontiq/shared`
- [ ] GitHub Actions deploy role can write SST asset object tags (`s3:PutObjectTagging`)

**Evidence:** Main CI run `24234119406` fails in `deploy-dev` during `pnpm deploy:dev` after the `check` job succeeds.

**P0.6 — OpenSearch connectivity verification**

- [x] Lambda can reach `flat-white` OpenSearch domain via SigV4
- [ ] IAM role has `es:ESHttp*` permissions on the domain
- [x] Health check endpoint returns OpenSearch cluster status
- [ ] Connection pooling configured (maxSockets: 10, keepAlive: true)
- [ ] Verified: query against existing `addresses` alias returns results

**Evidence:** Live `/v1/health/opensearch` returns 200 and cluster green. The external flat-white `addresses` alias/data publish is still missing from the live alias list.

### Ready to Start: P1A — API Core

**P1A.1 — Migrate routes to @hono/zod-openapi** (implemented in current branch)

- [x] All 6 address routes use `createRoute()` with request/response schemas
- [x] `app.doc31("/openapi.json")` returns valid OpenAPI 3.1 spec
- [x] Spec includes all query parameters, response shapes, error codes
- [x] Spec is accessible at `/openapi.json` (no auth required)

**Verification:** Local built app returns status 200 for `/openapi.json`, `openapi: "3.1.0"`, and all 6 `/v1/address/*` paths. Live verification is gated by P0.3.

**P1A.2 — Address autocomplete endpoint** (verify against real data)

- [ ] Returns suggestions with correct fields
- [ ] `search_as_you_type` query works against OpenSearch `addresses` alias
- [ ] Response time < 50ms (warm)

**Blocked:** Requires the external `addresses` alias/data publish from P0.6.

### Next Achievable Item

**P0.3 residual fix — CI deploy-dev**

- [ ] Fix Lambda bundling so SST resolves workspace package `@prontiq/shared`
- [ ] Add the missing `s3:PutObjectTagging` permission to the GitHub Actions deploy role policy
- [ ] Re-run main CI and capture the passing `deploy-dev` run URL

**Alternative once Mintlify account is ready:** P1D.01 can start from the generated OpenAPI spec, but it creates new docs infrastructure and should explicitly call that out before implementation.

## Completed

- [x] P0.1 — IAM deploy role created (OIDC, Pulumi state, full resource perms)
- [x] P0.2 — SST bootstrap + first deploy (API: `59jym47ia1.execute-api.ap-southeast-2.amazonaws.com`, Dashboard: `d2ttwndpb06ei3.cloudfront.net`)
- [x] P0.4 — ESLint 9 flat config + Prettier + lint-staged
- [x] P0.5 — Dependabot configured (npm, weekly, grouped AWS SDK)
- [x] P1A.1 — Address routes migrated to @hono/zod-openapi and `/openapi.json` registered
- [x] Health check live: `/v1/health` returns `{"status":"ok"}`
- [x] Auth working: `/v1/address/autocomplete` without key returns `401 MISSING_API_KEY` with request_id

## Live Endpoints

| Endpoint  | URL                                                           |
| --------- | ------------------------------------------------------------- |
| API       | `https://59jym47ia1.execute-api.ap-southeast-2.amazonaws.com` |
| Dashboard | `https://d2ttwndpb06ei3.cloudfront.net`                       |

## Reference Files

| File                               | Purpose                            | When to Read                 |
| ---------------------------------- | ---------------------------------- | ---------------------------- |
| `ARCHITECTURE.MD`                  | Full platform design (1,451 lines) | When you need design context |
| `ROADMAP.md`                       | Master plan (69 tickets)           | When you need the full scope |
| `sst.config.ts`                    | Infrastructure definition          | When working on infra        |
| `packages/shared/src/constants.ts` | Product registry, tier limits      | When working on auth/billing |
| `packages/api/src/index.ts`        | API entry point                    | When working on P1A routes   |
