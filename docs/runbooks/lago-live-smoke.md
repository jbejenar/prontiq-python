# Lago Live Smoke Certification Runbook

Operator checklist for P1B.18a. This runbook proves the deployed Lago runtime
is actually wired to the canonical Lago environments before downstream Lago
migration tickets rely on it.

## Scope

Use this runbook after P1B.16 and P1B.17 are deployed in the target stage.

This runbook owns:

- canonical Lago org verification
- billable metric and plan-code verification
- smoke customer/subscription setup
- Lago HMAC webhook endpoint setup
- repo-owned billing-event smoke generation
- usage-event replay smoke checks
- CloudWatch alarm email-noise verification
- rollout flag enablement evidence

It does not replace:

- `docs/runbooks/lago-billing-events.md` for worker internals and replay
  semantics
- `docs/runbooks/lago-webhook-reconciliation.md` for webhook drift handling
- `docs/runbooks/prod-go-live-cleanup.md` for final production smoke-fixture
  retirement after P1B.20
- P1B.18 console billing proxy/API contract work
- P1B.19 Stripe legacy retirement

## Safety Rules

- Do not mutate unrelated Lago organizations used by other repos.
- Use canonical org `prontiq-dev` for dev and `prontiq` for prod.
- If isolation is required, create a repo-owned smoke customer/subscription, or
  a clearly named repo-owned test org for this repo only.
- Do not commit or paste Lago API keys, webhook secrets, raw API keys, private
  customer emails, or local secret files.
- Keep prod `COUNTER_PERIOD_SOURCE=calendar` unless a later cutover decision
  explicitly approves Lago billing-period scopes.

## Environment Preconditions

For the target GitHub Environment:

- `LAGO_API_URL` points at the correct Lago base URL.
- `LAGO_API_KEY` exists as a secret.
- `LAGO_WEBHOOK_HMAC_SECRET` exists as a secret.
- `BILLING_EVENTS_ENABLED` is unset or `false` before forwarder smoke.
- `LAGO_WEBHOOK_RECONCILIATION_ENABLED` is unset or `false` before unsigned
  route preflight.
- `COUNTER_PERIOD_SOURCE` is unset or `calendar` before billing-period cutover.

## Repo-Owned Smoke Helper

Use the control-plane helper for controlled usage-event smoke. It reads an
existing smoke API-key row and matching customer row from DynamoDB, validates
the P1B.14 identity contract, derives `eventId` through the production
`BillingUsageEventV1` contract, and prints only non-secret evidence.

Required inputs:

- `STAGE`
- `KEYS_TABLE_NAME`
- `CUSTOMERS_TABLE_NAME`
- `SMOKE_API_KEY_HASH`
- `REQUEST_COUNT_AFTER_INCREMENT`

Optional inputs:

- `BILLING_EVENTS_QUEUE_URL`
- `SEND_TO_SQS=true`
- `OCCURRED_AT`
- `PRODUCT`
- `BILLING_ENDPOINT_KEY`
- `CREDIT_DELTA`
- `USAGE_SCOPE`
- `SOURCE_REQUEST_ID`
- `SOURCE_METHOD`
- `SOURCE_PATH`

Dry-run the event without writing to SQS:

```bash
STAGE=dev \
KEYS_TABLE_NAME=prontiq-keys-dev \
CUSTOMERS_TABLE_NAME=prontiq-customers-dev \
SMOKE_API_KEY_HASH=<sha256-hash-only> \
REQUEST_COUNT_AFTER_INCREMENT=<next-count> \
pnpm --filter @prontiq/control-plane lago:smoke:event
```

Use the real deployed table names for the target stage. Dev names are suffixed,
for example `prontiq-keys-dev` and `prontiq-customers-dev`; prod names are
unsuffixed, for example `prontiq-keys` and `prontiq-customers`.

Send the same controlled event to the stage billing-event queue:

```bash
STAGE=dev \
KEYS_TABLE_NAME=prontiq-keys-dev \
CUSTOMERS_TABLE_NAME=prontiq-customers-dev \
BILLING_EVENTS_QUEUE_URL=<billing-events-queue-url> \
SMOKE_API_KEY_HASH=<sha256-hash-only> \
REQUEST_COUNT_AFTER_INCREMENT=<next-count> \
SEND_TO_SQS=true \
pnpm --filter @prontiq/control-plane lago:smoke:event
```

