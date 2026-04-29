# NEXT-SESSION.md — Session Execution Log

> Historical progress/count snapshots in older sessions are archival notes from
> the time they were written, not the current source of truth. Use
> `ROADMAP.md`, `NEXT-WORK.md`, and `README.md` for current execution status.

## Session 44 — 2026-04-29

**Focus:** P1C.03 closeout and P1C.02 overview implementation.

### P1C.02 Implementation Handoff

- Started P1C.02 implementation after PR #187 corrected the ticket contract.
- Overview is now implemented as a read-only account summary: it consumes
  `GET /v1/account/status` and `GET /v1/account/keys`, shows masked key
  metadata, and links all setup/key mutations to `/keys`.
- Fake usage values were removed from the overview; usage charts remain P1C.04
  and billing remains P1C.05.
- The remaining handoff is review, preview smoke, dev deploy, and final roadmap
  closeout after verification.

### Closeout Update

- PR #186 merged to `main`.
- Dev deploy completed.
- Production deploy completed successfully in GitHub Actions run
  `25094034637`.
- P1C.03 is now complete at code, docs, dev deploy, and prod deploy level.
- The next ticket is P1C.02 — Console Overview Page, but its original roadmap
  scope has been corrected so it does not reintroduce raw-key reveal or fake
  usage numbers after the P1C.03 security model.

### Implemented on the P1C.03 PR 5 branch

- Added `GET /v1/account/audit` as the member-allowed audit read path for the
  console key-management page.
- Added the console inline audit panel, preserving the existing admin-only
  create/rotate/revoke semantics and member-readable key/audit metadata.
- Audit API responses expose only allowlisted public metadata (`keyId`, `label`)
  and never return raw keys, API key hashes, or hash-bearing internal metadata.
- Added dev CI `smoke:keys-audit` wiring; prod account-route smoke remains
  manual because prod Clerk session hardening prevents durable Backend-SDK
  session minting.
- Manual Playwright smoke against the console preview verified create → address
  API call → revoke → revoked-key rejection using the direct dev API Gateway
  host. `api.dev.prontiq.dev` failed TLS from local tooling and needs a
  separate vanity-domain fix before it is used as the dev smoke target.

### Next session should start with

1. Review and merge the P1C.02 overview implementation branch.
2. Run preview smoke: sign in, load `/`, verify live status/key posture,
   placeholder quickstarts, and no raw-key reveal.
3. Decide whether to fix `api.dev.prontiq.dev` before browser smoke uses the
   vanity dev API domain.

## Session 43 — 2026-04-27

**Focus:** P1B.22 Clerk org commercial identity pivot.

### Current Contract

- Clerk `orgId` is the active commercial identity.
- Lago customer external id is `orgId`.
- Lago subscription external id is `lago_sub_${orgId}`.
- Active billing events are `BillingUsageEventV2` and carry `orgId`.
- `/v1/account/setup` is the only active AWS private account route.
- `/v1/account/billing*`, generated `pq_cust_*`, `pq_sub_*`, and
  `prontiq-customers` are historical P1B.14-P1B.21 evidence only.

### Next Session Should Start With

1. Verify the P1B.22 PR/deploy status before starting follow-on work.
2. Use the updated Lago live-smoke helper; do not pass `CUSTOMERS_TABLE_NAME`.
3. Keep future console billing work behind a Vercel BFF that calls Lago with
   server-held credentials.

## Session 42 — 2026-04-27

**Focus:** P1B.21 final prod go-live cleanup and smoke fixture retirement.

### Completed

- **P1B.21 is implemented.** The retained repo-owned prod smoke API key was
  used for one final API-originated billing smoke, then disabled.
- **Final prod smoke evidence is safe and accepted.** Event
  `bevt_f7833d581725b732d04d3eed3fd7c484` reached `accepted` in
  `prontiq-billing-event-deliveries`; the source queue and DLQ were empty; no
  CloudWatch alarms were in `ALARM`.
- **The historical prod smoke key is retired.** Prefix `pq_live_4a85` now
  returns `401 INVALID_API_KEY`. The raw key and hash remain unrecorded.
- **Audit evidence is retained.** Customer
  `pq_cust_01KQ3TT9XZZDR2CAZTV1TX1KBS`, subscription
  `pq_sub_01KQ3TT9XZZDR2CAZTV1TX1KBS`, usage, delivery, and webhook ledger
  evidence remain available for migration/debug history.
- **Go-live posture is recorded.** Prod remains
  `BILLING_EVENTS_ENABLED=true`, `COUNTER_PERIOD_SOURCE=lago`, and
  `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true`.
- **Post-fix prod billing verification is complete.** PR #163 fixed manual
  Lago smoke event collision handling and was deployed to prod in workflow run
  `24974503448`. A fresh temporary prod probe with prefix `pq_live_03f7`
  produced accepted event `bevt_c0902af1ae5916a464bc40ea6758f1c5` in Lago
  period scope `address#period#2026-04-26_2026-05-25`, then the key was
  disabled. Source queue, DLQ, and relevant alarms were clear.

### Next session should start with

1. Start P1C.02 / P1C.03 console account and API-key UX on top of the completed
   Lago backend contract.
2. Do not reactivate or reuse the retired `pq_live_4a85` prod smoke key.
3. Do not reactivate or reuse the post-fix temporary `pq_live_03f7` prod probe.
4. If future prod smoke is needed, create a new labelled probe under a new
   ticket and record safe evidence only.

## Session 41 — 2026-04-26

**Focus:** P1B.20 legacy Stripe config and surface cleanup.

### Completed

- **P1B.20 is implemented.** The platform-owned Stripe webhook,
  billing-cron, month-close, pricing-table component, `STRIPE_*` deploy secret
  contract, `LEGACY_STRIPE_RUNTIME_ENABLED`, and `stripe` package dependency
  are removed from active code/config.
- **Forward provisioning is Lago-backed only.** New org setup writes the
  Prontiq customer envelope, upserts the Lago customer and Free subscription,
  and denormalizes Lago billing-period fields locally.
- **Private account setup contract is cleaner.** `POST /v1/account/setup`
  returns the Prontiq `customerId`; Stripe linkage remains a historical
  persisted field only and is not exposed in the private response schema.
- **Docs and runbooks are aligned.** Architecture, roadmap, handoff docs,
  private API docs, and Lago/Stripe historical runbooks now distinguish active
  Lago runtime from historical Stripe implementation evidence.

### Next session should start with

1. Open/review/merge the P1B.20 cleanup PR, then deploy dev/prod.
2. Start `P1B.21 — Final Prod Go-Live Cleanup + Smoke Fixture Retirement`.
3. Historical instruction at P1B.20 closeout: preserve repo-owned smoke
   fixtures for the then-future P1B.21 cleanup unless they became unsafe or
   ambiguous.

## Session 40 — 2026-04-26

**Focus:** P1B.18 account billing API contract.

### Completed

- **P1B.18 is complete.** `PqAccount` now serves account billing summary,
  Lago portal session, and gated Free/PAYG plan-change routes.
- **Billing mutations are replay-safe.** `prontiq-billing-actions` stores
  idempotency/action evidence for account billing mutations.
