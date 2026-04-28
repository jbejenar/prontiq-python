# DEC-033: Remove Platform-Owned Legacy Stripe Deploys

## Status

Accepted.

## Context

P1B.19 cut runtime billing over to Lago while leaving disabled Stripe webhook,
billing cron, month-close, and pricing-table surfaces available during cutover.
That was safe for migration, but unsafe as a long-term repo posture because it
kept deploy secrets, package dependencies, and docs implying that Prontiq still
owned a Stripe billing runtime.

## Decision

Remove the platform-owned Stripe webhook, hourly billing cron, month-close,
Stripe Pricing Table, Stripe deploy envs, `LEGACY_STRIPE_RUNTIME_ENABLED`, and
direct `stripe` package dependencies from active code/config. Keep only
historical persisted fields and docs needed to interpret migration-era data.

Stripe remains configured inside Lago as the payment rail. Prontiq Platform does
not call Stripe directly for provisioning, billing reconciliation, metering, or
customer billing UX.

## Considered And Rejected

- Keep disabled no-op deploys indefinitely: rejected because it preserves dead
  operational surfaces and secret inventory.
- Delete all Stripe references, including persisted linkage fields: rejected
  because historical records and migration tooling still need to interpret
  `stripeCustomerId` and related snapshots.
- Move legacy Stripe runtime into a separate package: rejected because there is
  no current rollback requirement strong enough to justify maintaining inactive
  billing code.

## Consequences

- Rollback to the old Stripe-owned billing runtime is no longer a flag flip; it
  would require a new implementation/revert decision.
- GitHub Environment deploy secret inventory shrinks because `STRIPE_*` secrets
  are no longer required by Platform deploys.
- Future billing work must use Lago directly through approved server-side
  integration surfaces. After ADR-035, the AWS private account API owns setup
  recovery and key management only; console billing UX should use a Vercel BFF
  with server-held Lago credentials unless a new decision record reintroduces
  another runtime owner.
