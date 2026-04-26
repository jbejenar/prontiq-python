# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **P1B.20 legacy Stripe cleanup implemented.** Removed the platform-owned
  Stripe webhook, billing cron, month-close, Stripe Pricing Table component,
  `STRIPE_*` deploy env contract, `LEGACY_STRIPE_RUNTIME_ENABLED`, direct
  `stripe` package dependencies, and private account-setup response
  `stripeCustomerId`. Stripe remains only the payment rail configured inside
  Lago.

- **P1B.19 Stripe legacy billing runtime retirement implemented.** Provisioning
  was cut over to Lago-forward mode, bootstrapping Lago Free subscriptions
  without creating Stripe customers. This temporary compatibility phase used
  `LEGACY_STRIPE_RUNTIME_ENABLED=false`; P1B.20 subsequently removed the legacy
  flag, Stripe webhook, billing cron, month-close, and direct Stripe deploy
  config.

- **P1B.18 account billing API contract implemented.** `PqAccount` now exposes
  Prontiq-owned billing summary, Lago portal session, and gated Free/PAYG
  plan-change routes with Clerk org-admin auth, `Idempotency-Key` replay
  safety, a `prontiq-billing-actions` ledger, a private OpenAPI contract, and
  Lago transition handling that preserves current entitlements while plan
  changes are pending.

- **Public/private OpenAPI split added.** Public Mintlify/Speakeasy generation
  now uses only `packages/docs/openapi.json`, while Clerk-authenticated
  console/account routes are generated into `packages/api/openapi.private.json`.

- **P1B.18a live smoke certification completed.** Dev/prod have accepted
  Lago usage-forwarding delivery rows, completed Lago HMAC webhook-ledger rows,
  replay-safe duplicate webhook checks, inventoried test-only smoke fixtures,
  and retained calendar-period request enforcement for the next Lago migration
  tickets.

- **Final prod smoke-fixture retirement gate** (`P1B.21`) added after the Lago
  migration sequence. Retained prod smoke fixtures now stay available for
  `P1B.18`–`P1B.20` validation but must be clearly labelled/inventoried as
  test-only; destructive cleanup and final post-cleanup smoke are deferred until
  after legacy Stripe cleanup.

- **Lago live smoke certification tooling** (`P1B.18a`) added for the
  rollout-gated Lago migration. `@prontiq/control-plane` now has
  `lago:smoke:event`, which loads a stage smoke key/customer from DynamoDB,
  validates the P1B.14 identity contract, derives `BillingUsageEventV1.eventId`
  through the production billing-event contract, optionally sends the event to
  SQS, and prints safe evidence for dev/prod certification.

- **Lago webhook reconciliation** (`P1B.17`) **implemented behind a dedicated
  rollout gate.** Added `POST /webhooks/lago`, HMAC signature verification,
  `prontiq-lago-webhook-events` idempotency ledger, consumed subscription /
  invoice event set, Lago plan/subscription/billing-period denormalization onto
  local key records, `COUNTER_PERIOD_SOURCE` support for Lago-period counter
  scopes, `PqLagoWebhookErrors` alarm, and docs/runbooks/ADRs for drift and
  rollout. PAYG is now explicitly uncapped but tracked.

- **Lago event forwarder** (`P1B.16`) **implemented behind the existing producer
  rollout gate.** Added `PqLagoEventForwarder`, deterministic Lago
  `transaction_id = eventId`, derived `external_subscription_id = pq_sub_<ulid>`,
  minimal credit-delta payloads, the `prontiq-billing-event-deliveries`
  delivery ledger, CloudWatch forwarder runtime-error alarm/dashboard metric, and
  GitHub environment deploy config for `LAGO_API_URL` / `LAGO_API_KEY`.
  `BILLING_EVENTS_ENABLED` remains default-off until canonical Lago
  metrics/subscriptions and replay smoke checks pass per environment.

