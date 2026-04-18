# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`POST /v1/account/setup` recovery endpoint** **live in dev + prod (2026-04-18, P1B.05 PR 3/3).** Clerk-JWT-authenticated (`Authorization: Bearer <session token>`); calls the same `createProvisioningService().provisionOrg(...)` as the Clerk webhook so a delayed/missed webhook is recoverable from the dashboard. Mirrors the webhook's verified-primary-email invariant via the shared `resolvePrimaryEmail` helper in `@prontiq/control-plane`. New `PqAccount` Lambda separate from address-API `$default` (keeps the hot path bundle minimal: `@clerk/backend` + `@prontiq/control-plane` only land in this one Lambda); mounted via `api.route("ANY /v1/account/{proxy+}", accountFn.arn)` with explicit-route precedence in front of `$default` on the same `PqApi`. CORS extended on `PqApi` (POST + Authorization additive — no rejection of existing GET / X-Api-Key flows). New `PqAccountErrors` CloudWatch alarm wired to the existing `PqIngestAlerts` SNS topic. Mintlify reference page at `packages/docs/api-reference/account-setup.mdx` documents the operator preconditions: Clerk dashboard JWT template needs `{ "org_id": "{{org.id}}" }` in BOTH dev and prod tenants, and the frontend must call `setActive({ organization })` before invoking. Closes P1B.05.
- **`resolvePrimaryEmail` helper moved to `@prontiq/control-plane`** (P1B.05 PR 3a refactor, prod-cutover 2026-04-18). Originally declared in `packages/webhooks/src/clerk.ts`; lifted verbatim into `packages/control-plane/src/clerk.ts` so the new `/v1/account/setup` endpoint can import it without an `api → webhooks` dep direction. `@clerk/backend` now declared explicitly on `@prontiq/control-plane` rather than inherited transitively from `@prontiq/webhooks`. ADR-002 amended with hardening contract #6.
- **Clerk webhook handler** (`POST /webhooks/clerk`) **live in dev + prod (2026-04-18).** Wired to the existing `PqApi`; verifies Svix signature; gates on `role ∈ {org:admin, admin}` (Clerk's namespaced creator role); resolves verified primary email via Clerk Backend API (`@clerk/backend.users.getUser` — does NOT trust `public_user_data.identifier` which can be phone/username/OAuth); calls `createProvisioningService().provisionOrg(...)` to write the ORG envelope + audit row + best-effort welcome email. New `PqClerkWebhook` Lambda (separate from address-API `$default` to keep that IAM minimal) + 3 GitHub Environment secrets (`CLERK_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `CLERK_SECRET_KEY`) sourced via the deploy workflows' `env:` block (matches existing `WELCOME_EMAIL_FROM` pattern) + `$util.secret()` wrapping in Pulumi state + `REQUIRED_WEBHOOK_SECRETS` fail-fast deploy guard with whitespace-trim normalisation + CloudWatch `PqClerkWebhookErrors` alarm wired to `PqIngestAlerts` SNS topic. Dev cutover verified end-to-end on real Svix traffic (1 envelope + 1 audit row across 5 deliveries — idempotency invariant proven). Operator runbook: `docs/runbooks/clerk-webhook.md`. Closes the functional half of P1B.05; recovery endpoint `POST /v1/account/setup` follows in PR 3 of P1B.05.
- **`@prontiq/control-plane` package** containing the `provisionOrg` service (recovered from a prior uncommitted design — implements ARCH §5.7.1 verbatim with three hardenings: monotonic ULID audit eventIds, `Stripe({ maxNetworkRetries: 3 })`, and 4xx-vs-5xx Stripe error classification) and the `writeAudit` / `buildAuditTransactItem` helpers (closes P1B.07). Dual audit API: `buildAuditTransactItem` for atomic grouping inside `TransactWriteItems`; `writeAudit` for standalone callers. Shared types `OrgEnvelopeRecord` + `AuditRecord` added to `@prontiq/shared`. **Powers the live Clerk webhook handler in prod since 2026-04-18.** The `POST /v1/account/setup` recovery endpoint (P1B.05 PR 3/3) will consume the same `createProvisioningService()` to keep `provisionOrg` callable from a single codepath.
- **Architecture v2.2 docs** — ARCHITECTURE.MD + ROADMAP.md + ADR-001 (`docs/decisions/001-remove-unkey.md`). See sub-bullets below.
- New ARCHITECTURE.MD top-level sections: §7 Auth & Endpoint Reference (complete endpoint table + §7.5 success response shapes for Speakeasy SDK codegen), §8 Security, §9 Error Taxonomy, §10 Monitoring & Alerting, §11 Retention, §12 Edge Cases & Failure Modes. New §5.10 Brand section.
- Payment Failure & Grace Period spec (§5.6.3) — 14-day grace via `paymentOverdue` flag on `prontiq-keys` + `customer.subscription.updated` past_due handler + Stripe Dashboard Smart Retries config.
- Burst Rate Limiting spec (§5.4.1) — in-memory token bucket per `apiKeyHash`, with Lambda-concurrency caveat preserved.
- DynamoDB schema extensions: Stripe `subscriptionItems` map on `prontiq-keys` (required for billing cron), `REGISTRY#active-keys` billing index item, `PROVISION#{orgId}` idempotency lock, `REDIRECT#{oldHash}` rotation-safety record in `prontiq-usage`. New tables: `prontiq-audit` (365-day TTL) + `prontiq-ses-suppressions`.
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

## 2026-04-13

### Added

- `api.prontiq.dev` custom domain (P1F.01) — ACM certificate via Vercel DNS, SST gated to prod stage
- Speakeasy TypeScript SDK pipeline (P1D.04) — auto-generates `@prontiq/sdk` PR on OpenAPI spec change
- Mintlify docs site (P1D.01) at `docs.prontiq.dev` — Luma theme, OpenAPI playground, `/llms.txt`
- OpenAPI response schemas fully describe G-NAF document shape (geocode, location, boundaries, electorates)
- CI spec-drift gate: blocks merges when `packages/docs/openapi.json` is stale vs Zod schemas
- `pnpm generate:openapi` script to regenerate spec from Zod

### Changed

- Validate response `confidence: 0` → `confidence: "none"` (clean string enum for SDK generation)
- ECR repo, ECS task family, log group: stage-qualified to prevent cross-stack ownership
- Custom domain only configured on prod stage

## 2026-04-10 and earlier

- See `git log` for the platform bootstrap commits

<!-- Template generated by ariscan --fix. -->