The command output is a safe evidence object with `customerId`, `eventId`,
derived `externalSubscriptionId`, key prefix, meter code, org id, stage, and
whether the event was sent to SQS. It deliberately does not print the API-key
hash or raw key material. Paste only this evidence object and
CloudWatch/DynamoDB/Lago identifiers that are safe to share.

## Lago Preconditions

Verify in Lago before enabling platform flags:

1. Canonical org exists:
   - dev: `prontiq-dev`
   - prod: `prontiq`
2. Metric exists:
   - code: `prontiq_address_requests`
   - aggregation: sum of `properties.credits`
3. Plan codes match platform tiers used by smoke:
   - `free`
   - `payg`
4. Smoke customer exists with:
   - `external_id = pq_cust_<ulid>`
5. Smoke subscription exists with:
   - `external_id = pq_sub_<same ulid>`
   - customer external id matching the smoke customer
   - a plan code matching a platform tier

## Webhook Smoke

1. Confirm unsigned route behavior:

   ```bash
   curl -i -X POST "$PRONTIQ_API/webhooks/lago" \
     -H 'content-type: application/json' \
     --data '{"webhook_type":"subscription.started"}'
   ```

   Expected: `400 {"error":"invalid_signature"}`.

2. Configure the Lago webhook endpoint:
   - URL: `$PRONTIQ_API/webhooks/lago`
   - signature algorithm: HMAC
   - secret: the same value as `LAGO_WEBHOOK_HMAC_SECRET`
   - subscribed events:
     - `subscription.started`
     - `subscription.terminated`
     - `invoice.created`
     - `invoice.payment_overdue`
     - `invoice.payment_status_updated`

3. Set `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true` for the target GitHub
   Environment and redeploy that stage. This must happen before a valid
   webhook can complete; otherwise the handler deliberately returns retryable
   `503` after signature verification.

4. Send or replay one low-risk smoke event from Lago.

5. Verify:
   - `prontiq-lago-webhook-events.status = completed`
   - matching `prontiq-keys` org/key rows have Lago plan, subscription, and
     billing-period fields
   - replaying the same Lago delivery does not create duplicate mutations
   - `PqLagoWebhookErrors` remains healthy after smoke

## Usage Forwarder Smoke

1. Confirm the target API key row has `customerId`.

2. Confirm the matching `prontiq-customers` row is active and has
   `lagoExternalCustomerId = customerId`.

3. Keep `BILLING_EVENTS_ENABLED=false` and inject one controlled smoke
   `BillingUsageEventV1` into the billing-event source queue with
   `pnpm --filter @prontiq/control-plane lago:smoke:event` and
   `SEND_TO_SQS=true`. The API producer must remain off for this first
   forwarder replay proof.

   Do not hand-build `eventId`; Lago deduplication depends on that value being
   identical to the forwarder `transaction_id` on replay.

4. Verify:
   - `prontiq-billing-event-deliveries.status = accepted`
   - Lago records one usage event with `transaction_id = eventId`
   - Lago usage increments by exactly `properties.credits`

5. Replay the same billing event through the approved replay path.

6. Verify replay safety:
   - same `transaction_id`
   - no double-count in Lago
   - local delivery ledger remains terminal `accepted`
   - source queue age and DLQ visible-message alarms remain healthy
   - `PqLagoEventForwarderErrors` remains healthy

7. Enable `BILLING_EVENTS_ENABLED=true` for the target GitHub Environment and
   redeploy that stage.

8. Send one low-risk address API request using the smoke API key.

9. Verify:
   - request succeeds through local DynamoDB enforcement
   - queued billing event contains the smoke `customerId`
   - the resulting delivery ledger row is `accepted`
   - Lago records exactly one new usage event for the new request

## Prod Rollout Posture

Prod may enable:

- `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true` after unsigned-route preflight and
  Lago endpoint configuration are ready, with valid webhook smoke completed
  immediately after enablement
- `BILLING_EVENTS_ENABLED=true` after controlled forwarder replay smoke passes
  with the API producer still off

Prod should keep:

- `COUNTER_PERIOD_SOURCE=calendar`

until P1B.19 or a separate explicit cutover decision approves Lago
billing-period enforcement scopes.

## Evidence To Record

Record these in PR/session notes without secrets:

