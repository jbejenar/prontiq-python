# P1B.19 Implementation Plan — Stripe Legacy Billing Retirement and Cutover

## Intent

Cut over Prontiq billing so Clerk owns users/org auth, Lago owns billing/subscriptions/invoices, Prontiq owns local request-time counting, and Stripe is used only as Lago's payment rail.

## Current State

P1B.14 through P1B.18 are shipped. Lago identity, usage forwarding, webhook reconciliation, live smoke evidence, and private account billing APIs exist. The remaining legacy Stripe runtime is the Stripe webhook, hourly billing cron, month-close, and provisioning-time Stripe customer creation.

## Constraints

- Public address API hot path must never call Lago or Stripe.
- Stripe IDs are nullable linkage only, never billing identity.
- Existing `STRIPE_*` secrets stay through P1B.19 for rollback; P1B.20 removes dead config.
- New and existing active orgs must have Lago billing-period fields before prod is declared cut over.
- `CONSOLE_BILLING_PLAN_CHANGES_ENABLED` remains separately controlled.

## Approach

Ship code first with legacy runtime still enabled by default. Then execute an operator cutover by setting:

- `LEGACY_STRIPE_RUNTIME_ENABLED=false`
- `BILLING_EVENTS_ENABLED=true`
- `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true`
- `COUNTER_PERIOD_SOURCE=lago`

Forward provisioning no longer creates Stripe customers. It creates local Prontiq customer/envelope state, idempotently upserts the Lago customer and Free subscription, and writes Lago subscription/billing-period fields locally before returning success.

## Phases

1. Add safe runtime flag `LEGACY_STRIPE_RUNTIME_ENABLED`, defaulting to enabled.
2. Update provisioning to support forward Lago bootstrap and nullable Stripe linkage.
3. Gate Stripe webhook, billing cron, and month-close when the runtime flag is disabled.
4. Switch deployed cutover posture to Lago billing periods after preflight.
5. Update architecture, runbooks, handoff, decisions, private API docs, and hints.

## Documentation Updates

- `ARCHITECTURE.MD`, `AGENTS.md`, `README.md`: post-cutover billing posture.
- `ROADMAP.md`, `NEXT-WORK.md`, `NEXT-SESSION.md`, `CHANGELOG.md`: ticket state and handoff.
- `docs/private-api/account-billing.md`: nullable `stripeCustomerId` and `customerId`.
- `docs/runbooks/stripe-legacy-cutover.md`: cutover procedure.
- `docs/runbooks/clerk-webhook.md`, `stripe-webhook.md`, `month-close.md`, `lago-*`, `monitoring-alerting.md`: active vs retired operator paths.
- `docs/decisions/031-stripe-legacy-runtime-retirement.md` and `032-lago-period-cutover.md`.
- `packages/api/HINTS.md`, `packages/control-plane/HINTS.md`, `apps/console/HINTS.md`.

## Test Strategy

- Provisioning legacy mode still creates Stripe customer.
- Provisioning forward mode creates no Stripe customer, bootstraps Lago customer/subscription, and writes billing-period fields.
- Existing envelope without Lago fields resumes bootstrap.
- Stripe webhook retired mode verifies signatures and returns 200 without dispatch.
- Cron/month-close retired mode performs no Stripe/DDB billing mutation.
- Private OpenAPI includes the new setup response and public OpenAPI remains clean.

## Risk & Rollback

- Roll back by setting `LEGACY_STRIPE_RUNTIME_ENABLED=true` and `COUNTER_PERIOD_SOURCE=calendar`, then redeploying.
- Replay Stripe events manually only if a real event arrived while retired.
- Do not delete Lago ledgers, billing action rows, Lago-period usage rows, or smoke evidence.

## Open Questions

None.

## Estimate

3-4 engineering days including implementation, docs, deploy verification, and PR review.

## File Checklist

| Phase | Files | Doc update |
|---|---|---|
| 1 | `sst.config.ts`, deploy workflows | No |
| 2 | `packages/control-plane/src/provisioning.ts`, tests | No |
| 2 | `packages/api/src/routes/account.ts`, private OpenAPI | Yes |
| 3 | `packages/webhooks/src/stripe.ts`, cron/month-close services | Yes |
| 4 | Runtime env verification | Yes |
| 5 | Architecture, runbooks, decisions, handoff, hints | Yes |

`P1B.19: 5 phases, 23 documentation updates, 0 open questions.`