- **Lago transition handling is safer.** Pending transitions record metadata
  without downgrading local entitlements; terminated events preserve access when
  Lago returns an active replacement snapshot.
- **Docs and API references are aligned.** Account billing routes are documented
  through the private OpenAPI spec and internal runbooks, while the public
  Mintlify/Speakeasy spec remains limited to customer data APIs.

### Next session should start with

1. Start `P1B.19 — Stripe Legacy Billing Retirement and Cutover`.
2. Keep plan-change enablement allowlisted to repo-owned test orgs until the
   later cutover path is explicitly approved.
3. Historical instruction at P1B.18 closeout: leave retained Lago smoke
   fixtures in place for the then-future P1B.21 cleanup.

## Session 39 — 2026-04-26

**Focus:** P1B.18a webhook certification closeout.

### Completed

- **P1B.18a is complete.** Dev/prod usage-forwarding smoke already had
  accepted delivery-ledger evidence; the missing HMAC webhook path is now
  certified in both stages.
- **Webhook reconciliation is enabled and verified.** GitHub Environment var
  `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true` is set for dev and prod, and the
  deployed Lago webhook Lambdas report the flag as enabled.
- **Valid webhook smoke completed.** Dev unique key
  `prontiq-platform-dev-smoke-20260426T051602Z` completed in
  `prontiq-lago-webhook-events-dev`; prod unique key
  `prontiq-platform-prod-smoke-20260426T051812Z` completed in
  `prontiq-lago-webhook-events`.
- **Replay safety was verified.** Replaying the same signed webhook unique keys
  returned `200 duplicate` in both stages.
- **Local enforcement state converged.** Dev/prod smoke envelopes and key rows
  reconciled to Lago `payg`, active subscription status, and
  `billingPeriodKey=2026-04-26_2026-05-25`. `COUNTER_PERIOD_SOURCE` remains the
  calendar default.
- **Fixture drift was repaired only for repo-owned test data.** The smoke API
  key/customer rows existed, but the matching `ORG#...` smoke envelopes were
  missing. Dev/prod smoke envelopes were created for
  `org_prontiq_platform_lago_smoke_dev` and
  `org_prontiq_platform_lago_smoke_prod`; no unrelated Lago orgs or real
  customer rows were mutated.

### Next session should start with

1. Start `P1B.18 — Console Billing Proxy Surfaces + Plan Changes`.
2. Keep retained dev/prod smoke fixtures available through P1B.18, P1B.19, and
   P1B.20.
3. Do not switch `COUNTER_PERIOD_SOURCE=lago` unless a later cutover decision
   explicitly approves it.

## Session 38 — 2026-04-26

**Focus:** P1B.18a closeout audit, superseded by Session 39 certification.

### Completed

- **Interim audit captured the remaining P1B.18a gap.** Dev and prod had
  accepted delivery-ledger evidence for API-produced Lago usage smoke, empty
  billing source queues/DLQs, healthy Lago CloudWatch alarms, and ALARM-only
  email actions.
- **Superseded by Session 39.** The webhook certification gap recorded here was
  subsequently closed with completed dev/prod Lago webhook-ledger rows and
  replay-safe duplicate checks.
- **Smoke fixtures are inventoried as test-only data.** Dev:
  `org_prontiq_platform_lago_smoke_dev`,
  `pq_cust_01KQ3T50Z86ZKEFG8Y7N68V3QP`,
  `pq_sub_01KQ3T50Z86ZKEFG8Y7N68V3QP`, key prefix `pq_live_0665`. Prod:
  `org_prontiq_platform_lago_smoke_prod`,
  `pq_cust_01KQ3TT9XZZDR2CAZTV1TX1KBS`,
  `pq_sub_01KQ3TT9XZZDR2CAZTV1TX1KBS`, key prefix `pq_live_4a85`. No raw API
  keys, API-key hashes, Lago API keys, or webhook secrets were recorded.

### Next session should start with

1. See Session 39 for the completed P1B.18a evidence.
2. Start `P1B.18 — Console Billing Proxy Surfaces + Plan Changes`.
3. Keep `COUNTER_PERIOD_SOURCE=calendar` unless a later cutover decision
   explicitly approves Lago-period enforcement.

## Session 37 — 2026-04-26

**Focus:** Re-sequencing production smoke-fixture cleanup after remaining Lago
migration work.

### Completed

- **P1B.18a has partial safe evidence.** Dev and prod API-produced billing
  events were accepted, billing queues/DLQs were empty, prod
  `BILLING_EVENTS_ENABLED=true` was deployed, and `COUNTER_PERIOD_SOURCE`
  remains `calendar`.
- **Prod smoke fixtures should be retained for now.** There are no real
  customers yet, and the repo-owned prod smoke customer/key/subscription are
  useful validation data for `P1B.18`, `P1B.19`, and `P1B.20`.
- **Final cleanup moved to P1B.21.** The roadmap now defers destructive
  smoke-fixture retirement until after the Lago-backed billing contract,
  cutover, and legacy Stripe cleanup are complete.

### Next session should start with

1. Finish `P1B.18a` evidence and smoke-fixture governance.
2. Start `P1B.18 — Console Billing Proxy Surfaces + Plan Changes`.
3. Do not delete or disable repo-owned prod smoke fixtures unless they become
   unsafe; they are retained test fixtures until `P1B.21`.

## Session 36 — 2026-04-26

**Focus:** P1B.18a implementation support for Lago live smoke certification and
alert hygiene.

### Completed

- **Repo-owned smoke-event helper added.** `@prontiq/control-plane` now exposes
  `pnpm --filter @prontiq/control-plane lago:smoke:event` for deriving
  controlled `BillingUsageEventV1` smoke events from live DynamoDB key/customer
  state without hand-built Lago transaction IDs.
- **CloudWatch OK-email spam addressed in IaC.** Email-backed
  `PqIngestAlerts` alarms now publish on `ALARM` only; `OK` and
  `INSUFFICIENT_DATA` transitions remain visible in CloudWatch.
- **Docs updated for certification.** The Lago live-smoke runbook, billing-event
  runbook, monitoring runbook, architecture docs, roadmap, and package hints now
  require smoke helper usage, safe evidence capture, and alarm-action checks.

### Next session should start with

1. Deploy the P1B.18a helper/alarm-policy changes to dev.
2. Run the dev Lago live-smoke checklist with a repo-owned smoke customer/key.
3. Repeat in prod only after dev evidence is clean; leave unrelated Lago orgs
   untouched.

## Session 35 — 2026-04-26

**Focus:** P1B.18a Lago live setup + smoke certification; next up P1B.18
console billing proxy surfaces.

### Completed

- **P1B.18a was added as the missing roadmap owner.** The deployed Lago runtime
  is no longer treated as implicitly ready just because P1B.16 and P1B.17 are
  shipped.
- **Rollout evidence is explicit.** Canonical Lago orgs, metric
  `prontiq_address_requests`, customer/subscription external IDs, HMAC webhook
  delivery, forwarder replay safety, and rollout flags are all owned by
  P1B.18a.
- **P1B.18 remains product/API contract work.** Console billing proxy surfaces
  should start only after live Lago setup and smoke certification are complete.

### Next session should start with

