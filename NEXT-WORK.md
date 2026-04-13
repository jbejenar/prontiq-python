# NEXT-WORK.md — Active Sprint

> Extracted from ROADMAP.md. This is what agents should work on NOW.
> Last updated: 2026-04-13

## Current Phase: P1D / P1B / P1C — Docs & Monetization

### What's Live

| Surface | URL | Status |
|---------|-----|--------|
| API | `https://59jym47ia1.execute-api.ap-southeast-2.amazonaws.com` | ✅ 6 endpoints, 15M docs |
| Dashboard | `https://d38dvktb4dyib0.cloudfront.net` | ✅ Deployed |
| OpenAPI spec | `/openapi.json` | ✅ Auto-generated |
| Ingestion | EventBridge → Step Function → Fargate → OpenSearch | ✅ Automated |

### Live Endpoints (all require `X-Api-Key` header)

```
GET /v1/address/autocomplete?q=16+heath+cres&state=VIC&limit=5
GET /v1/address/validate?q=16+heath+crescent+hampton+east+vic+3188
GET /v1/address/enrich?id=GAVIC420559144
GET /v1/address/reverse?lat=-33.8568&lon=151.2153&radius=200&limit=5
GET /v1/address/lookup/postcode?postcode=2000
GET /v1/address/lookup/suburb?suburb=bondi+beach&state=NSW
```

### Next: Developer Experience + Monetization

**P1D.01 — Mintlify Docs**
- Point at `/openapi.json`, auto-generate interactive docs
- Free tier (1 editor, custom domain, playground)
- Live at `docs.prontiq.dev`

**P1B — Auth & Billing (Clerk + Unkey + Stripe)**
- Clerk: sign-up/login for dashboard
- Unkey: API key issuance + webhook sync to DynamoDB
- Stripe: metered per-product billing
- Replace manual test key with real provisioning chain

### Backlog

- P1A.09: API Gateway caching ($15/month, sub-5ms repeat queries)
- P1A.10: WAF + API Gateway throttling
- Increase gp3 to 50GB (before next quarterly ingest)
- ABN pipeline (second product)

## Completed

- [x] P0.1 — IAM deploy role (OIDC)
- [x] P0.2 — SST bootstrap + first deploy
- [x] P0.3 — CI/CD pipeline (lint → typecheck → build → test → deploy)
- [x] P0.4 — ESLint 9 + Prettier + lint-staged
- [x] P0.5 — Dependabot
- [x] P0.6 — OpenSearch connectivity (SigV4, 15M docs live)
- [x] P1E.01-05 — Ingestion pipeline (EventBridge → Router → Step Function → Fargate → alias swap)
- [x] P1A.01 — Routes migrated to @hono/zod-openapi
- [x] P1A.02 — Address autocomplete (150-250ms warm)
- [x] P1A.03 — Address validate (high/medium/low confidence)
- [x] P1A.04 — Address enrich (boundaries, electorates, geocodes)
- [x] P1A.05 — Address reverse geocode (geo_distance with meters)
- [x] P1A.06 — Postcode lookup (aggregation with localities)
- [x] P1A.07 — Suburb lookup (postcodes + address count)

## Reference Files

| File | Purpose | When to Read |
|------|---------|--------------|
| `ARCHITECTURE.MD` | Full platform design | When you need design context |
| `ROADMAP.md` | Master plan (69 tickets) | When you need the full scope |
| `sst.config.ts` | Infrastructure definition | When working on infra |
| `packages/shared/src/constants.ts` | Product registry, tier limits | When working on auth/billing |
| `packages/api/src/index.ts` | API entry point | When working on routes |
| `packages/api/src/search/queries.ts` | OpenSearch queries | When tuning search |
| `docs/operations/ingestion-runbook.md` | Ingestion operator guide | When running ingestion |
