# Account Billing API

Private account billing is deliberately narrow. Lago is the billing source of
truth; the platform only owns replay-safe mutation ingress and local API
enforcement projection.

## Active Route

```text
POST /v1/account/billing/plan-change
```

Purpose: change the active Lago subscription plan for the current Clerk
organization.

Authentication and authorization:

- Requires a valid Clerk session JWT.
- Requires active Clerk organization context.
- Requires org admin role.
- Requires fresh first-factor Clerk reverification.
- Requires `Idempotency-Key` header.

Request body:

```json
{
  "targetPlanCode": "starter"
}
```

Success response:

```json
{
  "currentPlanCode": "starter",
  "downgradePlanDate": null,
  "nextPlanCode": null,
  "reconciliationState": "pending_lago_webhook",
  "status": "accepted",
  "targetPlanCode": "starter"
}
```

Replay and safety contract:

- The route records action evidence in `prontiq-billing-actions*` before
  calling Lago.
- Billing plan changes are currently scoped to `productPool = "ADDRESS"`. The
  product pool is included in the action id, request hash, lock record, and
  action record so future product pools cannot collide with Address billing
  transitions.
- Same `Idempotency-Key` plus same request replays the stored terminal result.
- Same `Idempotency-Key` plus different body returns
  `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`.
- Concurrent different plan changes for the same org return
  `BILLING_TRANSITION_IN_PROGRESS` when an existing provider/payment/outcome
  fence is active. Short pre-provider lock contention may still return
  `ACTION_IN_PROGRESS`.
- Once the provider boundary is crossed, ambiguous outcomes are operator
  reconcile events. They return `LAGO_PLAN_CHANGE_OUTCOME_UNKNOWN`, keep the
  per-org lock as a manual-reconcile fence, and are not automatically replayed
  into another Lago mutation. This response is returned on the original
  ambiguous request and on same-key retries.
- The route never updates local request-time enforcement directly. Lago webhook
  reconciliation or the Lago reconcile job projects accepted plan state into
  DynamoDB bouncer fields.

Common errors:

- `MISSING_IDEMPOTENCY_KEY`
- `INVALID_IDEMPOTENCY_KEY`
- `FEATURE_DISABLED`
- `ORG_NOT_ALLOWLISTED`
- `TARGET_PLAN_NOT_AVAILABLE`
- `PAYMENT_PROVIDER_NOT_LINKED`
- `PAYMENT_METHOD_REQUIRED`
- `PLAN_CHANGE_ALREADY_PENDING`
- `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`
- `BILLING_TRANSITION_IN_PROGRESS`
- `BILLING_ACTION_LEDGER_UNAVAILABLE`
- `LAGO_PLAN_CHANGE_OUTCOME_UNKNOWN`

## Retired Routes

These remain retired and must not be reintroduced without a new decision record:

```text
GET  /v1/account/billing
POST /v1/account/billing/portal-session
```

## Vercel Billing BFF

Billing reads and payment-link actions still live in `apps/console`:

```text
GET  /api/billing/summary
POST /api/billing/checkout
POST /api/billing/invoices/payment-url
```

Those routes call Lago from Vercel server-side code with server-held Lago
credentials. They do not mutate subscriptions.
