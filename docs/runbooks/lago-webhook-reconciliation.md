# Lago Webhook Reconciliation Runbook

## Current Contract

`POST /webhooks/lago` reconciles Lago subscription and invoice events into local
enforcement state. The webhook is asynchronous and must never sit on the API hot
path.

Active identity rules:

- Lago customer `external_id` is Clerk `orgId`.
- Lago subscription `external_id` is `lago_sub_${orgId}`.
- Webhook replay/idempotency is keyed by `X-Lago-Unique-Key`.
- Legacy `pq_cust_*` webhook payloads are ignored as migration evidence.

## Verification

1. Confirm `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true`.
2. Confirm Lago sends signed webhooks with the configured HMAC secret.
3. Confirm `prontiq-lago-webhook-events` records the unique key.
4. Confirm local `ORG#{orgId}` and active API key rows reflect the reconciled
   entitlement snapshot.
5. Replay the same unique key and confirm the route returns duplicate without
   mutating state again.

## After Console Plan Changes

`POST /v1/account/billing/plan-change` records replay evidence and asks Lago to
switch the subscription. The route does not update request-time enforcement directly.
After Lago emits the subscription webhook, this reconciler must project the
active or pending Lago state onto the org envelope and API-key rows.

1. Confirm Lago subscription `external_id = lago_sub_${orgId}` shows the target
   plan or a pending `next_plan`.
2. Confirm the Lago webhook ledger has a successful row for the delivery.
3. Confirm the org envelope and active API-key rows contain the expected
   `lagoPlanCode`, pending transition fields, quotas, and enforcement mode.
4. If the webhook lags or was missed, replay the Lago webhook or run
   `pnpm --filter @prontiq/control-plane lago:reconcile` for the affected org.

## Troubleshooting

- Signature failure: verify the Lago webhook secret in the target GitHub
  Environment and deployed Lambda env.
- Unknown customer: confirm Lago customer external id is `orgId`, not
  `pq_cust_*`.
- Subscription mismatch: confirm Lago subscription external id is
  `lago_sub_${orgId}`.
- Repeated errors: inspect CloudWatch logs and the webhook ledger before manual
  replay.
