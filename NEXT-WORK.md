# NEXT-WORK.md — Active Sprint

> Extracted from ROADMAP.md. This is what agents should work on NOW.
> Last updated: 2026-04-26 (P1B.18 complete; P1B.19 next)

## Current Phase: P1B.19

### What's Live

| Surface        | URL                                                | Status                                                                                         |
| -------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| API            | `https://api.prontiq.dev`                          | ✅ 6 endpoints, 15M docs, custom domain                                                        |
| Docs           | `https://docs.prontiq.dev`                         | ✅ Mintlify Luma theme, OpenAPI playground                                                     |
| Clerk webhook  | `https://api.prontiq.dev/webhooks/clerk`           | ✅ verifies Svix sig, provisions ORG envelope on `organizationMembership.created` (admin role) |
| Stripe webhook | `https://api.prontiq.dev/webhooks/stripe`          | ✅ deployed on the legacy billing path; retained during Lago migration                         |
| Account setup  | `POST https://api.prontiq.dev/v1/account/setup`    | ✅ Clerk-JWT recovery endpoint; same `provisionOrg` code path as the webhook; idempotent       |
| TypeScript SDK | `sdks/typescript/` (`@prontiq/sdk` v0.1.0)         | ✅ Auto-generated; npm publish pending NPM_TOKEN secret                                        |
| OpenAPI spec   | `/openapi.json` (committed in `packages/docs/`)    | ✅ Generated from Zod, CI verifies freshness                                                   |
| Ingestion      | EventBridge → Step Function → Fargate → OpenSearch | ✅ Automated, alias swap, blue-green                                                           |

### Platform State

- Hash-based API key auth (`prontiq-keys` + `prontiq-usage`) is live in production.
- The P1B.04/P1B.04b cutover shipped on 2026-04-16 and has been exercised in prod.
- **P1B.05 complete (2026-04-18).** Clerk webhook handler (`POST /webhooks/clerk`) AND `POST /v1/account/setup` recovery endpoint both live in dev + prod. Webhook dev verified end-to-end with real Svix traffic on 2026-04-18: `org_3CTU4Oh1XTqVdEGcyTBGqRWujCm` provisioned (Stripe customer `cus_UM5zw8xl8HgS9n`, ORG envelope, audit row, all atomic via `TransactWriteItems`); 4 subsequent Svix retries returned `already_exists` with zero side effects. Account-setup endpoint runs the same `createProvisioningService().provisionOrg(...)` code path as the webhook, so a delayed/missed webhook is recoverable from the dashboard. Three Lambdas now serve `PqApi`: address-API `$default` (hot path), `PqClerkWebhook` (Svix-signed), `PqAccount` (Clerk-JWT-authenticated `/v1/account/*`).
- **Legacy billing path remains live.** `P1B.06`, `P1B.10`, and `P1B.11` are implemented in the current platform, but they are no longer the forward commercial direction. Canonical architecture now treats them as migration-era Stripe infrastructure.
- **P1B.08 complete (2026-04-19; rollout verified 2026-04-19).** SES feedback ingestion, suppression-aware welcome / `past_due` / quota emails, and 80% / 100% quota notifications are live in dev + prod. `prontiq.dev` is verified in SES with DKIM active, simulator-based positive-send plus bounce / complaint flows were exercised in both stages, and the post-merge config-set IAM/send-path fixes are deployed. **P1B.08a remains pending** for custom MAIL FROM on `bounce.prontiq.dev`, DMARC alignment correction, SES production-access approval, and normal-recipient verification.
- **P1B.11 complete (2026-04-19).** `PqMonthClose` is live in dev + prod on `cron(30 0 1 * ? *)`. It reuses the same replay-safe pending meter identifier model as `PqBillingCron`, finalizes previous-month deltas exactly once, and marks the current-hash previous-month scope `closed=true` so the hourly cron stops revisiting it permanently. Dev integration and manual service verification proved: remaining previous-month delta push, zero-delta close, predecessor-only chain finalization, rerun idempotency, and hourly-cron skip on closed prior-month scopes.
- **P1B.09 complete (2026-04-19).** Per-key burst limiting is now explicitly extracted into `packages/api/src/middleware/rate-limit.ts`, remains enforced in the live auth path, and is covered by both unit and integration tests for burst exhaustion, refill, key isolation, and no orphan usage increments on `RATE_LIMITED`.
- **P1B.12 complete (2026-04-19).** The auth middleware integration suite is now reconciled to the real post-cutover surface: direct unknown/revoked key failures, REDIRECT success writing usage on `newHash`, no orphan usage on pre-increment failures, and the atomic free-tier quota race are all covered in `packages/api/src/middleware/auth.integration.test.ts`. The roadmap ticket no longer claims webhook idempotency, first-key creation, or a standalone seed script.
- **P1B.14 complete (2026-04-25).** The Lago migration now has a platform-owned
  `customerId` contract (`pq_cust_<ulid>`), `prontiq-customers` mapping
  shape, `lagoExternalCustomerId = customerId`, nullable provider linkage for
  Lago `lago_id` and Stripe `cus_...`, backfill/conflict rules, and the
  invariant that API-key request auth must not read `prontiq-customers`.
