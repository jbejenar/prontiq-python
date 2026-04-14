# NEXT-WORK.md — Active Sprint

> Extracted from ROADMAP.md. This is what agents should work on NOW.
> Last updated: 2026-04-14

## Current Phase: P1B — Auth & Billing (provisioning chain)

### What's Live

| Surface | URL | Status |
|---------|-----|--------|
| API | `https://api.prontiq.dev` | ✅ 6 endpoints, 15M docs, custom domain |
| Docs | `https://docs.prontiq.dev` | ✅ Mintlify Luma theme, OpenAPI playground |
| TypeScript SDK | `sdks/typescript/` (`@prontiq/sdk` v0.1.0) | ✅ Auto-generated; npm publish pending NPM_TOKEN secret |
| OpenAPI spec | `/openapi.json` (committed in `packages/docs/`) | ✅ Generated from Zod, CI verifies freshness |
| Ingestion | EventBridge → Step Function → Fargate → OpenSearch | ✅ Automated, alias swap, blue-green |

### Live Endpoints (all require `X-Api-Key` header)

```
GET /v1/address/autocomplete?q=16+heath+cres&state=VIC&limit=5
GET /v1/address/validate?q=16+heath+crescent+hampton+east+vic+3188
GET /v1/address/enrich?id=GAVIC420559144
GET /v1/address/reverse?lat=-33.8568&lon=151.2153&radius=200&limit=5
GET /v1/address/lookup/postcode?postcode=2000&limit=10
GET /v1/address/lookup/suburb?suburb=bondi+beach&state=NSW&limit=10
```

### Recent ships (since last NEXT-WORK update)

- **P1A.11**: Search relevance + fuzzy matching (autocomplete operator AND, validate fuzzy, suburb fuzzy + matched name, lookup limit params) — PR #38
- **P1F.01**: `api.prontiq.dev` custom domain (ACM cert via Vercel DNS, SST gated to prod)
- **P1D.04**: Speakeasy TypeScript SDK pipeline (CI generates SDK PR on spec change)
- **P1D.01**: Mintlify docs site (live at `docs.prontiq.dev`)
- **OpenAPI schema expansion**: full G-NAF response shape (geocode, boundaries, electorates) typed in spec
- **CI spec-drift gate**: blocks merges when `openapi.json` is stale vs Zod schemas

### Next: Auth & Billing (P1B)

The platform serves real traffic from `api.prontiq.dev`. The prod DynamoDB keys table is currently seeded with one manual key (`pq_live_prod_000000000000000000000000`). Goal: replace manual provisioning with the Clerk → Unkey → Stripe → DynamoDB chain.

**Sequence:**

1. **P1B.01 — Clerk auth** for the dashboard (sign-up, login, OAuth)
2. **P1B.02 — Clerk webhook → Unkey key issuance** on `user.created`
3. **P1B.03 — Unkey webhook → DynamoDB sync** (hot-path verification stays in DynamoDB)
4. **P1B.04 — Stripe customer + checkout** for tier upgrade
5. **P1B.05 — Stripe metered billing** per-product per-call

### Backlog (not blocking auth)

- P1A.09: API Gateway caching ($15/month, sub-5ms repeat queries)
- P1A.10: WAF + API Gateway throttling
- Increase OpenSearch gp3 to 50GB (before next quarterly G-NAF ingest)
- ABN pipeline (second product, P2)

## Reference Files

| File | Purpose | When to Read |
|------|---------|--------------|
| `ARCHITECTURE.MD` | Full platform design | When you need design context |
| `ROADMAP.md` | Master plan (72 tickets) | When you need the full scope |
| `sst.config.ts` | Infrastructure definition | When working on infra |
| `packages/shared/src/constants.ts` | Product registry, tier limits | When working on auth/billing |
| `packages/api/src/index.ts` | API entry point | When working on routes |
| `packages/api/src/search/queries.ts` | OpenSearch queries | When tuning search |
| `packages/docs/openapi.json` | Committed OpenAPI spec | Source of truth for SDK/docs |
| `.speakeasy/workflow.yaml` | SDK generation config | When adding SDK languages |
| `docs/operations/ingestion-runbook.md` | Ingestion operator guide | When running ingestion |