1. Start `P1B.18a — Lago Live Setup + Smoke Certification`.
2. Use `docs/runbooks/lago-live-smoke.md` as the operator checklist.
3. Leave unrelated Lago organizations untouched; create repo-owned smoke
   customers/subscriptions only for this repo and environment.

## Session 34 — 2026-04-25

**Focus:** P1B.17 Lago webhook sync + credit-counter reconciliation; next up P1B.18a Lago live setup + smoke certification.

### Completed

- **P1B.17 is complete.** `POST /webhooks/lago` verifies Lago HMAC signatures,
  requires `X-Lago-Unique-Key`, and dispatches to
  `@prontiq/control-plane` reconciliation.
- **Inbound replay safety is explicit.** `prontiq-lago-webhook-events` stores
  payload hashes and statuses so duplicate completed/ignored events are no-op,
  in-flight duplicates retry, and same-key/different-payload delivery is drift.
- **Local enforcement state is reconciled asynchronously.** Lago subscription
  and invoice events update denormalized plan, subscription, billing-period, and
  payment-overdue fields on local key records. The API hot path still does not
  call Lago.
- **Counter semantics are corrected for PAYG.** PAYG is uncapped but tracked
  (`quotaPerProduct = null`), while Free remains hard-capped and legacy paid
  tiers remain soft-overage migration values.
- **Rollout remains gated.** Keep `LAGO_WEBHOOK_RECONCILIATION_ENABLED=false`
  until the Lago endpoint and canonical org/customer/subscription setup are
  verified; keep `COUNTER_PERIOD_SOURCE=calendar` until reconciliation has
  populated billing periods.

### Next session should start with

1. Start `P1B.18a — Lago Live Setup + Smoke Certification`.
2. Use the P1B.17 local-state contract; do not call Lago directly from browser
   clients or address API request auth.
3. Keep legacy Stripe surfaces treated as migration context, not target UX.

## Session 33 — 2026-04-25

**Focus:** P1B.16 Lago event forwarder worker + idempotent transaction IDs; next up P1B.17 reconciliation.

### Completed

- **P1B.16 is complete.** `PqLagoEventForwarder` consumes queued
  `BillingUsageEventV1` records, validates deterministic `eventId`, records
  local delivery evidence, and forwards minimal credit-delta events to Lago.
- **P1B.16 is deployed.** PR #144 shipped the worker, PR #145 moved the throttle
  from Lambda reserved concurrency to SQS event-source maximum concurrency, and
  both `deploy-dev` and `deploy-prod` passed on `c054245`.
- **Replay safety is explicit.** The worker uses `eventId` as Lago
  `transaction_id`, derives `external_subscription_id` from `customerId`, skips
  accepted duplicates, confirms ambiguous Lago `422` responses through
  `GET /api/v1/events/{transaction_id}`, and treats payload-hash conflicts as
  invalid evidence.
- **Producer rollout was still gated at the time.** At P1B.16 closeout,
  `BILLING_EVENTS_ENABLED=false` was required until each environment had
  canonical Lago metric/customer/subscription setup and a replay smoke check.
  Current post-P1B.21 dev/prod posture is enabled.
- **P1B.15 is complete.** The platform now has `BillingUsageEventV1`,
  deterministic `bevt_...` event IDs, standard SQS source/DLQ infra, and a
  feature-flagged API emitter that runs only after DynamoDB enforcement
  succeeds.
- **Customer runtime substrate landed.** New org provisioning writes
  `customerId` and `prontiq-customers` atomically, while existing legacy org
  envelopes remain valid replays and are handled by `backfill:customers`.
- **Operational guardrails landed.** Queue age/DLQ alarms, dashboard metrics,
  runbook updates, and HINTS document the no-Lago-hot-path invariant.

### Next session should start with

1. Start `P1B.17 — Lago Webhook Sync + Credit-Counter Reconciliation`.
2. Keep Lago commercial truth separate from Prontiq request-time enforcement
   counters.
3. Do not enable `BILLING_EVENTS_ENABLED=true` in prod until the canonical Lago
   setup and replay smoke checks are complete.

## Session 32 — 2026-04-25

**Focus:** P1B.14 customer identity contract.

### Completed

- **P1B.14 is complete as a docs/contract ticket.** The target Lago migration
  now has platform-owned `customerId` values (`pq_cust_<ulid>`), a documented
  `prontiq-customers` mapping table, and ADRs for customer-id ownership,
  customer-table ownership, and Lago `external_id = customerId`.
- **Hot-path boundary is explicit.** API-key-authenticated requests must not read
  `prontiq-customers`; P1B.15 later denormalized `customerId` onto org envelopes
  and key records before billing-event emission.
- **Backfill and conflict behavior is documented.** Existing orgs backfill from
  `ORG#{orgId}` without creating duplicate Lago identities; ambiguous mappings
  enter `migration_conflict` for operator review.

### Next session should start with

1. Start `P1B.15 — SQS Billing Event Buffer + Hot-Path Emitter`.
2. Use the P1B.14 contract: queued events carry `customerId`; request auth does
   not read `prontiq-customers`.
3. Keep SES production-access approval as a background operator follow-up until
   AWS responds.

## Session 31 — 2026-04-25

**Focus:** SES deliverability hardening planning and repo alignment.

### Completed

- **SES deliverability gap identified.** `prontiq.dev` is verified in SES and
  DKIM is successful, but custom MAIL FROM and SES production access are not
  complete.
- **P1B.08a added as the owner.** The roadmap now separates shipped SES
  suppression work from pending custom MAIL FROM, DMARC alignment,
  production-access approval, and normal-recipient verification.
- **Runbooks and architecture aligned.** SES production readiness now means
  DKIM, SPF, DMARC, custom MAIL FROM, suppression handling, and AWS production
  access, not only DKIM plus sandbox exit.

### Next session should start with

1. Add the Vercel DNS records for `bounce.prontiq.dev` and updated DMARC.
2. Deploy prod SST and verify SES custom MAIL FROM status.
3. Resubmit SES production access after simulator checks pass.

## Session 30 — 2026-04-22

**Focus:** Lago commercial architecture rewrite and planning reset.

### Completed

- **Canonical commercial architecture direction changed.** `ARCHITECTURE.MD` was updated to present Lago as the target commercial system of record. At that point the Stripe webhook / billing cron / month-close path was still shipped and retained only as legacy implementation context; P1B.20 later removed it from active deploys.
- **Roadmap and handoff docs are now migration-oriented.** The forward workstream is no longer Stripe Checkout-session orchestration. It is the Lago migration sequence. Current source-of-truth docs now track that sequence as `P1B.14` through `P1B.21`, including inserted certification ticket `P1B.18a`.
- **Repo guidance is now normalized.** README, AGENTS, frontend strategy,
  Mintlify guides, app README/HINTS, ADRs, and runbooks now align to the Lago
  target architecture, and the absorbed source draft was removed from the repo
  once its content was captured canonically.

### Next session should start with

1. Start `P1B.14 — CustomerId + customer mapping contract`.
2. Then move to `P1B.15 — SQS billing event buffer + hot-path emitter`.
3. Follow with `P1B.16 — Lago event forwarder worker + idempotent transaction IDs`.

## Session 29 — 2026-04-20

**Focus:** P1C.01 landing page implementation and closeout.

### Completed