- **SQS billing-event buffer** (`P1B.15`) **implemented behind a feature flag.**
  Added `BillingUsageEventV1`, deterministic `bevt_...` event ids, standard SQS
  source queue + DLQ, CloudWatch queue alarms/dashboard metrics,
  `prontiq-customers` infra, provisioning-time `customerId` writes for new
  orgs, and a `backfill:customers` dry-run/apply utility for legacy org/API-key
  records. The API emits only after DynamoDB enforcement succeeds and never
  calls Lago; `BILLING_EVENTS_ENABLED` defaults to `false` until the deployed
  environment passes Lago setup and replay smoke checks.

- **P1B.14 customer identity contract defined.** The target Lago migration now
  has a platform-owned `customerId` contract (`pq_cust_<ulid>`), a documented
  `prontiq-customers` mapping table, Lago `external_id = customerId` semantics,
  backfill/conflict rules, and a no-customer-table-read invariant for the API
  hot path. Runtime table creation and backfill landed in `P1B.15`; Lago
  forwarding landed in `P1B.16`; reconciliation remains in a later Lago
  migration ticket.

- **SES deliverability hardening tracked as P1B.08a.** The prod SST
  configuration now declares custom MAIL FROM for `bounce.prontiq.dev` with
  `USE_DEFAULT_VALUE` fallback, and the docs/roadmap now require SPF, DMARC
  relaxed SPF alignment, custom MAIL FROM verification, SES production-access
  approval, and one normal-recipient transactional send before email delivery
  is considered production-ready.

- **Commercial architecture pivot documented.** `ARCHITECTURE.MD`, roadmap docs, runbooks, public docs, app guidance, and ADRs now describe Lago as the commercial system of record. The former Stripe-centric webhook / billing cron / month-close path is retained only as historical implementation evidence after P1B.20.

