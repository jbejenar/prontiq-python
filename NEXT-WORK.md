# NEXT-WORK.md — Active Sprint

> Extracted from ROADMAP.md. This is what agents should work on NOW.
> Last updated: 2026-04-16 (Session 9)

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
GET /v1/address/autocomplete?q=9+endeavour+cou&state=QLD&limit=5
GET /v1/address/validate?q=9+endeavour+court+coffin+bay+sa+5607
GET /v1/address/enrich?id=GASA_422206807
GET /v1/address/reverse?lat=-33.8568&lon=151.2153&radius=200&limit=5
GET /v1/address/lookup/postcode?postcode=2000&limit=10
GET /v1/address/lookup/suburb?suburb=bondi+beach&state=NSW&limit=10
```

### Recent ships (since last NEXT-WORK update)

- **P1B.04** (pending user merge): 4 DynamoDB tables declared in `sst.config.ts` (`prontiq-keys`, `prontiq-usage`, `prontiq-audit`, `prontiq-ses-suppressions`) + REDIRECT GSI integration test + CI DDB Local service. 6/7 DoD boxes checked; `sst diff --stage prod` deferred to user pre-merge. Unblocks P1B.04b/.06/.07/.08.
- **P1B.02**: Key module (`packages/shared/src/keys.ts` — `generateKey` + `hashKey`, pure `node:crypto`; unblocks P1B.04b/.05/.09)
- **P1A.11**: Search relevance + fuzzy matching (autocomplete operator AND, validate fuzzy, suburb fuzzy + matched name, lookup limit params) — PR #38
- **P1F.01**: `api.prontiq.dev` custom domain (ACM cert via Vercel DNS, SST gated to prod)
- **P1D.04**: Speakeasy TypeScript SDK pipeline (CI generates SDK PR on spec change)
- **P1D.01**: Mintlify docs site (live at `docs.prontiq.dev`)
- **OpenAPI schema expansion**: full G-NAF response shape (geocode, boundaries, electorates) typed in spec
- **CI spec-drift gate**: blocks merges when `openapi.json` is stale vs Zod schemas

### Next: Auth & Billing (P1B — v2.2, DDB-native)

The platform serves real traffic from `api.prontiq.dev`. The prod keys table today is the legacy `ApiKeyTable` (raw-key PK, nested usage map), seeded with one manual key (`pq_live_prod_000000000000000000000000`). Goal: replace manual provisioning with the Clerk → Stripe → DynamoDB chain (DDB-native keys, SHA-256 hash-based lookup, per ADR-001 and ARCHITECTURE.MD §5.5).

**13-ticket sequence** (see `ROADMAP.md` §P1B for full DoD):

1. **P1B.01 — Clerk Application Setup** (OAuth, webhook, secrets)
2. ~~**P1B.02 — Key Module (crypto primitives)**~~ ✅ shipped 2026-04-16 (`packages/shared/src/keys.ts`)
3. **P1B.03 — Stripe Setup** (products, tiered metered Prices, Pricing Table, PLANS constants, Smart Retries)
4. ~~**P1B.04 — DynamoDB Tables**~~ 🟡 PR pending user merge (Session 9) — 6/7 DoD boxes checked; `sst diff --stage prod` deferred to user pre-merge
5. **P1B.04b — Data Migration + Middleware Cutover** — migration script + `auth.ts`/`usage.ts` rewrite (hash lookup, REDIRECT fallback, usage-table writes) + seed-key rotation. Atomic flip of schema and code. **Unblocked once P1B.04 PR merges.**
6. **P1B.05 — Clerk Webhook Handler** (provisioning + idempotency lock)
7. **P1B.06 — Stripe Webhook Handler** (4 events + 14-day grace)
8. **P1B.07 — `prontiq-audit` Writer Helper**
9. **P1B.08 — `prontiq-ses-suppressions` + Bounce Handler** (requires SES prod-access exit)
10. **P1B.09 — Burst Rate Limiter Middleware** (in-memory token bucket; concurrency caveat)
11. **P1B.10 — Billing Cron** (hourly → Stripe via subscriptionItems)
12. **P1B.11 — Month-close Lambda** (00:30 UTC day 1)
13. **P1B.12 — Auth Middleware Integration Test** (every error code + REDIRECT + burst + paymentOverdue — exercises the post-cutover middleware from P1B.04b)

**Dependencies:** .01/.02/.03/.04 parallel; .04b blocks on .02 + .04 (needs crypto module + tables before it can rewrite middleware and run migration); .05 blocks on .01/.02/.03/.04; .06 blocks on .03/.04; .07/.08 block on .04; **.09 blocks on .02 + .04b** (burst limiter consumes `record.rateLimit` from the post-cutover auth context — wiring against the legacy shape would be throwaway work); .10 blocks on .03/.04/.06; .11 blocks on .10; .12 blocks on .05/.09/.04b.

**Scope boundary (important):** P1B.02 is pure crypto primitives only. The auth/usage middleware refactor (hash-based lookup, REDIRECT fallback, usage-table writes) ships in P1B.04b because it's inseparable from the schema cutover. Legacy Unkey code / env vars were removed in PR #68 — no P1B ticket owns that cleanup.

### Backlog (not blocking auth)

- P1A.09: API Gateway caching ($15/month, sub-5ms repeat queries)
- P1A.10: WAF + API Gateway throttling
- Increase OpenSearch gp3 to 50GB (before next quarterly G-NAF ingest)
- ABN pipeline (second product, P2)

## Reference Files

| File | Purpose | When to Read |
|------|---------|--------------|
| `ARCHITECTURE.MD` | Full platform design | When you need design context |
| `ROADMAP.md` | Master plan (76 tickets) | When you need the full scope |
| `docs/decisions/001-remove-unkey.md` | ADR — why Unkey was removed | When auditing architecture decisions |
| `sst.config.ts` | Infrastructure definition | When working on infra |
| `packages/shared/src/constants.ts` | Product registry, tier limits | When working on auth/billing |
| `packages/api/src/index.ts` | API entry point | When working on routes |
| `packages/api/src/search/queries.ts` | OpenSearch queries | When tuning search |
| `packages/docs/openapi.json` | Committed OpenAPI spec | Source of truth for SDK/docs |
| `.speakeasy/workflow.yaml` | SDK generation config | When adding SDK languages |
| `docs/operations/ingestion-runbook.md` | Ingestion operator guide | When running ingestion |
