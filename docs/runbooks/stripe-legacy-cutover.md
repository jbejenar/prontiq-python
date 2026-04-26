# Stripe Legacy Runtime Cutover Runbook

> Historical only. P1B.19 used this runbook to cut runtime billing over to Lago.
> P1B.20 then removed the disabled Stripe runtime/config/frontend surfaces on
> 2026-04-26. This file is retained for git history only; it is not an active
> rollback or deployment procedure.

Current posture:

- Lago is the commercial system of record.
- Stripe is only the payment rail configured inside Lago.
- Prontiq Platform no longer deploys Stripe webhook, billing-cron, or
  month-close Lambdas.
- `LEGACY_STRIPE_RUNTIME_ENABLED` and `STRIPE_*` deploy secrets are not part of
  the Platform deploy contract.

Any future return to a direct Stripe-owned runtime requires a new decision
record and implementation plan.
