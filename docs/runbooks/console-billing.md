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
POST /api/billing/plan-change
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

`POST /api/billing/plan-change` is admin-only and Clerk step-up protected. The
route requires recent first-factor reverification, so password-only admins can
change plans without being forced to enroll MFA. The browser sends a per-click
`Idempotency-Key`; the Vercel BFF writes a `prontiq-billing-actions*` action
row and an org-level lock row before calling Lago's subscription
upgrade/downgrade flow. The route does not update local API enforcement
directly. Lago webhook reconciliation updates the DynamoDB bouncer projection
after Lago accepts or applies the transition.
If the ledger cannot be inspected or claimed, the route returns
`BILLING_ACTION_LEDGER_UNAVAILABLE` and does not call Lago.
Immediately before calling Lago, the route transitions the action to
`provider_in_flight` and extends the org lock as a manual-reconcile fence. If a
process dies, times out, or fails to finalize after this point, same-key retries
return `LAGO_PLAN_CHANGE_OUTCOME_UNKNOWN` and do not call Lago again.
If Lago or the network fails after an action is claimed and the provider outcome
is ambiguous, the route stores terminal `outcome_unknown` evidence. Retrying
the same `Idempotency-Key` replays that stored error and does not call Lago
again. Inspect Lago and reconcile the subscription state before attempting a new
plan change with a new `Idempotency-Key`.

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
- Vercel preview/production must set billing-action ledger env before enabling
  plan changes:
  - `BILLING_ACTIONS_TABLE_NAME`
  - `BILLING_ACTIONS_AWS_REGION=ap-southeast-2`
  - `BILLING_ACTIONS_AWS_ACCESS_KEY_ID`
  - `BILLING_ACTIONS_AWS_SECRET_ACCESS_KEY`
  - `PRONTIQ_BILLING_PLAN_CHANGES_ENABLED`
  - `PRONTIQ_BILLING_PLAN_CHANGE_ALLOWED_ORG_IDS` for prod allowlist rollout
- The billing-action AWS credential must be scoped to the billing-actions table
  and `orgId-updatedAt-index` only.
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
7. As an admin with fresh Clerk step-up, click "Change to ..." for a non-current
   visible plan.
8. Confirm Lago shows the subscription as changed or pending on
   `external_id = lago_sub_${orgId}`.
9. Repeat the same request with the same `Idempotency-Key` in a controlled test
   and confirm the BFF replays the same result without a second Lago mutation.
10. Confirm Lago webhook reconciliation updates local API-key enforcement rows.
    If reconciliation lags, replay the Lago webhook or run the existing
    `pnpm --filter @prontiq/control-plane lago:reconcile` operator flow.
11. If the route returns `BILLING_ACTION_FINALIZE_FAILED`, check Lago first:
    the provider may already have accepted the change, or Lago may have rejected
    the change while the BFF failed to persist that failure. Do not manually
    submit a second different plan change until Lago state has been inspected.
12. If the route returns `LAGO_PLAN_CHANGE_OUTCOME_UNKNOWN`, a previous attempt
    crossed the provider boundary and did not finalize. Inspect Lago, reconcile
    the subscription and local bouncer projection, then start a fresh action
    only after the actual Lago state is known.
13. If the route returns a stored `LAGO_PLAN_CHANGE_FAILED` from an
    `outcome_unknown` ledger row, do not keep retrying. Inspect Lago, reconcile
    the subscription and local bouncer projection, then start a fresh action
    only after the actual Lago state is known.
14. If the route returns `BILLING_ACTION_LEDGER_UNAVAILABLE`, do not retry with
    a different idempotency key until DynamoDB health/IAM has been checked; the
    route should not have called Lago.

## Rollback Note

The retired AWS routes should not be reintroduced casually. If a future BFF
cannot call Lago directly, create a new ticket and decision record for the
specific route shape and security boundary.

Plan changes can be disabled without affecting billing reads, checkout, or
invoice payment links by setting `PRONTIQ_BILLING_PLAN_CHANGES_ENABLED=false`
in the relevant Vercel environment.