- GitHub workflow run IDs for deploys after flag changes
- stage tested (`dev` or `prod`)
- canonical Lago org name
- safe Lago smoke customer/subscription identifiers
- smoke event ID / transaction ID
- DynamoDB ledger table and terminal status
- CloudWatch alarm health summary
- CloudWatch alarm-action check showing email-backed operational alarms publish
  on `ALARM` only, not `OK`
- explicit statement that no unrelated Lago orgs were mutated

## Alert Email Hygiene

Email-backed `PqIngestAlerts` alarms must notify on `ALARM` only. CloudWatch
still records `OK` and `INSUFFICIENT_DATA` transitions, but OK-state emails are
noise for low-traffic webhook routes where missing data is treated as
non-breaching.

After the P1B.18a deploy, verify:

```bash
aws cloudwatch describe-alarms \
  --alarm-names PqLagoWebhookErrors-<suffix> PqLagoEventForwarderErrors-<suffix> \
  --region ap-southeast-2 \
  --query 'MetricAlarms[].{AlarmName:AlarmName,AlarmActions:AlarmActions,OKActions:OKActions,InsufficientDataActions:InsufficientDataActions}'
```

Expected:

- `AlarmActions` contains the `PqIngestAlerts` topic ARN
- `OKActions` is empty
- `InsufficientDataActions` is empty

When manually drilling an alarm, confirm the ALARM email arrives, then verify
the return to OK in CloudWatch rather than expecting a recovery email.

## Rollback

- Set `BILLING_EVENTS_ENABLED=false` and redeploy to stop new usage-event
  emission.
- Set `LAGO_WEBHOOK_RECONCILIATION_ENABLED=false` and redeploy to make valid
  Lago deliveries return retryable 503 before ledger claim.
- Keep `COUNTER_PERIOD_SOURCE=calendar` or restore it and redeploy if it was
  enabled too early.
- Do not delete `prontiq-billing-event-deliveries` or
  `prontiq-lago-webhook-events` rows; they are replay and drift evidence.

## After Certification

P1B.18a proves the integration works and governs retained smoke fixtures as
test-only data. Keep repo-owned production smoke fixtures available for P1B.18,
P1B.19, and P1B.20 unless they become unsafe or ambiguous. Final retirement,
disablement, relabelling, or explicit retention belongs to
`docs/runbooks/prod-go-live-cleanup.md` in P1B.21 after P1B.20.

## Current Certification Evidence

The 2026-04-26 audit closed P1B.18a. Safe evidence exists for usage forwarding,
webhook reconciliation, replay safety, fixture governance, and alarm health.

Confirmed safe evidence:

- dev and prod have API-produced Lago billing-event delivery rows with
  `status=accepted`
- dev and prod billing source queues and DLQs were empty at audit time
- Lago CloudWatch alarms were `OK`
- email-backed Lago alarm actions were ALARM-only
- smoke fixtures are inventoried as test-only data:
  - dev: `org_prontiq_platform_lago_smoke_dev`,
    `pq_cust_01KQ3T50Z86ZKEFG8Y7N68V3QP`,
    `pq_sub_01KQ3T50Z86ZKEFG8Y7N68V3QP`, key prefix `pq_live_0665`
  - prod: `org_prontiq_platform_lago_smoke_prod`,
    `pq_cust_01KQ3TT9XZZDR2CAZTV1TX1KBS`,
    `pq_sub_01KQ3TT9XZZDR2CAZTV1TX1KBS`, key prefix `pq_live_4a85`

Webhook evidence:

- `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true` is configured for dev and prod
  GitHub Environments and deployed Lago webhook Lambdas
- dev unsigned route preflight returned `400 invalid_signature`
- prod unsigned route preflight returned `400 invalid_signature`
- dev signed unique key `prontiq-platform-dev-smoke-20260426T051602Z`
  completed in `prontiq-lago-webhook-events-dev`
- prod signed unique key `prontiq-platform-prod-smoke-20260426T051812Z`
  completed in `prontiq-lago-webhook-events`
- replaying both signed unique keys returned `200 duplicate`
- dev/prod smoke envelope and key rows reconciled to Lago `payg`, active
  subscription status, and `billingPeriodKey=2026-04-26_2026-05-25`

Continue to avoid pasting or committing raw API keys, API-key hashes, Lago API
keys, webhook HMAC secrets, or local ignored evidence files.
