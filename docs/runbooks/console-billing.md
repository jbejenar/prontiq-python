# Console Billing Runbook

## Current Contract

P1B.22 retired the AWS private account billing routes:

- `GET /v1/account/billing`
- `POST /v1/account/billing/plan-change`
- `POST /v1/account/billing/portal-session`

`POST /v1/account/setup` remains the only active AWS private account route.

Future console billing surfaces should use a Vercel-hosted server-side BFF that
reads the Clerk session/org claims, keeps Lago API keys in Vercel server env,
and calls Lago directly for billing reads or self-service actions. The platform
backend remains responsible for API key management and hot-path credit
enforcement only.

## Operator Checks

- The user must have an active Clerk org context.
- The active org id is the commercial customer identity.
- Lago customer external id must equal the Clerk org id.
- Lago subscription external id must equal `lago_sub_${orgId}`.
- Stripe customer/payment state is managed through Lago, not platform routes.

## Rollback Note

The retired AWS routes should not be reintroduced casually. If a future BFF
cannot call Lago directly, create a new ticket and decision record for the
specific route shape and security boundary.