- **P1B.15 complete (2026-04-25).** `prontiq-customers` infra is declared,
  new provisioning writes `customerId` plus a customer row atomically,
  `backfill:customers` can dry-run/apply legacy envelope/API-key
  denormalization, and the address API can emit `BillingUsageEventV1` to
  standard SQS behind `BILLING_EVENTS_ENABLED`. Default remains `false` until
  Lago setup/replay smoke checks pass in the target environment.
- **P1B.16 complete (2026-04-25).** `PqLagoEventForwarder` consumes queued
  billing events, validates deterministic event IDs, stores delivery evidence in
  `prontiq-billing-event-deliveries`, and sends minimal Lago usage events with
  `transaction_id = eventId`, derived `external_subscription_id`, and
  `properties.credits = creditDelta`. The worker is deployed in dev and prod;
  `BILLING_EVENTS_ENABLED` still stays false until canonical Lago
  metrics/subscriptions and replay smoke checks pass per environment.
- **P1B.17 complete (2026-04-25).** `POST /webhooks/lago` verifies Lago HMAC
  signatures, claims `X-Lago-Unique-Key` in `prontiq-lago-webhook-events`,
  reconciles consumed subscription/invoice events into local key/envelope state,
  marks prior Lago-period usage rows closed, and keeps PAYG uncapped but
  tracked. The route is gated by `LAGO_WEBHOOK_RECONCILIATION_ENABLED`; the API
  counter source remains `calendar` unless `COUNTER_PERIOD_SOURCE=lago` is
  deliberately enabled after reconciliation is proven.
- **P1B.18a complete (2026-04-26).** The Lago runtime is deployed in dev and
  prod, the repo-owned smoke helper is in place, API-produced billing events
  have been smoke-tested in dev and prod, `BILLING_EVENTS_ENABLED=true` is
  deployed, `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true` is configured for both
  GitHub Environments and deployed Lambdas, `COUNTER_PERIOD_SOURCE` remains
  `calendar`, and alert policy is ALARM-only for email-backed operational
  alarms. Dev/prod webhook certification completed with unique keys
  `prontiq-platform-dev-smoke-20260426T051602Z` and
  `prontiq-platform-prod-smoke-20260426T051812Z`; replays returned
  `200 duplicate`.
- **P1B.18 complete (2026-04-26).** `PqAccount` now exposes Prontiq-owned
  account billing APIs for billing summary, Lago portal access, and gated
  Free/PAYG plan changes. Mutations are Clerk-admin-only, require
  `Idempotency-Key`, and write `prontiq-billing-actions`. Lago webhook
  reconciliation now preserves current entitlements during pending transitions
  and waits for active replacement snapshots before changing local enforcement
  state.