- **`P1C.01` is now complete.** `apps/landing` now renders the real `prontiq.dev` landing page with sticky nav, hero statement, live demo, pricing section, and footer.
- **The hero demo is now live and guarded.** The page embeds `@prontiq/web-component`, routes suggestions through `GET /api/demo/address/autocomplete`, and applies app-local per-IP token-bucket rate limiting plus query/limit clamps. No client-side API key is exposed.
- **Commercial CTA paths became real but build-safe.** The landing page rendered a config-owned Prontiq Free card and Clerk modal CTA wrappers. The original Stripe Pricing Table integration was treated as a superseded interim implementation and was removed by P1B.20; the forward-looking direction is Lago-backed pricing and billing surfaces owned by Prontiq. Helper-managed local/CI runs remain keyless-safe.
- **Source-of-truth docs are reconciled.** Roadmap, architecture, frontend strategy, README/HINTS, and current-work tracking now treat `P1C.01` as shipped work and move the active frontend queue to `P1C.02`.

### Verification evidence

- `pnpm --filter landing typecheck`
- `pnpm --filter landing test`
- `pnpm --filter landing build`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`

### Next session should start with

1. Read `docs/FRONTEND-STRATEGY.md`.
2. Implement `P1C.02 — Console Overview Page`.
3. Then move to `P1C.03 — API Key Management`.

## Session 28 — 2026-04-20

**Focus:** P1C.07 frontend base implementation and closeout.

### Completed

- **`P1C.07` is now complete.** `apps/landing` and `apps/console` now have Tailwind CSS v3.4, app-local shadcn/ui primitives, dark mode, responsive shell foundations, and app-local Vitest + Testing Library.
- **The console auth boundary is now real but build-safe.** `apps/console` now carries an env-gated Clerk boundary: when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are present it enables real sign-in and protected dashboard layout; fully keyless mode is allowed only through the repo’s helper-managed local/CI path, and missing Clerk keys otherwise fail closed as configuration errors.
- **The token contract is now fit for the frontend base.** `@prontiq/tokens` now emits semantic HSL theme variables plus the Tailwind preset surface needed by Tailwind/shadcn, while preserving the Mintlify and SES artifact outputs.
- **Source-of-truth docs are reconciled.** Roadmap, architecture, frontend strategy, app READMEs/HINTS, and current-work tracking now treat `P1C.07` as shipped work and move the active frontend queue to `P1C.01`.

### Verification evidence

- `pnpm --filter @prontiq/tokens test`
- `pnpm --filter landing typecheck`
- `pnpm --filter landing test`
- `pnpm --filter landing build`
- `pnpm --filter console typecheck`
- `pnpm --filter console test`
- `pnpm --filter console build`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`

### Next session should start with

1. Read `docs/FRONTEND-STRATEGY.md`.
2. Implement `P1C.01 — Landing Page with Autocomplete Demo`.
3. Then move to the first real console feature surface on top of the live base.

## Session 27 — 2026-04-20

**Focus:** P1F.03 Honeycomb rollout verification and closeout.

### Completed

- **Honeycomb backend telemetry is now verified in both stages.** `prontiq-api`, `prontiq-webhooks`, `prontiq-billing`, and `prontiq-ingestion` all emitted traces into Honeycomb `prontiq-dev` and `prontiq-prod`.
- **Both deployed stages were exercised directly.** `dev` and `prod` were probed through low-risk API, webhook, billing, and ingestion paths to prove the deployed Lambdas actually exported traces rather than merely carrying the env wiring.
- **Post-merge ingestion image regression was fixed.** The Fargate bulk-ingest Docker image now includes `packages/observability` in its build context and builds `@prontiq/observability` before `@prontiq/ingestion`, unblocking the dev deploy path after the Honeycomb dependency graph change.
- **`P1F.03` is now closed.** Source-of-truth planning docs now treat Honeycomb backend telemetry as complete work, with rollback remaining `HONEYCOMB_ENABLED=false` if telemetry must be suppressed later.

### Verification evidence

- Honeycomb `prontiq-dev` shows traces for:
  - `prontiq-api`
  - `prontiq-webhooks`
  - `prontiq-billing`
  - `prontiq-ingestion`
- Honeycomb `prontiq-prod` shows traces for:
  - `prontiq-api`
  - `prontiq-webhooks`
  - `prontiq-billing`
  - `prontiq-ingestion`
- `Deploy to Production` workflow run `24646727123` completed successfully.
- Direct runtime probes in both stages exercised:
  - API
  - Stripe webhook invalid-signature path
  - SES feedback handler
  - ingestion cleanup handler

### Next session should start with

1. Read `docs/FRONTEND-STRATEGY.md`.
2. Read `docs/prototypes/console-dashboard-v1.html`.
3. Implement `P1C.07 — shadcn/ui + Tailwind v3.4 setup`.
4. Then begin the first real landing/console surface ticket.

## Session 26 — 2026-04-20

**Focus:** P1F.03 Honeycomb backend telemetry implementation.

### Completed

- **Honeycomb backend telemetry is now integrated in code.** `@prontiq/observability` was added, deployed Lambda handlers across API, webhooks, billing/control-plane, and in-scope ingestion paths are wrapped, and central OpenSearch query seams now emit named spans for Honeycomb.
- **Deployed-stage secret wiring is now in place.** `sst.config.ts` and the deploy workflows now require and pass `HONEYCOMB_API_KEY` for `dev` and `prod`, while local/CI flows remain keyless and run telemetry in no-op mode. If deployed rollback is needed during rollout, use `HONEYCOMB_ENABLED=false` rather than removing the secret.
- **Observability docs are reconciled to the new transition state.** Roadmap, architecture, README, AGENTS, ADR-004, and the Honeycomb runbook now describe Honeycomb as the backend trace-analysis plane while CloudWatch/SNS and API X-Ray remain in place during rollout.
- **Rollout is not closed yet.** Honeycomb environments/keys are provisioned, but deployed `dev` and `prod` still need verification before `P1F.03` can be marked complete.

