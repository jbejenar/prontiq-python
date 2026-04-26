# Stripe Legacy Runtime Cutover Runbook

## Purpose

Use this runbook for P1B.19 when retiring Stripe as a Prontiq billing runtime while keeping Stripe as Lago's payment rail.

## Target Posture

- Clerk owns users and org auth.
- Lago owns billing, subscriptions, invoices, and payment-provider orchestration.
- Stripe takes payments only through Lago.
- Prontiq owns local counters and enforcement.

## Preconditions

- P1B.14 through P1B.18 are shipped and verified.
- Lago Free and PAYG plans exist in AUD.
- `LAGO_PAYMENT_PROVIDER_CODE` points to the Lago Stripe payment provider.
- `BILLING_EVENTS_ENABLED=true`.
- `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true`.
- All active/test orgs have active customer rows and Lago subscription/billing-period fields.
- Billing event queue and DLQ are healthy.
- `PqLagoWebhookErrors`, `PqAccountErrors`, and billing forwarder alarms are OK.
- Retained production smoke fixtures are labelled test-only and intentionally retained until P1B.21.

## Cutover

1. Deploy code with `LEGACY_STRIPE_RUNTIME_ENABLED` unset or `true`.
2. Verify provisioning, account billing, Lago webhook, and billing forwarder health.
3. Set `LEGACY_STRIPE_RUNTIME_ENABLED=false` in the target GitHub Environment.
4. Set `COUNTER_PERIOD_SOURCE=lago`.
5. Redeploy.
6. Invoke or observe `PqBillingCron` and `PqMonthClose`; both should return disabled summaries.
7. Send a signed low-risk Stripe webhook test event; it should return `200` with `status=retired`.
8. Run account setup or billing smoke against a repo-owned test org and verify Lago period fields.
9. Run one address API request with a test key and verify `product#period#<billingPeriodKey>` usage scope.

## Rollback

1. Set `LEGACY_STRIPE_RUNTIME_ENABLED=true`.
2. Set `COUNTER_PERIOD_SOURCE=calendar`.
3. Redeploy.
4. Manually replay Stripe events only if a real event needs recovery.

Do not delete Lago webhook ledger rows, billing action rows, Lago-period usage rows, or smoke evidence during rollback.

## Evidence To Record

- Deployed commit SHA.
- Final env values for `LEGACY_STRIPE_RUNTIME_ENABLED`, `COUNTER_PERIOD_SOURCE`, `BILLING_EVENTS_ENABLED`, and `LAGO_WEBHOOK_RECONCILIATION_ENABLED`.
- Test org/customer/subscription IDs.
- Stripe retired webhook response.
- Disabled cron/month-close summaries.
- Lago-period usage row key.
- Alarm status after deploy.
