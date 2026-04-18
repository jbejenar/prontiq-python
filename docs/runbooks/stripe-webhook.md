# Stripe Webhook Runbook

`POST /webhooks/stripe` is the billing-state control-plane webhook for Prontiq.

Implemented in P1B.06:
- verifies `stripe-signature`
- handles `checkout.session.completed`
- handles `customer.subscription.updated`
- handles `customer.subscription.deleted`
- logs `invoice.payment_failed`

## Required GitHub Environment Secrets / Vars

For `dev` and `prod`, set these before deploy:

- `STRIPE_WEBHOOK_SECRET` — Stripe endpoint signing secret (`whsec_...`)
- `STRIPE_SECRET_KEY` — Stripe secret API key
- `PRONTIQ_BILLING_URL` — optional account/billing-management URL used in `past_due` emails
- `WELCOME_EMAIL_FROM` — SES sender identity used for best-effort billing emails

`PRONTIQ_BILLING_URL` falls back to `PRONTIQ_ACCOUNT_URL` if it is not set, but the dedicated billing URL is preferred once the account/billing surface diverges.

The SST deploy guard now fails if either required Stripe secret is missing or whitespace-only.

## Stripe Dashboard Setup

Prontiq's Free tier is **not** a Stripe subscription product. Free is app-managed in DynamoDB and shown in the UI by Prontiq itself. Stripe should carry paid recurring plans plus family-level metered API products only.

Create one webhook endpoint per stage and subscribe to:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

Configure Billing so the grace-period model in `ARCHITECTURE.MD §5.6.3` is actually true in production:

1. Smart Retries complete within 7 days of the first failed renewal.
2. Subscription cancellation policy cancels once retries are exhausted.

Without both, `past_due` can persist indefinitely and the 14-day total grace window is false.

## Sandbox Catalog Snapshot

Current sandbox catalog aligned to the credits model:

- `Prontiq Starter Plan`
  - recurring monthly price
  - metadata: `prontiqTier=starter`, `billingModel=hybrid`, `includedCreditsPerMonth=10000`
- `Prontiq Growth Plan`
  - recurring monthly price
  - metadata: `prontiqTier=growth`, `billingModel=hybrid`, `includedCreditsPerMonth=50000`
- `Prontiq Address API`
  - metered family product
  - metadata: `prontiqProduct=address`, `billingUnit=credits`
- `Address API Credits`
  - Stripe Meter display name
  - event name remains `prontiq_address_requests`
  - payload value key remains `request_count`
  - semantically this payload is a family-level credit delta

If additional API families go live, create the same pattern again:

- one metered Stripe Product per family
- `metadata.prontiqProduct=<family>`
- one Stripe Meter with event name `prontiq_${family}_requests`
- one metered Price for that family’s credits
- matching endpoint credit weights in `packages/shared/src/constants.ts` `BILLING_ENDPOINTS`

Do not enable a new product in Stripe until the app-side billing weights exist. The auth middleware now fails closed for enabled products that do not yet have explicit endpoint credit weights.
The billing cron uses the same shared definitions to resolve Stripe meter event names, so new products must have both explicit weights and a single consistent family meter mapping before they can be enabled safely.

## Stripe Metadata Contract

Prontiq now derives billing state directly from Stripe API objects, not from repo constants or GitHub Environment vars:

- The recurring subscription Price or its Product must carry `metadata.prontiqTier` with one of `free`, `starter`, `growth`, or `enterprise`.
- Each metered Stripe Product that enables a Prontiq API product must carry `metadata.prontiqProduct`, for example `address`.
- Each metered Stripe Product should have a Stripe Meter whose event name follows `prontiq_${product}_requests` and whose payload value key is `request_count`. Despite the payload key name, the architecture source of truth now treats this value as the family-level **credit delta** sent to Stripe, not necessarily raw HTTP request count.
- The webhook expands `items.data.price.product` at runtime and rebuilds the org's enabled product set from the live Stripe subscription on every billing event.

This is what allows plan migrations and product entitlement changes to be picked up holistically from Stripe.

## Runtime Behavior

- Duplicate Stripe deliveries are harmless.
- The handler claims `WEBHOOK#stripe#{eventId}` in `prontiq-keys` as `status=processing` before side effects and finalizes it as `status=completed` only after replay-safe state writes and audit succeed.
- A duplicate delivery that lands while a fresh `processing` claim exists returns 500 `retryable_failure` so Stripe retries after the active worker finishes.
- `customer.subscription.updated` sets or clears `paymentOverdue` on all org keys.
- `past_due` email delivery is best-effort and suppression-aware. Failure to send email does not fail the webhook.

## Failure Triage

### 400 `invalid_signature`

Check:

1. Stripe endpoint is using the correct signing secret for this stage.
2. GitHub Environment secret `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard exactly.
3. The route is still `POST /webhooks/stripe`.

### 500 responses / alarm firing

Alarm: `PqStripeWebhookErrors`

Check:

1. CloudWatch logs for `PqStripeWebhook`
2. Stripe Dashboard webhook deliveries for the exact `evt_...`
3. Whether the Stripe customer is missing `metadata.orgId`
4. Whether the recurring Stripe Price or Product is missing `metadata.prontiqTier`
5. Whether the metered Stripe Products are missing or misconfigured on `metadata.prontiqProduct`
6. Whether DynamoDB writes to `prontiq-keys`, `prontiq-usage`, or `prontiq-audit` are failing

Common persistent failure:

- Stripe Dashboard metadata drift. Example: the recurring plan price/product is missing `metadata.prontiqTier`, a metered product is attached without `metadata.prontiqProduct`, or the same `prontiqProduct` is attached twice. The webhook now hard-fails all of those cases instead of skipping malformed items, so Stripe keeps retrying until the catalog is corrected.

## Verification

After deploy:

1. Send a test event from Stripe CLI or Dashboard to the stage endpoint.
2. Confirm a 2xx delivery in Stripe.
3. Confirm DynamoDB reflects the expected tier/subscription state on the org’s keys.
4. Confirm one audit row for the Stripe event.
5. Confirm duplicate replay of the same event is a no-op.