### Verification evidence

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`

### Next session should start with

1. Deploy `dev` and verify traces for `prontiq-api`, `prontiq-webhooks`, `prontiq-billing`, and `prontiq-ingestion`.
2. Deploy `prod` and repeat verification.
3. If rollback is needed during rollout, set `HONEYCOMB_ENABLED=false` for the affected stage and redeploy.
4. Then return to `P1C.07 — shadcn/ui + Tailwind v3.4 setup`.

## Session 25 — 2026-04-20

**Focus:** P1C.00 merge/deploy verification and handoff to P1C.07.

### Completed

- **`P1C.00` is now merged to `main`.** The frontend foundations scaffold (`apps/landing`, `apps/console`, `packages/tokens`, shared content contract, workspace wiring) is no longer just branch-local work.
- **Dev deploy succeeded after merge.** The post-merge deploy path is now proven for the scaffolded frontend foundations work, so `P1C.00` is closed at code + docs + deploy-verification level.
- **PR review and CI follow-up are closed.** The review-driven fixes for fresh-checkout frontend commands, Turbo/task boundaries, generated-artifact contracts, and `@prontiq/tokens` artifact emission all landed before merge.
- **The active frontend workstream now moves to `P1C.07`.** Foundations are done; the next implementation step is Tailwind v3.4, shadcn/ui primitives, and the first real shell/component layer on top of the scaffolds.

### Verification evidence

- PR #118 merged
- dev deploy succeeded after merge
- Session 24 scaffold/build/test verification remains the baseline proof for the underlying `P1C.00` implementation

### Next session should start with

1. Read `docs/FRONTEND-STRATEGY.md`.
2. Read `docs/prototypes/console-dashboard-v1.html`.
3. Implement `P1C.07 — shadcn/ui + Tailwind v3.4 setup`.
4. Then begin the first real landing/console surface ticket.

## Session 24 — 2026-04-19

**Focus:** P1C.00 frontend foundations.

### Completed

- **Two frontend apps are now scaffolded in-repo.** `apps/landing` and `apps/console` now exist as minimal Next.js 15 App Router workspaces, with tracked `next-env.d.ts`, app-local env validation, and the correct route/app shape for later P1C work.
- **Shared frontend seams are now real.** `packages/shared/src/content.ts` now defines the ratified `ContentSource` interface and the `Post` / `CaseStudy` / `SiteSettings` schemas used by the future landing content system.
- **Token package contract is scaffolded.** `packages/tokens` now exists as `@prontiq/tokens` and emits placeholder `tokens.css`, `tailwind-preset.js`, `mint-theme.json`, and `ses-vars.json` artifacts.
- **Workspace wiring now matches the frontend strategy.** `pnpm-workspace.yaml` now includes `apps/*` and `sdks/typescript`, so the frontend apps consume the existing `@prontiq/sdk` package directly instead of inventing a parallel SDK package.
- **Frontend test policy is now explicit.** Backend/infrastructure packages remain on `node:test`; frontend apps will use Vitest + Testing Library once UI tests are introduced in later P1C work.

### Verification evidence

- `pnpm -r list --depth -1`
- `pnpm --filter @prontiq/tokens build`
- `pnpm --filter landing build`
- `pnpm --filter console build`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`

### Next session should start with

1. Read `docs/prototypes/console-dashboard-v1.html`.
2. Implement `P1C.07 — shadcn/ui + Tailwind v3.4 setup`.
3. Then move into the first real landing/console surface ticket.

## Session 23 — 2026-04-19

**Focus:** Frontend architecture ratification.

### Completed

- **Canonical frontend strategy added.** `docs/FRONTEND-STRATEGY.md` now defines the future two-app frontend architecture: `apps/landing` for `prontiq.dev`, `apps/console` for `console.prontiq.dev`, shared design tokens via `packages/tokens`, and continued SDK consumption via `sdks/typescript` / `@prontiq/sdk`.
- **Old frontend model retired from forward-looking docs.** `ARCHITECTURE.MD` and `ROADMAP.md` no longer present `packages/web`, `app.prontiq.dev`, or a single `/account` page as the target frontend shape.
- **Roadmap re-based for implementation.** `P1C.00 — Frontend Foundations` was added, `P1C.07` was rewritten around app-local shadcn/ui + Tailwind v3.4, and the next recommended work now starts with foundations rather than jumping straight into page work.
- **Brand guidance archived.** `docs/BRAND.md` now points to the strategy and future token source instead of acting as canonical brand truth.
- **Console visual reference adopted.** `docs/prototypes/console-dashboard-v1.html` is now the canonical internal visual reference for `apps/console`. It should guide tokens, shell layout, and component extraction, but it is not production source and not the landing-page spec.

### Verification evidence

- consistency grep across `ARCHITECTURE.MD`, `ROADMAP.md`, `README.md`, `NEXT-WORK.md`, and `docs/`
- `git diff --check`
- `pnpm lint`
- `pnpm typecheck`

### Next session should start with

1. Read `docs/FRONTEND-STRATEGY.md`.
2. Read `docs/prototypes/console-dashboard-v1.html`.
3. Implement `P1C.00 — Frontend Foundations`.
4. Then move to `P1C.07 — shadcn/ui + Tailwind v3.4 setup`.

## Session 22 — 2026-04-19

**Focus:** P1F.02 production rollout verification and closeout.

### Completed

- **P1F.02 verified in prod end to end.** CloudWatch alarms exist and are healthy, dashboard `prontiq-production` is live, structured JSON request/error logging is queryable in prod, and `PqApi` X-Ray tracing now lands with Lambda + DynamoDB + explicit OpenSearch segments.
- **Alert delivery proven.** `PqIngestAlerts` email subscription was confirmed and `PqApiLambdaErrorRate` was forced briefly to `ALARM`; SNS email delivery was confirmed and the alarm was restored to `OK`.
- **Source-of-truth gaps fixed.** Follow-up fixes landed for the deploy-role OpenSearch metadata-read policy and for `PqApi` X-Ray write permissions in `sst.config.ts`, so the verified prod state matches the repo.

### Verification evidence

- `aws cloudwatch describe-alarms`
- `aws cloudwatch list-dashboards`
- real prod `GET /v1/address/autocomplete?q=test` with disposable key
- X-Ray trace `1-69e4c337-5fa58fb877e8c5a611ed93e5`
- SNS email received for forced `PqApiLambdaErrorRate-6848399` alarm

### Next session should start with

1. Read NEXT-WORK.md.
2. P1C.07 — shadcn/ui component library setup.
3. Then move into the P1C account-surface rebuild.

## Session 21 — 2026-04-19

**Focus:** P1F.02 monitoring + alerting implementation.

### Completed

- **Prod observability baseline implemented.** `PqIngestAlerts` prod email subscriptions via `ALERT_EMAILS`, new prod alarms for address API 5xx/Lambda error rate and OpenSearch yellow/red/low-storage, and dashboard `prontiq-production` are now defined in the SST stack.
- **Tracing and logs aligned to the roadmap evidence.** `PqApi` now uses X-Ray tracing with DynamoDB capture and explicit OpenSearch subsegments, and Lambda execution paths emit raw JSON logs with stable `request_id`, `path`, and `latency` fields where applicable.
- **Docs/runbooks reconciled.** The observability architecture, roadmap, and operator docs now describe the actual Phase 1 CloudWatch + SNS/email + X-Ray stack instead of future PagerDuty/Slack/EMF assumptions.

### Verification evidence

- `pnpm build`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

### Next session should start with

1. Read NEXT-WORK.md.
2. Deploy P1F.02 to prod.
3. Run the manual operator verification from `docs/runbooks/monitoring-alerting.md`.
4. Then move to P1C.07.

## Session 20 — 2026-04-19

**Focus:** P1B.12 auth middleware integration-test reconciliation.

### Completed

- **Auth middleware integration coverage reconciled.** `packages/api/src/middleware/auth.integration.test.ts` now covers the remaining direct `INVALID_API_KEY` cases, REDIRECT success writing usage on `newHash`, no orphan usage writes on pre-increment failure paths, and the atomic free-tier quota race.
- **Ticket ownership cleaned up.** `P1B.12` no longer claims a standalone seed script, Clerk webhook idempotency, or first-key creation assertions; those stay with the existing auth harness, `P1B.05`, and `P1C.03` respectively.
- **Roadmap/status docs aligned.** P1B is now effectively complete at the ticket level, and the next recommended work is `P1F.02` monitoring + alerting.

### Verification evidence

- `pnpm --filter @prontiq/api typecheck`
- `node --test packages/api/dist/middleware/auth.integration.test.js`

### Next session should start with

1. Read NEXT-WORK.md.
2. P1F.02 — monitoring + alerting.
3. Then resume P1C account-surface work.

## Session 19 — 2026-04-19

**Focus:** P1B.09 burst rate limiter extraction, coverage completion, and doc reconciliation.

### Completed

- **Burst limiter extracted into its own module.** The token-bucket logic now lives in `packages/api/src/middleware/rate-limit.ts` instead of being embedded directly in `auth.ts`.
- **Auth path behavior preserved.** The live middleware still enforces per-key in-memory burst limiting before usage increments and returns `429 RATE_LIMITED` with `Retry-After`.
- **Coverage completed.** New unit tests cover refill math, capacity capping, bypass semantics, and key isolation; auth integration tests now cover refill, isolated buckets, and the invariant that `RATE_LIMITED` does not increment `prontiq-usage`.
- **Roadmap/docs reconciled.** P1B.09 is now marked complete and public docs treat `RATE_LIMITED` as a live contract instead of a future-only error.

### Verification evidence

- `pnpm --filter @prontiq/api test`
- `pnpm --filter @prontiq/api test:integration`
- `pnpm --filter @prontiq/api typecheck`

### Next session should start with

1. Read NEXT-WORK.md.
2. P1B.12 — auth middleware integration-test reconciliation.
3. Then move to P1F.02 monitoring + alerting.

## Session 18 — 2026-04-19

**Focus:** P1B.11 month-close finalisation Lambda.

> Historical note: P1B.20 removed `PqMonthClose`, `PqBillingCron`, and the
> shared Stripe billing runtime from active deploys. This session is retained as
> implementation history only.

### Completed

- **Month-close finalisation shipped historically.** `PqMonthClose` ran on `cron(30 0 1 * ? *)` in dev + prod and reused the same replay-safe pending meter identifier flow as `PqBillingCron`.
- **Previous-month scopes closed explicitly in the historical path.** After the final previous-month sweep succeeded, the current-hash row was marked `closed=true`, which made the hourly cron stop revisiting that scope permanently.
- **Billing runtime extracted historically.** Shared scope-reconciliation logic lived in `packages/control-plane/src/billing-runtime.ts`, so hourly and monthly billing paths used the same redirect-chain discovery, pending-marker claim/finalize, and Stripe meter-event semantics.
- **Operator docs updated historically.** `docs/runbooks/month-close.md` now tombstones the removed runtime and redirects operators to Lago-owned billing flows.

### Verification evidence

- `pnpm --filter @prontiq/control-plane build`
- `pnpm --filter @prontiq/control-plane typecheck`
- `pnpm --filter @prontiq/control-plane test:integration`

Integration coverage now includes:

- remaining previous-month delta push + close
- zero-delta close with no extra Stripe event
- retired predecessor-only chain finalisation
- month-close rerun idempotency
- hourly cron skip on closed previous-month scopes

### Next session should start with

1. Read NEXT-WORK.md.
2. P1F.02 — monitoring + alerting.
3. Historical at the time: keep `docs/runbooks/month-close.md` as the operator source of truth for monthly billing finalisation. Current state: Lago owns billing-period finalisation and the runbook is tombstoned.

> Per-session summary of what happened. Newest session first.
> Purpose: continuity across session breaks without reading git log.

---

## Session 17 — 2026-04-19

**Focus:** P1B.08 rollout verification and SES production-readiness follow-up.

### Completed

- **SES sender identity verified.** `prontiq.dev` in `ap-southeast-2` now reports `VerifiedForSendingStatus=true` and DKIM `SUCCESS`.
- **DNS records completed in Vercel.** `_amazonses` TXT and all three DKIM CNAMEs are live; SES verification no longer depends on manual DNS follow-up.
- **Live simulator verification completed in both stages.**
  - direct SES simulator sends accepted in `dev` and `prod`
  - bounce simulator wrote `hard_bounce` suppressions
  - complaint simulator wrote `complaint` suppressions
  - both `PqSesFeedback` Lambdas processed live SNS feedback successfully
- **Post-merge quota-email defects fixed and deployed.**
  - switched the send path to the SESv2 client
  - added explicit SES failure logging
  - corrected worker IAM to include stage-specific SES configuration-set ARNs
  - fixed SST config so Pulumi interpolation stays inside `run()`
- **Positive-send path proven live.**
  - `dev`: `PqQuotaEmailWorker` finalized `warningEmailSent=true`
  - `prod`: `PqQuotaEmailWorker` finalized `limitEmailSent=true`
  - temporary verification rows were cleaned up after the check

### Current truth

- P1B.08 is fully shipped and operationally verified.
- SES is still in sandbox, so arbitrary-recipient delivery remains blocked until AWS production access is enabled.
- Historical at the time: Stripe prod webhook still awaited the first real production billing delivery for its final live confirmation point. Current state: P1B.20 removed the platform-owned Stripe webhook.

### Follow-up

1. Request / confirm SES production access for `prontiq.dev` in `ap-southeast-2`.
2. Keep `docs/runbooks/ses-suppression.md` as the source of truth for SES operations.
3. Historical at the time: move to P1B.11 month-close once the SES production-access request is in flight or approved. Current state: P1B.20 removed month-close.

---

## Session 16 — 2026-04-19

**Focus:** P1B.08 — SES feedback loop, suppression-aware sends, and quota-threshold emails.

### Shipped

- **SES feedback loop implemented.** `PqSesFeedback` now consumes SNS-wrapped SES `BOUNCE` and `COMPLAINT` events from a stage-specific SES configuration set and writes `prontiq-ses-suppressions`.
- **Suppression-aware sends unified.** Welcome email, the historical Stripe `past_due` email path, and quota emails routed through the same suppression-aware SES helper in `@prontiq/control-plane`. Current state: P1B.20 removed the direct Stripe `past_due` path.
- **80% / 100% quota emails shipped.** API usage increments now enqueue async work to `PqQuotaEmailWorker`, which sends org-level threshold emails to `ORG#{orgId}.ownerEmail` using short worker leases on the usage row.
- **Usage-row state extended.** `warningEmailPendingAt` and `limitEmailPendingAt` now back the worker lease model. Historical Stripe paid-plan transitions cleared both sent and pending markers when usage flags reset; current state is Lago reconciliation.
- **New operator docs added.** `docs/runbooks/ses-suppression.md` now captures the SES setup, simulator verification path, suppression semantics, and manual unsuppression process.

### Verification evidence

- `pnpm --filter @prontiq/shared build`
- `pnpm --filter @prontiq/control-plane build`
- `pnpm --filter @prontiq/control-plane typecheck`
- `pnpm --filter @prontiq/control-plane test`
- `pnpm --filter @prontiq/control-plane test:integration`
- `pnpm --filter @prontiq/api typecheck`
- `pnpm --filter @prontiq/api test`
- `pnpm --filter @prontiq/webhooks test:integration`

Integration coverage now includes:

- hard bounce suppression
- third soft bounce suppression
- complaint precedence
- welcome-email suppression skip
- quota-warning exact-once behavior
- quota-email suppression skip
- quota worker retry after send failure
- Historical Stripe paid-plan reset clearing sent + pending email markers

### Next session should start with

1. Read NEXT-WORK.md.
2. **P1B.11 — month-close job.**
3. Use `docs/runbooks/ses-suppression.md` as the operator source of truth for SES bounce / complaint handling.

---

## Session 15 — 2026-04-19

**Focus:** Post-rollout Stripe verification in dev and prod after the billing webhook + hourly meter push shipped.

> Historical note: P1B.20 removed the platform-owned Stripe webhook and meter
> push path. This section is retained only as old rollout evidence.

### Verified live in dev

- Real Stripe sandbox deliveries hit `https://59jym47ia1.execute-api.ap-southeast-2.amazonaws.com/webhooks/stripe`.
- Exercised end to end:
  - `customer.subscription.updated` tier reconciliation
  - `customer.subscription.updated` `past_due`
  - `customer.subscription.updated` recovery
  - `customer.subscription.deleted`
  - `invoice.payment_failed` log-only
- Verified with real DynamoDB state changes and audit rows in `prontiq-keys-dev` / `prontiq-audit-dev`.
- Temporary sandbox subscriptions were cleaned up and the two test org envelopes were returned to free state after verification.

### Verified in prod

- Production deploy completed successfully via workflow run `24617074850`.
- Production Stripe destination verified:
  - URL `https://api.prontiq.dev/webhooks/stripe`
  - destination `we_1TNj1SGU4RM7bEKoX6oSjygi`
  - subscribed events exactly match the implemented handler contract
- A non-billing live event resend (`customer.created`) proved Stripe can target the destination, but it is not part of the subscribed billing event set and is not treated as webhook proof.
- Historical at the time: the first real production billing delivery remained the final live confirmation point. Current state: the Stripe endpoint was removed by P1B.20.

### Next session should start with

1. Read NEXT-WORK.md.
2. **P1B.11 — month-close job.**
3. Historical at the time: use `docs/runbooks/stripe-webhook.md` as the operator source of truth when the first real prod billing delivery lands. Current state: that runbook tombstones the removed endpoint.

---

## Session 14 — 2026-04-18

**Focus:** P1B.10 — hourly billing cron into Stripe meters, plus full billing-doc reconciliation after the Stripe webhook/catalog work landed.

> Historical note: P1B.20 removed the platform-owned Stripe billing cron,
> Stripe webhook, month-close, direct Stripe deploy config, and Stripe package
> dependency. This session is retained as implementation history only; do not
> use it as current architecture guidance.

### Shipped

- **Hourly billing cron (`PqBillingCron`) implemented historically.** New `packages/control-plane/src/billing-cron.ts` service + Lambda handler was wired in `sst.config.ts` on `rate(1 hour)`. It read `REGISTRY#active-keys`, loaded the current paid key, recursively walked `newHash-redirect-index`, summed usage across the full rotation chain, and emitted Stripe meter events using the historical Stripe catalog contract. P1B.20 removed this runtime.
- **Replay-safe meter push state added historically to `prontiq-usage`.** Current-hash usage rows could carry `pendingMeterEventIdentifier` + `pendingMeterTargetCumulativeCount` so a Stripe-accepted meter event could be retried and finalized without double billing if the DynamoDB watermark update failed after the Stripe API call.
- **Sandbox Stripe catalog hardened historically.** The old billing contract depended on Stripe metadata rather than checked-in catalog IDs. P1B.20 superseded this with Lago-backed billing configuration.
- **Billing weights fail closed for unrated products.** Address endpoints are explicitly rated in `BILLING_ENDPOINTS`; if Lago enables a future product before matching endpoint weights land in code, auth returns `500 INTERNAL_ERROR` for that product instead of silently charging a guessed default.
- **Docs reconciled to the then-current meter model.** Architecture/backlog/session/changelog text pointed to Stripe meters + metadata contract instead of legacy `subscriptionItems.createUsageRecord()` assumptions. P1B.20 later superseded this with Lago-forward billing events.

### Verification evidence

- `pnpm --filter @prontiq/shared build`
- `pnpm --filter @prontiq/control-plane build`
- `pnpm --filter @prontiq/control-plane typecheck`
- `pnpm --filter @prontiq/control-plane test:integration` (run outside sandbox so the suite could reach DynamoDB Local on `localhost:8000`)

Billing-cron integration coverage now includes:

- straight delta push on a paid key
- rotation-chain correctness (`A -> C`, gate on current hash only)
- retry-safe replay after a simulated failure between Stripe meter acceptance and DynamoDB finalize

### Next session should start with

1. Read NEXT-WORK.md.
2. Historical at the time: **P1B.08 — SES suppression / bounce handling.** The hourly billing path was live; suppression ingestion was the remaining email-hardening gap on the control plane.
3. Historical at the time: **P1B.11 — month-close job.** Previous-month scopes were only revisited by the hourly cron during the early UTC rollover window. Current state: P1B.20 removed this path.

---

## Session 13 — 2026-04-18

**Focus:** P1B.05 PR 3 — split into PR 3a (refactor: move `resolvePrimaryEmail` to `@prontiq/control-plane`) → dev → prod, then PR 3b (`POST /v1/account/setup` recovery endpoint + `PqAccount` Lambda + JWT middleware + private account docs) → dev → prod. Closes P1B.05 ticket end-to-end.

### Shipped to prod

- **PR #100 — `resolvePrimaryEmail` moved to `@prontiq/control-plane` (P1B.05 PR 3a refactor).** Pure refactor; webhook behaviour identical at runtime. `@clerk/backend` declared explicitly on `@prontiq/control-plane` (no transitive hoisting). 12 new node:test cases covering all 4 `EmailLookupResult` variants. ADR-002 amended with hardening contract #6. Merged 2026-04-18, dev verified, prod-deployed via Deploy to Production workflow run 24595460142 (success).
- **PR #\_\_ — `POST /v1/account/setup` recovery endpoint (P1B.05 PR 3b, the feature).** Clerk-JWT-authenticated endpoint that reuses `createProvisioningService().provisionOrg(...)` from `@prontiq/control-plane`. New `PqAccount` Lambda separate from address-API `$default` (verified isolation: `packages/api/src/index.ts` carries a doc-comment forbidding `@prontiq/control-plane` and `@clerk/backend` imports — bundle stays minimal). Mounted via `api.route("ANY /v1/account/{proxy+}", accountFn.arn)` with explicit-route precedence in front of `$default`. CORS extended on `PqApi` to allow POST + Authorization (additive — no existing-flow rejection). New `PqAccountErrors` CloudWatch alarm. The endpoint is now documented through the private account API contract, not public Mintlify API reference.
- **ROADMAP P1B.05 flipped to `complete`** with `completed: 2026-04-18`. P1B counter 4/13 → 5/13; total 26/76 → 27/76.

### Verification evidence

- 5 new control-plane unit tests (clerk.test.ts) + 14 new api unit tests (clerk-jwt.test.ts) + 5 new api integration tests (account.integration.test.ts including all 4 ROADMAP DoD scenarios).
- `grep -rn "provisionOrg" packages/` shows 1 definition (`@prontiq/control-plane`) + 2 imports (`@prontiq/webhooks/src/clerk.ts`, `@prontiq/api/src/routes/account.ts`) — single source of truth invariant holds.
- `grep -rn "resolvePrimaryEmail" packages/` shows definition in `@prontiq/control-plane/src/clerk.ts`, re-export from index, and 2 imports (webhook + account route).

### Hard lessons (added to memory / process)

- **Clerk SDK's public `verifyToken` throws on error** (wrapped via `withLegacyReturn` internally), even though the underlying `verifyJwt` returns `JwtReturnType<...>`. Plan assumed try/catch — verified this is correct from the actual `node_modules/.pnpm/@clerk+backend@3.2.12/.../dist/index.d.ts` signature before writing the middleware. Lesson: verify SDK contracts against the installed package, not against memory of the public API.
- **Lambda bundle isolation is enforced by import graph, not package.json.** Adding `@clerk/backend` + `@prontiq/control-plane` as deps on `@prontiq/api` is fine — SST/esbuild bundles each `handler` export's transitive imports. The doc-comment in `packages/api/src/index.ts` is the actual contract; the package.json deps are just resolution metadata.
- **Private account routes don't belong in the public OpenAPI spec.** The public
  `packages/docs/openapi.json` is generated for public data APIs only; account
  routes run on a separate Lambda and are generated into
  `packages/api/openapi.private.json`. Trade-off: SDK doesn't get an
  auto-generated client for account endpoints, which is intentional because the
  SDK is for data API consumers and dashboard code calls account routes with
  Clerk session tokens.

### Next session should start with

1. Read NEXT-WORK.md.
2. Historical at the time: **P1B.08 — SES suppression / bounce handling.** Stripe webhook had just shipped, so the next control-plane hardening ticket was the SES subscriber that keeps `prontiq-ses-suppressions` current instead of read-only.
3. Historical at the time: configure Stripe Dashboard webhook subscriptions + Smart Retries/cancel-on-exhaustion policy. Current state: P1B.20 removed the platform-owned Stripe webhook/runtime.

---

## Session 12 — 2026-04-17 → 2026-04-18

**Focus:** P1B.05 PR 2/3 — Clerk webhook handler. Repo audit; PR 1 (control-plane recovery) → prod; PR 2 (webhook handler) → dev → prod after iterating through 7 review-bot findings + a CI race + a deploy-script architectural rewrite.

### Shipped to prod

- **PR #94 — `@prontiq/control-plane` package (P1B.05 PR 1/3 + closes P1B.07).** Recovered the `provisionOrg` service from prior uncommitted dist artefacts; added `writeAudit` / `buildAuditTransactItem` helpers; added `OrgEnvelopeRecord` + `AuditRecord` to `@prontiq/shared`; ADR-002 (`docs/decisions/002-control-plane-package.md`) captures (a) why control-plane is a separate package, (b) why we recovered the dist instead of rewriting, (c) the dual audit API rationale, (d) four hardening contracts surfaced during 4 rounds of code review (read-result discriminated union, audit idempotency via eventId+now, welcome-email boundary guard, unified DDB error classifier with safe-default-on-ambiguity). 51 control-plane tests + 1 integration test against DDB Local.
- **PR #95 — Clerk webhook handler + SST infra (P1B.05 PR 2/3 v1).** First version. Wired `POST /webhooks/clerk` on existing PqApi → new `PqClerkWebhook` Lambda that calls `provisionOrg`. Used `sst.Secret` (SSM-backed). Merged but failed deploy-dev with `SecretMissingError`.
- **PR #97 — Hotfix replacing #96.** Switched secrets from `sst.Secret` (SSM) to `process.env` (matches existing `WELCOME_EMAIL_FROM` GitHub-Environment pattern). Plus 5 review-bot findings addressed (Bug 1 admin-role gate `org:admin` not just `admin`; Bug 2 verified primary email via `@clerk/backend` users.getUser; Bug 3 wire `CLERK_ADMIN_ROLES` end-to-end through deploy plumbing; Bug 4 `Verification.status === "verified"` check; Bug 5 `getAdminRoles` whitespace fallback; Bug 6 `$util.secret()` Pulumi state encryption; Bug 7 trim secret values before validation).
- **PR #98 — Hotfix: drop `AWS_REGION` from PqClerkWebhook env.** Lambda reserved key; `CreateFunction` rejected explicit values. Doc-comment so it can't sneak back.
- **Prod deploy (`Deploy to Production` workflow on `a8f181b`)** triggered manually after dev was verified end-to-end on real Svix traffic under the historical pre-Lago runtime (`org_3CTU4Oh1XTqVdEGcyTBGqRWujCm` provisioned: Stripe customer + envelope + audit row, all atomic; 4 subsequent retries returned `already_exists` with zero side effects). Prod smoke-tested with non-admin role payload — handler skipped correctly in 13ms.

### Verification evidence

- 129 tests pass workspace-wide (10 shared + 50 control-plane + 21 ingestion + 20 api + 28 webhooks).
- 4 integration tests pass against `amazon/dynamodb-local:2.5.2` (1 control-plane, 3 webhooks).
- Historical dev `prontiq-keys-dev` evidence had `ORG#org_3CTU4Oh1XTqVdEGcyTBGqRWujCm` envelope with `tier: "free"`, `hasFirstKey: false`, `stripeCustomerId: cus_UM5zw8xl8HgS9n`. Current post-P1B.20 provisioning writes `stripeCustomerId: null` and bootstraps Lago Free.
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
   - **Email resolution:** mirror the webhook's pattern — call `clerkClient.users.getUser(userId)` via the same `@clerk/backend` client and use the verified primary email (the `Bug 4` invariant from PR #97 — never trust client-side claims for the `ownerEmail` used in provisioning).

   **Implementation flow:**
   - New `packages/api/src/middleware/clerk-jwt.ts` — Hono middleware that verifies the JWT and sets `c.set("clerkPrincipal", { userId, orgId })`.
   - New `packages/api/src/routes/account.ts` — `POST /v1/account/setup` route. Reuses `createProvisioningService` from `@prontiq/control-plane`. Maps `ProvisioningResult.status` → 200 (`already_exists`), 201 (`created`), 503 (`retryable_failure`), 500 (`fatal_failure`).
   - New `packages/api/src/account-handler.ts` — separate Lambda entry point (mounts only the Clerk-JWT middleware + account routes; does NOT include the address routes or API-key auth middleware).
   - Historical implementation note: the original account route plan included `STRIPE_SECRET_KEY` while the pre-Lago provisioning path still created Stripe customers. Current post-P1B.20 deploys must not require Stripe secrets; account setup uses Clerk + Lago config only.
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

**Roadmap progress at that time:** 5/69 tickets (P0.1, P0.2, P0.4, P0.5 done;
P0.3 needs CI test, P0.6 needs OpenSearch)

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

**Roadmap progress at that time:** 0/69 tickets (scaffolding complete, P0 ready
to start)

**Next session should start with:**

1. Read NEXT-WORK.md
2. P0.4 (ESLint + Prettier) — no blockers, can do immediately
3. P0.5 (Dependabot) — no blockers, quick win
4. P0.1 (IAM role) — requires AWS console/CLI access
5. Then P0.2 (SST bootstrap) once role exists