- **P1F.02 complete (2026-04-19).** The prod observability baseline is live and verified: `PqIngestAlerts` prod email subscriptions via `ALERT_EMAILS`, `prontiq-production` dashboard, prod alarms for address API 5xx/Lambda error rate and OpenSearch yellow/red/low-storage, `PqApi` X-Ray tracing with DynamoDB + OpenSearch segments, and structured JSON logs across Lambda execution paths. SNS email delivery was verified by forcing `PqApiLambdaErrorRate` to `ALARM` and confirming receipt on a confirmed subscriber.
- **P1F.03 complete (2026-04-20).** `@prontiq/observability` is live in `dev` and `prod`, Honeycomb traces are verified for `prontiq-api`, `prontiq-webhooks`, `prontiq-billing`, and `prontiq-ingestion` in both environments, and the deployed-stage rollback path is `HONEYCOMB_ENABLED=false` rather than secret removal.
- **P1C.07 complete (2026-04-20).** `apps/landing` and `apps/console` now have Tailwind v3.4, app-local shadcn/ui primitives, dark mode, responsive shell foundations, and app-local Vitest + Testing Library. `apps/console` now carries an env-gated real Clerk auth boundary that builds/tests cleanly without Clerk keys and enables real sign-in when they are present.
- **P1C.01 complete (2026-04-20).** `apps/landing` now ships the real `prontiq.dev` surface: proxy-backed live hero demo via `@prontiq/web-component`, config-owned Prontiq Free card, Clerk modal CTA wrappers, and app-local rate limiting on the landing demo proxy. The old Stripe Pricing Table integration is now treated as a superseded interim implementation. Forward-looking billing UX now aligns to the Lago commercial architecture.
- **`@prontiq/control-plane` package** (recovered from prior design + hardened) provides `createProvisioningService()`, `writeAudit()` / `buildAuditTransactItem()`, AND `resolvePrimaryEmail()`. Both ingress paths (Clerk webhook + `/v1/account/setup`) consume the same provisioning service AND the same verified-primary-email helper — invariants enforced once at the package boundary.
- The legacy raw-key table is retained only for rollback/soak; the old `pq_live_prod_...` seed key has been rotated and revoked.
- Future prod seed-key rotation now has an operator command:
  `PRONTIQ_API=https://api.prontiq.dev pnpm --filter @prontiq/api rotate:prod-key`
- CI, `deploy-dev`, and `deploy-prod` are green as of `c054245` on 2026-04-25.
  SST secrets sourced from GitHub Environment secrets/vars (per the existing
  `WELCOME_EMAIL_FROM` convention) — `sst.Secret` / SSM-backed pattern was tried
  in PR 2 and reverted because it conflicted with the GitHub-Environment pattern
  (see `docs/runbooks/clerk-webhook.md`).

### Live Endpoints (all require `X-Api-Key` header except where noted)

```
GET  /v1/address/autocomplete?q=9+endeavour+cou&state=QLD&limit=5
GET  /v1/address/validate?q=9+endeavour+court+coffin+bay+sa+5607
GET  /v1/address/enrich?id=GASA_422206807
GET  /v1/address/reverse?lat=-33.8568&lon=151.2153&radius=200&limit=5
GET  /v1/address/lookup/postcode?postcode=2000&limit=10
GET  /v1/address/lookup/suburb?suburb=bondi+beach&state=NSW&limit=10
POST /webhooks/clerk    (Svix-signed; no API key — control-plane provisioning)
POST /webhooks/lago     (Lago HMAC signed; no API key — target reconciliation)
POST /v1/account/setup  (Clerk JWT; not API key — recovery provisioning)
GET  /v1/account/billing
POST /v1/account/billing/plan-change
POST /v1/account/billing/portal-session
```

### Recent Ships

