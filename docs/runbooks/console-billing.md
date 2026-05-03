# Console Billing Runbook

## Current Contract

P1B.22 retired broad AWS private account billing routes. P1C.05a reintroduces
one narrow mutation adapter because plan changes need AWS-owned idempotency
evidence and an org-level mutation lock:

- Active: `POST /v1/account/billing/plan-change`
- Retired: `GET /v1/account/billing`
- Retired: `POST /v1/account/billing/portal-session`

Active AWS private account routes are setup recovery, key management, audit,
usage, and the plan-change mutation adapter. Billing reads and payment-link
actions are still not provided by the AWS private API.

Console billing uses a Vercel-hosted server-side BFF that reads the Clerk
session/org claims, keeps Lago API keys in Vercel server env, and calls Lago
directly for billing reads or payment-link actions. The browser calls the
private account API for plan changes with the same Clerk JWT pattern used by key
management. The platform backend remains responsible for API key management,
hot-path credit enforcement, usage projection, and the plan-change ledger.

## BFF Routes

```text
GET  /api/billing/summary
POST /api/billing/checkout
POST /api/billing/invoices/payment-url
POST /v1/account/billing/plan-change
```

`GET /api/billing/summary` returns the active Lago subscription, current-usage
billing estimate, visible Lago plans, and recent invoices for the active Clerk
org.

`POST /api/billing/checkout` is admin-only. It returns a Lago-generated Stripe
checkout URL for payment-method setup. It does not change the subscription
plan. If the BFF returns `PAYMENT_PROVIDER_NOT_LINKED`, Lago has the customer
record but has not created or linked the backing Stripe customer yet. Run the
Lago customer sync repair flow, then retry checkout.

`POST /v1/account/billing/plan-change` is admin-only and Clerk step-up
protected. The route requires recent first-factor reverification, so
password-only admins can change plans without being forced to enroll MFA. The
browser sends a per-click `Idempotency-Key`; the AWS account API writes a
`prontiq-billing-actions*` action row and an org-level lock row before calling
Lago's subscription upgrade/downgrade flow. The route does not update local API
enforcement directly. Lago webhook reconciliation updates the DynamoDB bouncer
projection after Lago accepts or applies the transition.
The current adapter is scoped to the Address product pool. Action ids, request
hashes, action rows, and lock rows carry `productPool = "ADDRESS"`; legacy
unscoped rows remain readable for replay/reconciliation only.
If the ledger cannot be inspected or claimed, the route returns
`BILLING_ACTION_LEDGER_UNAVAILABLE` and does not call Lago.
Immediately before calling Lago, the route transitions the action to
`provider_in_flight` and extends the org lock as a manual-reconcile fence. If a
process dies, times out, or fails to finalize after this point, same-key retries
return `LAGO_PLAN_CHANGE_OUTCOME_UNKNOWN` and do not call Lago again.
If Lago or the network fails after an action crosses the provider boundary and
the provider outcome is ambiguous, the route stores terminal `outcome_unknown`
evidence, keeps the org-level mutation lock as a manual-reconcile fence, and
returns `LAGO_PLAN_CHANGE_OUTCOME_UNKNOWN` on the original request and on
same-key retries. Different idempotency keys for the same org are blocked until
the lock is explicitly reconciled/cleared by an operator after Lago state is
known. Those different-key attempts return `BILLING_TRANSITION_IN_PROGRESS`, not
another Lago mutation.

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
- Vercel preview/production must set `LAGO_API_URL` and `LAGO_API_KEY` for
  billing summary, checkout, and invoice-payment links.
- AWS dev/prod GitHub Environments must set `PRONTIQ_BILLING_PLAN_CHANGES_ENABLED`
  before plan changes are allowed.
- `PRONTIQ_BILLING_PLAN_CHANGE_ALLOWED_ORG_IDS` may be set for staged rollout.
- `PRONTIQ_BILLING_CATALOG_ENV=dev|prod|all` controls Lago plan visibility.
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
   and confirm the account API replays the same result without a second Lago
   mutation.
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
13. A stored `outcome_unknown` ledger row replays
    `LAGO_PLAN_CHANGE_OUTCOME_UNKNOWN`; do not keep retrying. Inspect Lago,
    reconcile the subscription and local bouncer projection, then clear the
    manual-reconcile fence only after the actual Lago state is known.
14. If the route returns `BILLING_ACTION_LEDGER_UNAVAILABLE`, do not retry with
    a different idempotency key until DynamoDB health/IAM has been checked; the
    route should not have called Lago.

## Rollback Note

The retired AWS billing read/portal routes should not be reintroduced casually.
If a future billing read or payment-link route moves from Vercel to AWS, create
a new ticket and decision record for the specific route shape and security
boundary.

Plan changes can be disabled without affecting billing reads, checkout, or
invoice payment links by setting `PRONTIQ_BILLING_PLAN_CHANGES_ENABLED=false`
in the relevant AWS environment.