- **Landing page with live autocomplete demo** (`P1C.01`) **implemented.** `apps/landing` now renders the real `prontiq.dev` surface: sticky nav, hero statement, proxy-backed live autocomplete demo via `@prontiq/web-component`, config-owned Prontiq Free/PAYG pricing cards, footer/legal links, and Clerk sign-up modal CTA wrappers. The live demo uses a constrained landing-side proxy route (`/api/demo/address/autocomplete`) with per-IP token-bucket throttling, query/limit clamps, and no client-side API key exposure. Helper-managed local/CI runs remain keyless-safe; missing real Clerk envs degrade to deterministic non-crashing fallback states instead of failing open. The earlier embedded Stripe Pricing Table wrapper was removed by P1B.20.
- **Frontend base layer** (`P1C.07`) **implemented.** `apps/landing` and `apps/console` now have Tailwind CSS v3.4, app-local shadcn/ui primitives, dark mode via `next-themes`, responsive shell foundations, and app-local Vitest + Testing Library. `apps/console` now includes a real Clerk auth boundary that is enabled only when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are present; keyless local/CI builds render a deterministic disabled-auth fallback instead of crashing. `@prontiq/tokens` now emits semantic HSL theme variables and the Tailwind preset surface those apps consume.
- **Honeycomb backend telemetry** (`P1F.03`) **implemented and verified.** Added `@prontiq/observability`, wired deployed Lambda handlers for Honeycomb traces behind `HONEYCOMB_API_KEY`, added `HONEYCOMB_ENABLED=false` as the deployed-stage rollback kill switch, kept CloudWatch/SNS and `PqApi` X-Ray during the transition, and added ADR/runbook/docs for the rollout. Honeycomb traces are now verified in both `dev` and `prod` for `prontiq-api`, `prontiq-webhooks`, `prontiq-billing`, and `prontiq-ingestion`.
- **Frontend foundations** (`P1C.00`) **implemented.** The repo now has `apps/landing` and `apps/console` Next.js 15 workspaces, a shared `@prontiq/tokens` package, and a shared content contract in `packages/shared/src/content.ts`. `pnpm-workspace.yaml` includes `apps/*` and `sdks/typescript`, so the frontend apps consume the existing `@prontiq/sdk` directly.
- **Burst rate limiter middleware** (`P1B.09`) **implemented and reconciled to the live auth path.** The per-key in-memory token bucket is now extracted into `packages/api/src/middleware/rate-limit.ts` instead of living inline in `auth.ts`, while preserving the same `429 RATE_LIMITED` + `Retry-After` wire contract. New unit coverage verifies token consumption, refill, capacity cap, invalid/null bypass, and key isolation. Auth integration coverage now proves burst exhaustion, refill recovery, isolated buckets, and the invariant that rate-limited requests do not increment `prontiq-usage`. Closes P1B.09.
- **Historical month-close finalisation** (`PqMonthClose`) **implemented for P1B.11, then removed by P1B.20.** The old EventBridge-scheduled Lambda in SST (`cron(30 0 1 * ? *)`) reused the same replay-safe pending meter identifier model as `PqBillingCron`, performed one final previous-month Stripe meter sweep, and marked the current-hash previous-month scope `closed=true` after the final watermark committed. P1B.20 removed the Lambda, alarm, and active deploy wiring after the Lago cutover.
- **SES feedback loop + quota emails** (`PqSesFeedback`, `PqQuotaEmailWorker`) **implemented for P1B.08.** SES now uses one shared `prontiq.dev` sender identity in `ap-southeast-2`, owned by the prod stack through SST, plus stage-specific configuration sets (`prontiq-transactional` in prod, `prontiq-transactional-<stage>` elsewhere) that publish bounce and complaint events to each stage’s SNS topic. New `PqSesFeedback` Lambda maintains `prontiq-ses-suppressions` with hard-bounce immediate suppression, third-soft-bounce rolling-window suppression, and permanent complaint suppression. Welcome and quota emails use the shared suppression-aware SES helper; the old Stripe `past_due` email path is historical after P1B.20. New `PqQuotaEmailWorker` sends 80% / 100% credit-threshold emails asynchronously to `ORG#{orgId}.ownerEmail` using per-scope worker leases (`warningEmailPendingAt`, `limitEmailPendingAt`) so the API hot path never blocks on SES. New CloudWatch alarms: `PqSesFeedbackErrors`, `PqQuotaEmailWorkerErrors`. New operator runbook: `docs/runbooks/ses-suppression.md`. Closes P1B.08.
- **SES rollout verified and hardened (2026-04-19).** `prontiq.dev` is now verified in SES with DKIM active in `ap-southeast-2`. Live simulator sends proved positive-send, bounce, and complaint handling in both `dev` and `prod`, and the quota-email worker finalized sent-state correctly after post-merge fixes switched the send path to the SESv2 client, added explicit SES failure logging, and corrected IAM to include stage configuration-set ARNs. SES remains in sandbox, so simulator verification is complete but arbitrary-recipient delivery still depends on AWS production access.
- **Historical hourly billing cron** (`PqBillingCron`) **implemented for P1B.10, then removed by P1B.20.** The old EventBridge-scheduled Lambda (`rate(1 hour)`) read `REGISTRY#active-keys` plus `REGISTRY#retired-billing-keys`, walked `newHash-redirect-index` chains, and emitted Stripe meter events. P1B.20 removed the Lambda, alarm, direct Stripe dependency, and active deploy wiring. Lago usage forwarding is now the active billing-event path.
- **Historical Stripe webhook handler** (`POST /webhooks/stripe`) **implemented for P1B.06, then removed by P1B.20.** The old `PqStripeWebhook` Lambda verified `stripe-signature` and reconciled Stripe subscription events into local state. P1B.20 removed the route, Lambda, alarm, and active deploy secret contract; Lago webhooks are now the platform reconciliation input.
- **`POST /v1/account/setup` recovery endpoint** **live in dev + prod (2026-04-18, P1B.05 PR 3/3).** Clerk-JWT-authenticated (`Authorization: Bearer <session token>`); calls the same `createProvisioningService().provisionOrg(...)` as the Clerk webhook so a delayed/missed webhook is recoverable from the dashboard. Mirrors the webhook's verified-primary-email invariant via the shared `resolvePrimaryEmail` helper in `@prontiq/control-plane`. New `PqAccount` Lambda separate from address-API `$default` (keeps the hot path bundle minimal: `@clerk/backend` + `@prontiq/control-plane` only land in this one Lambda); mounted via `api.route("ANY /v1/account/{proxy+}", accountFn.arn)` with explicit-route precedence in front of `$default` on the same `PqApi`. CORS extended on `PqApi` (POST + Authorization additive — no rejection of existing GET / X-Api-Key flows). New `PqAccountErrors` CloudWatch alarm wired to the existing `PqIngestAlerts` SNS topic. Operator preconditions are now retained in the private account API docs rather than the public Mintlify reference. Closes P1B.05.
- **`resolvePrimaryEmail` helper moved to `@prontiq/control-plane`** (P1B.05 PR 3a refactor, prod-cutover 2026-04-18). Originally declared in `packages/webhooks/src/clerk.ts`; lifted verbatim into `packages/control-plane/src/clerk.ts` so the new `/v1/account/setup` endpoint can import it without an `api → webhooks` dep direction. `@clerk/backend` now declared explicitly on `@prontiq/control-plane` rather than inherited transitively from `@prontiq/webhooks`. ADR-002 amended with hardening contract #6.
- **Clerk webhook handler** (`POST /webhooks/clerk`) **live in dev + prod (2026-04-18).** Wired to the existing `PqApi`; verifies Svix signature; gates on `role ∈ {org:admin, admin}` (Clerk's namespaced creator role); resolves verified primary email via Clerk Backend API (`@clerk/backend.users.getUser` — does NOT trust `public_user_data.identifier` which can be phone/username/OAuth); calls `createProvisioningService().provisionOrg(...)` to write the ORG envelope + audit row + best-effort welcome email. Current deploys require Clerk and Lago secrets only for this path; the historical `STRIPE_SECRET_KEY` requirement was removed by P1B.20. `PqClerkWebhookErrors` is wired to `PqIngestAlerts`. Operator runbook: `docs/runbooks/clerk-webhook.md`. Closes the functional half of P1B.05; recovery endpoint `POST /v1/account/setup` follows in PR 3 of P1B.05.
- **`@prontiq/control-plane` package** containing the `provisionOrg` service and the `writeAudit` / `buildAuditTransactItem` helpers (closes P1B.07). The original recovered design included direct Stripe client hardening; P1B.20 removed that provider dependency and the current provisioning path bootstraps Lago Free instead. Dual audit API: `buildAuditTransactItem` for atomic grouping inside `TransactWriteItems`; `writeAudit` for standalone callers. Shared types `OrgEnvelopeRecord` + `AuditRecord` added to `@prontiq/shared`. **Powers the live Clerk webhook handler in prod since 2026-04-18.**
- **Architecture v2.2 docs** — ARCHITECTURE.MD + ROADMAP.md + ADR-001 (`docs/decisions/001-remove-unkey.md`). See sub-bullets below.
- New ARCHITECTURE.MD top-level sections: §7 Auth & Endpoint Reference (complete endpoint table + §7.5 success response shapes for Speakeasy SDK codegen), §8 Security, §9 Error Taxonomy, §10 Monitoring & Alerting, §11 Retention, §12 Edge Cases & Failure Modes. New §5.10 Brand section.
- Payment Failure & Grace Period spec (§5.6.3) now mirrors Lago payment/subscription state into `paymentOverdue`; the earlier direct-Stripe 14-day grace path is historical and was removed from active deploys by P1B.20.
- Burst Rate Limiting spec (§5.4.1) — in-memory token bucket per `apiKeyHash`, with Lambda-concurrency caveat preserved.
- DynamoDB schema extensions: Stripe subscription snapshot fields on `prontiq-keys` (`stripeCustomerId`, `stripeSubscriptionId`, `subscriptionItems`) plus reserved `REGISTRY#active-keys`, `ORG#{orgId}`, and `WEBHOOK#stripe#{eventId}` items. `prontiq-usage` now carries REDIRECT attribution records plus billing watermarks (`lastPushedCumulativeCount`) and pending meter-push state (`pendingMeterEventIdentifier`, `pendingMeterTargetCumulativeCount`) on current-hash rows. New tables: `prontiq-audit` (365-day TTL) + `prontiq-ses-suppressions`.
- ROADMAP P1B new tickets: P1B.02 DDB-native key module, P1B.04 DynamoDB tables (4-table infra), P1B.04b data migration, P1B.07 audit writer helper, P1B.08 SES suppressions + bounce handler, P1B.09 burst rate limiter middleware, P1B.11 month-close Lambda.
- ADR-001 `docs/decisions/001-remove-unkey.md` captures the decision rationale (Status/Context/Decision/Consequences/Alternatives).
- Search relevance + fuzzy matching across address endpoints (P1A.11):
  - Autocomplete: `operator: "and"` so all tokens must match (last as prefix)
  - Autocomplete: `fuzziness: "AUTO"` for typo tolerance in completed words
  - Validate: `fuzziness: "AUTO"` so typo'd full addresses still validate
  - Suburb lookup: fuzzy keyword match with `prefix_length: 1`
  - Suburb lookup: response `suburb` field returns matched name (not input)
  - Postcode/Suburb lookups: new `limit` query parameter

### Changed

- **CloudWatch email alert actions are ALARM-only.** Email-backed
  `PqIngestAlerts` alarms no longer publish OK-state notifications, preventing
  missing-data-to-OK spam for low-traffic webhook routes while preserving ALARM
  emails and CloudWatch alarm-history visibility.

- **Frontend architecture ratified.** Added `docs/FRONTEND-STRATEGY.md` as the canonical frontend source of truth and re-based the forward-looking docs around a two-app model: future `apps/landing` for `prontiq.dev`, future `apps/console` for `console.prontiq.dev`, and future `packages/tokens` for design tokens. `ARCHITECTURE.MD` no longer presents `packages/web`, `app.prontiq.dev`, or a single `/account` page as the target frontend architecture. `docs/BRAND.md` is now archived historical guidance only, and `ROADMAP.md` starts P1C with `P1C.00 — Frontend Foundations` before the component-library ticket.
- **Phase 1 observability baseline** (`P1F.02`) is live and verified. `PqIngestAlerts` prod email subscriptions from `ALERT_EMAILS`, new CloudWatch alarms for address API 5xx/Lambda error rate and OpenSearch yellow/red/low-storage, dashboard `prontiq-production`, X-Ray tracing on `PqApi`, and structured JSON logs across Lambda execution paths are now deployed and operator-verified in prod. Email alert delivery was proven by forcing `PqApiLambdaErrorRate-6848399` to `ALARM` and confirming SNS delivery on a subscribed address.
- **Auth middleware integration coverage** (`P1B.12`) is now reconciled to the shipped hash-based auth path. The existing API integration suite now covers direct unknown/revoked-key failures, REDIRECT success writing usage on `newHash`, no orphan usage writes on pre-increment failure paths, and the atomic free-tier quota race. The roadmap ticket no longer claims a standalone seed script, webhook provisioning idempotency, or first-key creation assertions.
- ROADMAP P1B ticket count expanded from 9 to 13 (3 Unkey tickets deleted, 7 new DDB-native tickets added). Total ROADMAP ticket count: 72 → 76.
- ARCHITECTURE.MD numbering flattened: new §7–§12 inserted; existing §7 CI/CD → §13, §8 Phasing → §14, §9 Competitive Position → §15, §10 Design Principles → §16, Licence → §17. §14 Phasing rewritten with security deliverables per phase (v2.2 §18).
- Endpoint reference (§7.3) canonicalized to live query-param form (`/lookup/postcode?postcode=…`, not path-param). Corrects v2.2 draft spec to match live `packages/api/src/routes/address.ts`.
- Error taxonomy (§9) canonicalized to live prod codes: `PRODUCT_NOT_ALLOWED` (not `PRODUCT_NOT_ENABLED`). Matches `packages/shared/src/constants.ts`.
- Monorepo structure (ARCHITECTURE.MD §6) rewritten to match live `packages/` (`api`, `docs`, `ingestion`, `plugins`, `shared`, `webhooks`). `packages/web/` documented as planned P1C addition (neither `packages/web` nor `packages/dashboard` existed in any prior state).
- P1C.07 aligned with §6 — `@prontiq/web` / `packages/web/` (was `@prontiq/dashboard`).
- §5.9 renamed to "Dashboard & Account Security" and rewritten to describe Clerk `<UserProfile />` + custom tabs, not a separate dashboard app.
- §3.2 Stack Decision Table "Dashboard" row renamed "Account page" to match v2.2 architecture.
- SST version references in ARCHITECTURE.MD updated v3 → v4 across 6 locations (matches live `sst.config.ts`).
- CHANGELOG (this file) restructured to properly separate Added / Changed / Removed for v2.2 migration.
- Postcode lookup default page size: 50 → 10 (max 50)
- Suburb lookup default page size: 20 → 10 (max 20)

### Removed

- **Unkey dependency.** API keys are now DynamoDB-native (SHA-256 hash, ~80 LOC). See `docs/decisions/001-remove-unkey.md`. Code removal of `packages/webhooks/src/unkey.ts`, the `unkeyWebhook` export, the `lastSyncedFromUnkey` field on `ApiKeyRecord`, and the `UNKEY_*` env vars completed in PR #68 (`chore(webhooks): remove Unkey code`).
- Reconciliation Lambda (15-min Unkey↔DynamoDB sync) — no longer needed; hot-path verification is direct DynamoDB lookup.
- Legacy v2.1 error-code names (`RATE_LIMIT_EXCEEDED`, `INVALID_PARAMETERS`, `NOT_FOUND`) replaced by v2.2 taxonomy in §9.
- Stray `dependabot_all.json` (added to `.gitignore`)

### Fixed

- Autocomplete ranking: prefix-matching street types (CRESCENT) no longer ranked equally with non-matching types (ROAD/STREET) when user types a prefix
- ARCHITECTURE.MD §5.5.1 billing-registry event table no longer contradicts §5.7.3 webhook flow on DOWNGRADE behaviour (paid→paid plan change keeps hash in registry; only paid→free/CANCEL deletes).
- Past-due billing email copy now comes from shared grace-period constants (`14` days total from first failed renewal, `7` days remaining once the subscription is already `past_due`) instead of a hardcoded string in `stripe-billing.ts`.
- Re-entering paid billing no longer clears retired-billing discovery prematurely. Hashes can now exist in both `REGISTRY#active-keys` and `REGISTRY#retired-billing-keys` until the billing cron confirms historical current/previous-month deltas across the redirect chain are fully drained, preventing revoked or predecessor-only debt from becoming undiscoverable.

## 2026-04-13

### Added

- `api.prontiq.dev` custom domain (P1F.01) — ACM certificate via Vercel DNS, SST gated to prod stage
- Speakeasy TypeScript SDK pipeline (P1D.04) — auto-generates `@prontiq/sdk` PR on OpenAPI spec change
- Mintlify docs site (P1D.01) at `docs.prontiq.dev` — Luma theme, OpenAPI playground, `/llms.txt`
- OpenAPI response schemas fully describe G-NAF document shape (geocode, location, boundaries, electorates)
- CI spec-drift gate: blocks merges when public or private OpenAPI specs are stale vs Zod schemas
- `pnpm generate:openapi` script to regenerate spec from Zod

### Changed

- Validate response `confidence: 0` → `confidence: "none"` (clean string enum for SDK generation)
- ECR repo, ECS task family, log group: stage-qualified to prevent cross-stack ownership
- Custom domain only configured on prod stage

## 2026-04-10 and earlier

- See `git log` for the platform bootstrap commits

<!-- Template generated by ariscan --fix. -->
