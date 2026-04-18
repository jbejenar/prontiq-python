# NEXT-WORK.md — Active Sprint

> Extracted from ROADMAP.md. This is what agents should work on NOW.
> Last updated: 2026-04-18 (Session 13)

## Current Phase: P1B.05 complete; selecting next P1B ticket

### What's Live

| Surface | URL | Status |
|---------|-----|--------|
| API | `https://api.prontiq.dev` | ✅ 6 endpoints, 15M docs, custom domain |
| Docs | `https://docs.prontiq.dev` | ✅ Mintlify Luma theme, OpenAPI playground |
| Clerk webhook | `https://api.prontiq.dev/webhooks/clerk` | ✅ verifies Svix sig, provisions ORG envelope on `organizationMembership.created` (admin role) |
| Account setup | `POST https://api.prontiq.dev/v1/account/setup` | ✅ Clerk-JWT recovery endpoint; same `provisionOrg` code path as the webhook; idempotent |
| TypeScript SDK | `sdks/typescript/` (`@prontiq/sdk` v0.1.0) | ✅ Auto-generated; npm publish pending NPM_TOKEN secret |
| OpenAPI spec | `/openapi.json` (committed in `packages/docs/`) | ✅ Generated from Zod, CI verifies freshness |
| Ingestion | EventBridge → Step Function → Fargate → OpenSearch | ✅ Automated, alias swap, blue-green |

### Platform State

- Hash-based API key auth (`prontiq-keys` + `prontiq-usage`) is live in production.
- The P1B.04/P1B.04b cutover shipped on 2026-04-16 and has been exercised in prod.
- **P1B.05 complete (2026-04-18).** Clerk webhook handler (`POST /webhooks/clerk`) AND `POST /v1/account/setup` recovery endpoint both live in dev + prod. Webhook dev verified end-to-end with real Svix traffic on 2026-04-18: `org_3CTU4Oh1XTqVdEGcyTBGqRWujCm` provisioned (Stripe customer `cus_UM5zw8xl8HgS9n`, ORG envelope, audit row, all atomic via `TransactWriteItems`); 4 subsequent Svix retries returned `already_exists` with zero side effects. Account-setup endpoint runs the same `createProvisioningService().provisionOrg(...)` code path as the webhook, so a delayed/missed webhook is recoverable from the dashboard. Three Lambdas now serve `PqApi`: address-API `$default` (hot path), `PqClerkWebhook` (Svix-signed), `PqAccount` (Clerk-JWT-authenticated `/v1/account/*`).
- **`@prontiq/control-plane` package** (recovered from prior design + hardened) provides `createProvisioningService()`, `writeAudit()` / `buildAuditTransactItem()`, AND `resolvePrimaryEmail()`. Both ingress paths (Clerk webhook + `/v1/account/setup`) consume the same provisioning service AND the same verified-primary-email helper — invariants enforced once at the package boundary.
- The legacy raw-key table is retained only for rollback/soak; the old `pq_live_prod_...` seed key has been rotated and revoked.
- Future prod seed-key rotation now has an operator command:
  `PRONTIQ_API=https://api.prontiq.dev pnpm --filter @prontiq/api rotate:prod-key`
- CI, `deploy-dev`, and `deploy-prod` are green. SST secrets sourced from GitHub Environment secrets/vars (per the existing `WELCOME_EMAIL_FROM` convention) — `sst.Secret` / SSM-backed pattern was tried in PR 2 and reverted because it conflicted with the GitHub-Environment pattern (see `docs/runbooks/clerk-webhook.md`).

### Live Endpoints (all require `X-Api-Key` header except where noted)

```
GET  /v1/address/autocomplete?q=9+endeavour+cou&state=QLD&limit=5
GET  /v1/address/validate?q=9+endeavour+court+coffin+bay+sa+5607
GET  /v1/address/enrich?id=GASA_422206807
GET  /v1/address/reverse?lat=-33.8568&lon=151.2153&radius=200&limit=5
GET  /v1/address/lookup/postcode?postcode=2000&limit=10
GET  /v1/address/lookup/suburb?suburb=bondi+beach&state=NSW&limit=10
POST /webhooks/clerk    (Svix-signed; no API key — control-plane provisioning)
POST /v1/account/setup  (Clerk JWT; not API key — recovery provisioning)
```

### Recent Ships

