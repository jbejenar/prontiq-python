# NEXT-WORK.md — Active Sprint

> Extracted from ROADMAP.md. This is what agents should work on NOW.
> Last updated: 2026-04-09

## Current Phase: P0 → P1A transition

### P0 Remaining (1 ticket)

**P0.6 — OpenSearch connectivity verification**

- [ ] Lambda can reach `flat-white` OpenSearch domain via SigV4
- [ ] IAM role has `es:ESHttp*` permissions on the domain
- [ ] Health check endpoint returns OpenSearch cluster status
- [ ] Connection pooling configured (maxSockets: 10, keepAlive: true)
- [ ] Verified: query against existing `addresses` alias returns results

**Note:** P0.3 (CI/CD) needs testing from GitHub Actions — push to remote and verify workflow runs.

### Ready to Start: P1A — API Core

**P1A.1 — Migrate routes to @hono/zod-openapi**

- [ ] All 6 address routes use `createRoute()` with request/response schemas
- [ ] `app.doc("/openapi.json")` returns valid OpenAPI 3.1 spec
- [ ] Spec includes all query parameters, response shapes, error codes
- [ ] Spec is accessible at `/openapi.json` (no auth required)

**P1A.2 — Address autocomplete endpoint** (verify against real data)

- [ ] Returns suggestions with correct fields
- [ ] `search_as_you_type` query works against OpenSearch `addresses` alias
- [ ] Response time < 50ms (warm)

## Completed

- [x] P0.1 — IAM deploy role created (OIDC, Pulumi state, full resource perms)
- [x] P0.2 — SST bootstrap + first deploy (API: `59jym47ia1.execute-api.ap-southeast-2.amazonaws.com`, Dashboard: `d2ttwndpb06ei3.cloudfront.net`)
- [x] P0.4 — ESLint 9 flat config + Prettier + lint-staged
- [x] P0.5 — Dependabot configured (npm, weekly, grouped AWS SDK)
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
