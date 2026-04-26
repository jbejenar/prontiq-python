# Stripe Webhook Runbook

> Historical only. Absorbed by the Lago-centered commercial runtime and P1B.20
> cleanup on 2026-04-26. This file is retained for git history and migration
> context only; it is not an active operator runbook.

`POST /webhooks/stripe` is no longer deployed by Prontiq Platform. Stripe is
configured only as the payment rail inside Lago. Current commercial-state
reconciliation uses `POST /webhooks/lago`; see
[lago-webhook-reconciliation.md](./lago-webhook-reconciliation.md).

Do not configure GitHub Environment `STRIPE_*` secrets for Platform deploys and
do not create new Stripe webhook endpoints that point at `api.prontiq.dev`
without a new decision record.