- **P1B.05 PR 3/3 (prod-cutover 2026-04-18)**: `POST /v1/account/setup` recovery endpoint live in dev + prod. Clerk-JWT-authenticated (`@clerk/backend.verifyToken({ secretKey })` with 5s clock skew); reads `sub` + `org_id` from the verified JWT; calls `resolvePrimaryEmail` (shared with the webhook via `@prontiq/control-plane`) then `createProvisioningService().provisionOrg(...)`. New `PqAccount` Lambda separate from address-API `$default` (keeps the hot path bundle minimal: `@clerk/backend` + `@prontiq/control-plane` only land in the new Lambda — verified by adding a doc-comment in `packages/api/src/index.ts` forbidding those imports). Mounted via `api.route("ANY /v1/account/{proxy+}", accountFn.arn)` with explicit-route precedence in front of `$default`. CORS extended on `PqApi` to allow POST + Authorization (additive — no rejection of existing GET / X-Api-Key flows). New `PqAccountErrors` CloudWatch alarm wired to `PqIngestAlerts` SNS topic. Mintlify reference page documents operator preconditions (Clerk dashboard JWT template needs `{ "org_id": "{{org.id}}" }` in BOTH dev and prod tenants; frontend must `setActive({ organization })`). Closes P1B.05 ticket.
- **P1B.05 PR 3a refactor (prod-cutover 2026-04-18)**: `resolvePrimaryEmail` + `EmailLookupResult` moved from `packages/webhooks/src/clerk.ts` into `packages/control-plane/src/clerk.ts` so the new `/v1/account/setup` endpoint can import the same helper without an `api → webhooks` dep direction. `@clerk/backend` now declared explicitly on `@prontiq/control-plane` (no transitive hoisting). 12 new node:test cases for the helper + ADR-002 contract #6 added. Pure refactor; webhook behaviour identical at runtime. PR #100.
- **P1B.05 PR 2/3 (prod-cutover 2026-04-18)**: Clerk webhook handler (`POST /webhooks/clerk` on the existing `PqApi`) live in dev + prod. Verifies Svix signature, gates on `role ∈ {org:admin, admin}`, resolves verified primary email via Clerk Backend API (does NOT trust `public_user_data.identifier`), calls `createProvisioningService().provisionOrg(...)`. End-to-end DoD verified on real Svix traffic in dev (1 envelope + 1 audit row across 5 deliveries — idempotency proven). New `PqClerkWebhook` Lambda (separate from address-API `$default`) + 3 GitHub Environment secrets sourced via deploy workflows + `$util.secret()` wrapping in Pulumi state + `REQUIRED_WEBHOOK_SECRETS` fail-fast deploy guard + `PqClerkWebhookErrors` CloudWatch alarm. Operator runbook in `docs/runbooks/clerk-webhook.md`. Welcome emails currently `emailSent: false` until SES domain identity for `prontiq.dev` is verified in `ap-southeast-2` and account is out of sandbox (operator one-time, doesn't affect provisioning durability). Recovery endpoint `POST /v1/account/setup` is the next ticket (P1B.05 PR 3/3).
- **P1B.07**: audit writer helper shipped in `packages/control-plane/src/audit.ts` (location revised from `shared` because the helper needs the AWS SDK DDB clients). Dual API: `buildAuditTransactItem` for atomic grouping inside `TransactWriteItems`; `writeAudit` for standalone callers. Lands as part of the new `@prontiq/control-plane` package alongside the recovered `provisionOrg` service for P1B.05.
- **P1B.02**: key module shipped (`packages/shared/src/keys.ts` — `generateKey` + `hashKey`)
- **P1B.04**: DynamoDB auth/billing tables shipped (`prontiq-keys`, `prontiq-usage`, `prontiq-audit`, `prontiq-ses-suppressions`)
- **P1B.04b**: legacy-to-v2.2 cutover shipped (`auth.ts` hash lookup, REDIRECT fallback, usage-table writes, migration path)
- **Prod cutover executed**: `prontiq-keys` / `prontiq-usage` populated and live auth verified on `api.prontiq.dev`
- **Prod seed-key rotation executed**: old `pq_live_prod_...` key revoked; replacement `pq_live_...` key active
- **Deterministic TS build path shipped**: referenced-project outputs pruned before rebuilds
- **Ingestion Docker build fixed**: `.dockerignore` + Dockerfile changes prevent host artifact leakage
- **Operator tooling added**: `pnpm --filter @prontiq/api rotate:prod-key`
- **P1A.11**: Search relevance + fuzzy matching (autocomplete operator AND, validate fuzzy, suburb fuzzy + matched name, lookup limit params) — PR #38
- **P1F.01**: `api.prontiq.dev` custom domain (ACM cert via Vercel DNS, SST gated to prod)
- **P1D.04**: Speakeasy TypeScript SDK pipeline (CI generates SDK PR on spec change)
- **P1D.01**: Mintlify docs site (live at `docs.prontiq.dev`)
- **OpenAPI schema expansion**: full G-NAF response shape (geocode, boundaries, electorates) typed in spec
- **CI spec-drift gate**: blocks merges when `openapi.json` is stale vs Zod schemas

## Next Candidates

### 1. Finish auth/billing control plane

- ~~P1B.05 — Clerk webhook handler + recovery endpoint~~ ✅ shipped (2026-04-18)
- ~~P1B.06 — Stripe webhook handler~~ ✅ shipped (2026-04-18) — `POST /webhooks/stripe` now handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed` log-only with replay-safe claim/finalize webhook markers, strict metered-item validation, full same-tier subscription reconciliation, usage-flag resets on paid-plan transitions, and best-effort `past_due` email delivery.
- ~~P1B.10 — billing cron~~ ✅ shipped (2026-04-18) — hourly `PqBillingCron` now reads `REGISTRY#active-keys`, walks the `newHash-redirect-index` chain, sums accumulated credits per product family/month, and emits replay-safe Stripe meter events using deterministic `pendingMeterEventIdentifier` / `pendingMeterTargetCumulativeCount` state on the current hash usage row before advancing `lastPushedCumulativeCount`. Scope discovery now uses current entitlements plus outstanding/pending usage rows, so same-tier removals and downgrades still flush their final deltas instead of under-billing.
- ~~P1B.07 — `prontiq-audit` writer helper~~ ✅ shipped
- P1B.08 — SES suppression / bounce handling (also unblocks the welcome email path going green from `emailSent: false`)
- P1B.11 — month-close job

### 2. Finish ingestion hardening

- P1E.05 — cache invalidation after alias swap
- P1E.06 — cleanup Lambda completion / enforcement

### 3. Finish operational visibility

- P1F.02 — monitoring, alerting, dashboards

### 4. Rebuild customer-facing account surface

- P1C remains effectively a fresh build; the older dashboard codepath is gone and should not be treated as partially live.

## Recommended Next Work

Recommended priority:

1. **P1B.08 — SES suppression / bounce handling.** With P1B.06 now live, the billing control plane path exists end-to-end and the remaining email hardening gap is suppression/bounce ingestion rather than webhook delivery. This ticket should lift the current “best-effort only” suppression reads into a full subscriber that keeps `prontiq-ses-suppressions` current.
2. **P1B.11 — month-close job.** The hourly billing cron is now live, including redirect-chain attribution and replay-safe pending meter markers. The next billing hardening step is the day-1 finalisation sweep that marks previous-month scopes `closed: true` so the hourly cron stops revisiting them permanently. This work should be planned against the new credits model, not the older “raw request count is the billing unit” assumption.
3. P1F.02 — monitoring + alerting. Four CloudWatch alarms now exist on the customer-control-plane surfaces: `PqClerkWebhookErrors`, `PqStripeWebhookErrors`, `PqBillingCronErrors`, `PqAccountErrors`. Need broader coverage (DDB throttle, Stripe API error rate, OpenSearch query latency) before P1C dashboard work goes live.

Reason:

- P1B.05 (Clerk webhook + recovery endpoint) closed end-to-end on 2026-04-18 — auth + provisioning paths are durable and idempotent.
- P1B.06 and P1B.10 closed the webhook + hourly meter-push halves of billing automation on 2026-04-18, and the auth path now applies endpoint credit weights inline before writing family usage totals. The biggest remaining P1B billing gap is month-close plus the customer-facing account/billing surface that exposes those credits clearly.
- SES suppression cleanup and broader monitoring should land before P1C dashboard work so the customer-visible flows have full alarm coverage.

### Operator follow-ups (one-time, not blocking next ticket)

- **SES domain identity verification** for `prontiq.dev` in `ap-southeast-2`. Until this lands, every webhook delivery logs `emailSent: false` (provisioning durability unaffected). Steps in `docs/runbooks/clerk-webhook.md` § preconditions.
- **SES sandbox removal** in `ap-southeast-2` via AWS support case (24h turnaround). Required before welcome emails can reach unverified addresses.
- **Stripe metadata contract** for `dev` and `prod`: the recurring plan Price must carry `metadata.prontiqTier`, and each metered Stripe Product must carry `metadata.prontiqProduct`. `STRIPE_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY` remain the only required Stripe GitHub Environment secrets.

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
| `packages/api/src/scripts/rotate-prod-key.ts` | Prod key rotation operator command | When rotating the seed key |
| `packages/api/src/search/queries.ts` | OpenSearch queries | When tuning search |
| `packages/docs/openapi.json` | Committed OpenAPI spec | Source of truth for SDK/docs |
| `.speakeasy/workflow.yaml` | SDK generation config | When adding SDK languages |
| `docs/operations/ingestion-runbook.md` | Ingestion operator guide | When running ingestion |
| `docs/runbooks/p1b04b-cutover.md` | Auth/billing cutover + rotation runbook | When operating the v2.2 key model |
