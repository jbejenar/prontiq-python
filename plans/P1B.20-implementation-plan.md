# P1B.20 Implementation Plan -- Legacy Stripe Config and Surface Cleanup

## Intent

Remove retired Stripe billing-runtime config, deploy targets, and landing
pricing-table surfaces after the verified P1B.19 Lago cutover, while preserving
Stripe only as Lago's payment rail.

## Current State

This section captures the pre-implementation state that P1B.20 is intended to
remove.

P1B.19 is merged on `main` at `26910c042bfacfc781043a1a24b6188189ae7ad7`.
Dev and prod have been verified with `LEGACY_STRIPE_RUNTIME_ENABLED=false`,
`COUNTER_PERIOD_SOURCE=lago`, Lago billing events accepted, and legacy
cron/month-close disabled.

Before P1B.20 implementation, the repo deployed `PqStripeWebhook`,
`PqBillingCron`, and `PqMonthClose`, carried platform Stripe billing secrets in
deploy workflows, and `apps/landing` rendered the interim Stripe Pricing Table
fallback.

## Constraints

- Stripe remains valid only inside Lago as the payment rail.
- Do not remove `LAGO_PAYMENT_PROVIDER_CODE` or Lago provider references.
- The platform must not call Stripe directly after this ticket.
- Public address API and public OpenAPI must not change.
- Keep persisted historical fields such as `stripeCustomerId`,
  `stripeSubscriptionId`, `subscriptionItems`, `paymentOverdue`, and usage
  watermark fields for compatibility and audit.
- Do not delete smoke fixtures, ledger rows, usage rows, or customer data.
- Rollback is PR revert plus redeploy, not an env-flag flip.

## Approach

Remove deployed legacy Stripe runtime resources instead of tombstoning them.
Delete platform Stripe webhook/cron/month-close deploys, remove their active
secret/env contracts, remove direct Stripe runtime code, and tombstone operator
docs as historical context. Replace the landing embedded Pricing Table with a
first-party Free/PAYG billing card aligned to Lago.

## Phases

1. Add this implementation plan.
2. Remove landing Stripe Pricing Table code, envs, tests, copy, and custom
   element declarations.
3. Remove platform legacy Stripe runtime deploys, routes, alarms, workflows,
   env contracts, code, exports, and tests.
4. Reconcile architecture, roadmap, decisions, runbooks, HINTS, READMEs,
   changelog, and private API docs.
5. Verify with tests, OpenAPI generation, grep classification, and deploy
   evidence.

## Documentation Updates

- `ARCHITECTURE.MD`, `README.md`, `AGENTS.md`, `ROADMAP.md`, `NEXT-WORK.md`,
  `NEXT-SESSION.md`, and `CHANGELOG.md`: post-P1B.20 runtime posture.
- `docs/decisions/033-remove-legacy-stripe-deploys.md`: accepted decision to
  remove deployed resources rather than keep no-op tombstones.
- `docs/decisions/031-stripe-legacy-runtime-retirement.md` and
  `docs/decisions/007-stripe-pricing-table-not-used-for-hybrid-billing.md`:
  note cleanup completion.
- `docs/runbooks/stripe-webhook.md`, `docs/runbooks/month-close.md`, and
  `docs/runbooks/stripe-legacy-cutover.md`: historical-only tombstones.
- Active Lago, Clerk, monitoring, SES, and go-live runbooks: remove instructions
  to configure or maintain retired platform Stripe billing.
- `docs/private-api/account-billing.md`: account setup no longer returns
  `stripeCustomerId`.
- `packages/docs/guides/billing.mdx`: Lago-centered runtime is active.
- `apps/landing/README.md`, `apps/landing/HINTS.md`, and
  `docs/FRONTEND-STRATEGY.md`: remove Stripe Pricing Table guidance.

## Test Strategy

- Run landing test/typecheck/build.
- Run control-plane, webhooks, and API tests/typecheck.
- Run `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, and
  `pnpm format:check`.
- Run `pnpm generate:openapi`; verify public OpenAPI remains unchanged and
  private account setup changes only if expected.
- Run targeted grep over `STRIPE_`, `stripe-pricing-table`, `Pricing Table`,
  `PqStripeWebhook`, `PqBillingCron`, `PqMonthClose`,
  `LEGACY_STRIPE_RUNTIME_ENABLED`, and `POST /webhooks/stripe`.
- Dev/prod deploy verification: old Stripe Lambda/cron/alarm resources absent,
  address API smoke passes, Lago billing event smoke still accepted, queues and
  DLQs empty.

## Risk & Rollback

- If the old Stripe Dashboard platform webhook remains enabled after route
  removal, Stripe may retry against a missing endpoint. Disable/delete only the
  old platform webhook endpoint during rollout; do not touch Lago-created
  Stripe webhooks.
- If Lago provider config is wrong, account setup can fail. Verify
  `LAGO_PAYMENT_PROVIDER_CODE=stripe-main` and Lago customer bootstrap in dev
  before prod.
- Rollback requires reverting this PR and redeploying. Existing ledgers,
  usage rows, and historical data fields remain intact for diagnosis.

## Open Questions

None.

## Estimate

- Phase 1: 0.25 day.
- Phase 2: 0.5-1 day.
- Phase 3: 1.5-2.5 days.
- Phase 4: 0.75-1.25 days.
- Phase 5: 0.5-1 day.

## File Checklist

| Phase | Files                                                                                                 | Doc update |
| ----- | ----------------------------------------------------------------------------------------------------- | ---------- |
| 1     | `plans/P1B.20-implementation-plan.md`                                                                 | Yes        |
| 2     | `apps/landing/**`, `packages/shared/src/content*`                                                     | Yes        |
| 3     | `sst.config.ts`, workflows, `.env.example`, control-plane/webhook/api code, private OpenAPI, lockfile | Partial    |
| 4     | Architecture, roadmap, handoff docs, decisions, runbooks, READMEs, HINTS, changelog, billing guide    | Yes        |
| 5     | Verification notes in PR/session                                                                      | No         |

`P1B.20: 5 phases, 31 doc updates, 0 open questions.`