- **P1B.05 PR 3/3 (prod-cutover 2026-04-18)**: `POST /v1/account/setup` recovery endpoint live in dev + prod. Clerk-JWT-authenticated (`@clerk/backend.verifyToken({ secretKey })` with 5s clock skew); reads `sub` + `org_id` from the verified JWT; calls `resolvePrimaryEmail` (shared with the webhook via `@prontiq/control-plane`) then `createProvisioningService().provisionOrg(...)`. New `PqAccount` Lambda separate from address-API `$default` (keeps the hot path bundle minimal: `@clerk/backend` + `@prontiq/control-plane` only land in the new Lambda — verified by adding a doc-comment in `packages/api/src/index.ts` forbidding those imports). Mounted via `api.route("ANY /v1/account/{proxy+}", accountFn.arn)` with explicit-route precedence in front of `$default`. CORS extended on `PqApi` to allow POST + Authorization (additive — no rejection of existing GET / X-Api-Key flows). New `PqAccountErrors` CloudWatch alarm wired to `PqIngestAlerts` SNS topic. Mintlify reference page documents operator preconditions (Clerk dashboard JWT template needs `{ "org_id": "{{org.id}}" }` in BOTH dev and prod tenants; frontend must `setActive({ organization })`). Closes P1B.05 ticket.
- **P1B.05 PR 3a refactor (prod-cutover 2026-04-18)**: `resolvePrimaryEmail` + `EmailLookupResult` moved from `packages/webhooks/src/clerk.ts` into `packages/control-plane/src/clerk.ts` so the new `/v1/account/setup` endpoint can import the same helper without an `api → webhooks` dep direction. `@clerk/backend` now declared explicitly on `@prontiq/control-plane` (no transitive hoisting). 12 new node:test cases for the helper + ADR-002 contract #6 added. Pure refactor; webhook behaviour identical at runtime. PR #100.
- **P1B.05 PR 2/3 (prod-cutover 2026-04-18)**: Clerk webhook handler (`POST /webhooks/clerk` on the existing `PqApi`) live in dev + prod. Verifies Svix signature, gates on `role ∈ {org:admin, admin}`, resolves verified primary email via Clerk Backend API (does NOT trust `public_user_data.identifier`), calls `createProvisioningService().provisionOrg(...)`. End-to-end DoD verified on real Svix traffic in dev (1 envelope + 1 audit row across 5 deliveries — idempotency proven). New `PqClerkWebhook` Lambda (separate from address-API `$default`) + 3 GitHub Environment secrets sourced via deploy workflows + `$util.secret()` wrapping in Pulumi state + deployed-stage fail-fast secret validation + `PqClerkWebhookErrors` CloudWatch alarm. Operator runbook in `docs/runbooks/clerk-webhook.md`. Welcome emails are now suppression-aware and best-effort through the shared SES helper and configuration-set path.
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

### 1. Commercial architecture migration

- ~~P1B.05 — Clerk webhook handler + recovery endpoint~~ ✅ shipped (2026-04-18)
- ~~P1B.06 — Stripe webhook handler~~ ✅ shipped, but now legacy migration context
- ~~P1B.10 — billing cron~~ ✅ shipped, but now legacy migration context
- ~~P1B.11 — month-close~~ ✅ shipped, but now legacy migration context
- ~~P1B.07 — `prontiq-audit` writer helper~~ ✅ shipped
- ~~P1B.08 — SES suppression / bounce handling~~ ✅ shipped (2026-04-19)
- ~~P1B.09 — burst rate limiter middleware~~ ✅ shipped (2026-04-19)
- ~~P1B.14 — CustomerId + customer mapping contract~~ ✅ shipped (2026-04-25)
- ~~P1B.15 — SQS billing event buffer + hot-path emitter~~ ✅ shipped (2026-04-25)
- ~~P1B.16 — Lago event forwarder worker + idempotent transaction IDs~~ ✅ shipped (2026-04-25)
- ~~P1B.17 — Lago webhook sync + credit-counter reconciliation~~ ✅ shipped (2026-04-25)
- ~~P1B.18a — Lago live setup + smoke certification~~ ✅ shipped (2026-04-26)
- ~~P1B.18 — Console billing proxy surfaces + plan changes~~ ✅ shipped (2026-04-26)
- **P1B.19 — Stripe legacy billing retirement and cutover**
- **P1B.20 — Legacy Stripe config and surface cleanup**
- **P1B.21 — Final prod go-live cleanup + smoke fixture retirement**

### 2. Finish ingestion hardening

- P1E.05 — cache invalidation after alias swap
- P1E.06 — cleanup Lambda completion / enforcement

### 3. Ratified frontend rebuild

- P1C remains effectively a fresh build; the older `packages/web` / `/account` model is retired and should not be treated as partially live.
- `P1C.00` is now implemented: `apps/landing`, `apps/console`, `packages/tokens`, shared content contracts, and workspace wiring are scaffolded in-repo.
- Frontend architecture is now ratified around live `apps/landing` and `apps/console` shell foundations plus the semantic `@prontiq/tokens` contract.

## Recommended Next Work

Recommended priority:

1. P1B.19 — cut over the legacy Stripe billing path now that account billing APIs exist.
2. P1B.20 — remove retired Stripe config and surfaces after cutover.
3. P1B.21 — retire or explicitly retain prod smoke fixtures after Lago work is complete.
4. P1C.02 / P1C.03 — continue the console overview and API-key experience after the commercial event path is underway.

Before starting `P1B.19`, read:

