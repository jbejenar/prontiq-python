# Console Billing Runbook

## Current Contract

P1B.22 retired the AWS private account billing routes:

- `GET /v1/account/billing`
- `POST /v1/account/billing/plan-change`
- `POST /v1/account/billing/portal-session`

Active AWS private account routes are setup recovery, key management, audit,
and usage. Billing reads/actions are still not provided by the AWS private API.

Console billing uses a Vercel-hosted server-side BFF that reads the Clerk
session/org claims, keeps Lago API keys in Vercel server env, and calls Lago
directly for billing reads or payment-link actions. The platform backend
remains responsible for API key management and hot-path credit enforcement only.

## BFF Routes

```text
GET  /api/billing/summary
POST /api/billing/checkout
POST /api/billing/invoices/payment-url
```

`GET /api/billing/summary` returns the active Lago subscription, current-usage
billing estimate, visible Lago plans, and recent invoices for the active Clerk
org.

`POST /api/billing/checkout` is admin-only. It returns a Lago-generated Stripe
checkout URL for payment-method setup. It does not change the subscription
plan. If the BFF returns `PAYMENT_PROVIDER_NOT_LINKED`, Lago has the customer
record but has not created or linked the backing Stripe customer yet. Run the
Lago customer sync repair flow, then retry checkout.

`POST /api/billing/invoices/payment-url` is admin-only. It verifies the invoice
belongs to the active org before asking Lago for a payment URL.

## Operator Checks

- The user must have an active Clerk org context.
- The active org id is the commercial customer identity.
- Lago customer external id must equal the Clerk org id.
- Lago subscription external id must equal `lago_sub_${orgId}`.
- Stripe customer/payment state is managed through Lago, not platform routes.
- Lago customers must be upserted with Stripe provider sync enabled
  (`sync=true`, `sync_with_provider=true`) and card/link payment methods.
- Vercel preview/production must set `LAGO_API_URL` and `LAGO_API_KEY`.
- Plan catalog visibility is driven by Lago metadata:
  `prontiq_console_visible=true` includes a plan;
  `prontiq_test=true` and `prontiq_internal=true` exclude a plan;
  `prontiq_environment=dev|prod|all` scopes a plan to an environment.
- If `/billing` shows no plans, fix Lago metadata rather than adding hard-coded
  plan fallbacks.

## Smoke Test

1. Sign in to the console and select a Clerk organization.
2. Open `/billing`.
3. Confirm the current plan/subscription matches Lago for
   `external_id = lago_sub_${orgId}`.
4. Confirm only metadata-visible plans are shown and test/internal plans are
   hidden.
5. As an admin, click payment setup and confirm the generated URL opens the
   Lago/Stripe checkout flow.
   - If this fails with `PAYMENT_PROVIDER_NOT_LINKED`, run
     `repair:commercial-identity -- --apply` for the stage and confirm the Lago
     customer has a non-empty provider customer id before retesting.
6. If an unpaid invoice fixture exists, click "Pay invoice" and confirm the URL
   belongs to the active org's invoice.

## Rollback Note

The retired AWS routes should not be reintroduced casually. If a future BFF
cannot call Lago directly, create a new ticket and decision record for the
specific route shape and security boundary.
