# Console Billing Runbook

Operational guidance for the P1B.18 account billing API surfaces.

## Surfaces

- `GET /v1/account/billing` returns current local billing state and bounded Lago
  subscription state.
- `POST /v1/account/billing/plan-change` requests a self-service Lago plan
  change for `free` or `payg`.
- `POST /v1/account/billing/portal-session` returns a Lago customer portal URL
  for invoices, billing details, and payment-management actions.

All routes run in the `PqAccount` Lambda and require Clerk org-admin auth.

## Preconditions

- `LAGO_API_URL` and `LAGO_API_KEY` are configured for the environment.
- `BILLING_ACTIONS_TABLE_NAME` points at the stage billing-action ledger.
- `LAGO_PAYMENT_PROVIDER_CODE` matches the Lago Stripe payment provider code
  when payment-provider config is required.
- `CONSOLE_BILLING_PLAN_CHANGES_ENABLED=true` only when mutation is intended.
- `CONSOLE_BILLING_PLAN_CHANGE_ALLOWED_ORG_IDS` includes only repo-owned test
  orgs until production cutover.

## Smoke

1. Use a repo-owned test org, not another repo's retained Lago org.
2. Call `GET /v1/account/billing` with a Clerk admin token.
3. Confirm `customer.customerId` is `pq_cust_*` and subscription external id is
   `pq_sub_*`.
4. Call `POST /v1/account/billing/portal-session` with `Idempotency-Key`.
5. Confirm the returned URL opens the Lago portal.
6. Call `POST /v1/account/billing/plan-change` with `targetPlanCode` set to the
   intended `free` or `payg` target and an `Idempotency-Key`.
7. Replay the same request and confirm the same response is returned.
8. Replay the same idempotency key with a different body and confirm
   `IDEMPOTENCY_CONFLICT`.
9. If Lago is temporarily unavailable, retry the same idempotency key and same
   body; retryable ledger rows are reclaimable, but permanent failures replay
   as stored failures.
10. Confirm `prontiq-billing-actions` contains the action record.
11. Replay the same successful scheduled plan-change after pending metadata is
   visible locally; it must return the stored response rather than
   `PLAN_CHANGE_ALREADY_PENDING`.
12. Temporarily unavailable Lago must not prevent stored successful replay,
   stored failure replay, or provider-accepted resume from returning from the
   local ledger.
13. If Lago accepted the mutation but local metadata repair failed, retry the
   same idempotency key and same body; the action should resume from stored
   provider outcome without resubmitting Lago.
14. Confirm a fresh request for the current local plan still returns
   `PLAN_CHANGE_ALREADY_PENDING` when a different transition is already
   scheduled; it must not return `noop`.
15. Confirm pending transition metadata is present on both the org envelope and
    active API-key records, with enforcement fields unchanged until Lago reports
    the active replacement state.
16. Confirm Lago webhooks reconcile local state without putting Lago on the API
   request hot path.

## Rollback

- Set `CONSOLE_BILLING_PLAN_CHANGES_ENABLED=false` and redeploy to stop
  mutations.
- Leave `GET /v1/account/billing` available unless it is causing operator
  confusion.
- Do not delete `prontiq-billing-actions` rows; they are billing evidence.
- If a wrong Lago plan change was submitted, preserve the action row and submit
  a compensating Lago plan change.
- Do not manually flip a permanent failure row to `processing`; inspect the
  provider-side result first and create a fresh operator-approved action if a
  retry is appropriate.

## Alerts

`PqAccountErrors` covers account route 5xx responses. On alarm, inspect
CloudWatch logs for `api-account` and `control-plane-account-billing`, then
check the matching `prontiq-billing-actions` row before retrying a mutation.
