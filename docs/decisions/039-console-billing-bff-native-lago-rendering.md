# ADR-039: Console Billing Uses a Vercel BFF with Native Lago Rendering

## Status

Accepted

## Context

P1B.22 retired AWS `/v1/account/billing*` routes and made Clerk `orgId` the
active commercial identity. Lago owns billing state and subscriptions. Stripe
is only the payment rail inside Lago. The console needs a first-party Billing
page without exposing Lago or Stripe credentials to the browser.

## Decision

Implement console billing in `apps/console` through Vercel server-side route
handlers:

- `GET /api/billing/summary`
- `POST /api/billing/checkout`
- `POST /api/billing/invoices/payment-url`

The BFF verifies Clerk server auth, reads the active org id, calls Lago with
server-held credentials, and returns normalized UI DTOs. The browser renders
plans, subscription state, current billing usage estimate, and invoices from
those DTOs.

Plan catalog visibility is controlled by Lago metadata:
`prontiq_console_visible=true`, optional `prontiq_environment=dev|prod|all`,
and exclusion flags `prontiq_test=true` or `prontiq_internal=true`.

P1C.05 only creates payment-method and invoice-payment links. It does not
mutate subscriptions. Replay-safe plan changes require a separate idempotency
store and are deferred to P1C.05a.

## Considered And Rejected

- Reintroduce AWS `/v1/account/billing*`: rejected because the current
  architecture keeps AWS account APIs focused on setup, keys, usage, and hot
  path enforcement while console billing reads from Lago directly.
- Browser calls to Lago: rejected because it would expose Lago credentials and
  provider data to client code.
- Embedded Stripe-first billing UI: rejected because Stripe is not the billing
  system of record.
- Hard-coded plan cards in the console: rejected because Lago is the plan,
  quota, PAYG, and package source of truth.
- Subscription mutation in P1C.05: rejected until a replay-safe idempotency
  mechanism exists for Vercel-initiated billing mutations.

## Consequences

- Vercel preview and production require `LAGO_API_URL` and `LAGO_API_KEY`.
- Operators manage console plan visibility in Lago metadata.
- The AWS private OpenAPI spec remains unchanged for billing.
- Future plan changes must be implemented in P1C.05a with explicit idempotency
  and rollback semantics.