- `ARCHITECTURE.MD` (commercial implementation-status section + Lago target flow)
- `docs/decisions/013-platform-owned-customer-id.md`
- `docs/decisions/014-dedicated-customers-table.md`
- `docs/decisions/015-lago-external-id-equals-customer-id.md`
- `docs/decisions/016-standard-sqs-for-billing-events.md`
- `docs/decisions/017-lago-default-subscription-id.md`
- `docs/decisions/018-lago-credit-delta-sum-metering.md`
- `docs/decisions/019-billing-event-delivery-ledger.md`
- `docs/decisions/020-lago-usage-event-minimal-payload.md`
- `docs/decisions/021-lago-webhook-hmac-signatures.md`
- `docs/decisions/022-dedicated-lago-webhook-ledger.md`
- `docs/decisions/023-lago-billing-period-counter-scopes.md`
- `docs/decisions/024-lago-plan-code-equals-tier.md`
- `docs/decisions/027-console-billing-account-api.md`
- `docs/decisions/028-billing-action-ledger.md`
- `docs/decisions/029-lago-plan-transition-semantics.md`
- `docs/runbooks/console-billing.md`
- `docs/runbooks/lago-live-smoke.md`
- `docs/runbooks/lago-billing-events.md`
- `docs/runbooks/lago-webhook-reconciliation.md`
- `docs/FRONTEND-STRATEGY.md`
- `docs/prototypes/console-dashboard-v1.html`

Reason:

- The legacy Stripe auth/billing path is effectively complete, but the forward
  commercial workstream is now the Lago migration sequence.
- Honeycomb backend tracing is now implemented and verified in deployed `dev` and `prod`.
- The next product milestone needs Lago-backed billing state and plan changes
  in the console. Since there are no real customers yet, retained prod smoke
  fixtures are useful validation data for the remaining Lago tickets and should
  not be destructively cleaned until `P1B.21`.
- `P1C.02` and `P1C.03` still matter, but they should follow the commercial
  contract work instead of preceding it.
- API Gateway caching remains a pragmatic performance/cost option if platform work is preferred over dashboard work.

### Operator follow-ups (one-time, not blocking next ticket)

- **P1B.08a SES deliverability posture** for `prontiq.dev` in `ap-southeast-2`. Domain verification and DKIM are complete; custom MAIL FROM, DMARC relaxed SPF alignment, SES production-access approval, and normal-recipient verification remain. Operate via `docs/runbooks/ses-suppression.md`.
- **Legacy Stripe metadata contract** remains relevant only while the migration
  is in progress. Do not treat it as the forward commercial design.

### Backlog (not blocking auth)

- P1A.09: API Gateway caching ($15/month, sub-5ms repeat queries)
- P1A.10: WAF + API Gateway throttling
- Increase OpenSearch gp3 to 50GB (before next quarterly G-NAF ingest)
- ABN pipeline (second product, P2)

## Reference Files

| File                                          | Purpose                                 | When to Read                         |
| --------------------------------------------- | --------------------------------------- | ------------------------------------ |
| `ARCHITECTURE.MD`                             | Full platform design                    | When you need design context         |
| `ROADMAP.md`                                  | Master plan                             | When you need the full scope         |
| `docs/FRONTEND-STRATEGY.md`                   | Canonical frontend architecture         | Before any P1C implementation        |
| `docs/decisions/001-remove-unkey.md`          | ADR — why Unkey was removed             | When auditing architecture decisions |
| `sst.config.ts`                               | Infrastructure definition               | When working on infra                |
| `packages/shared/src/constants.ts`            | Product registry, tier limits           | When working on auth/billing         |
| `packages/api/src/index.ts`                   | API entry point                         | When working on routes               |
| `packages/api/src/scripts/rotate-prod-key.ts` | Prod key rotation operator command      | When rotating the seed key           |
| `packages/api/src/search/queries.ts`          | OpenSearch queries                      | When tuning search                   |
| `packages/docs/openapi.json`                  | Committed OpenAPI spec                  | Source of truth for SDK/docs         |
| `.speakeasy/workflow.yaml`                    | SDK generation config                   | When adding SDK languages            |
| `docs/operations/ingestion-runbook.md`        | Ingestion operator guide                | When running ingestion               |
| `docs/runbooks/p1b04b-cutover.md`             | Auth/billing cutover + rotation runbook | When operating the v2.2 key model    |
