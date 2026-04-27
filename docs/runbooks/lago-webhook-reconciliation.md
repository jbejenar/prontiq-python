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

## Troubleshooting

- Signature failure: verify the Lago webhook secret in the target GitHub
  Environment and deployed Lambda env.
- Unknown customer: confirm Lago customer external id is `orgId`, not
  `pq_cust_*`.
- Subscription mismatch: confirm Lago subscription external id is
  `lago_sub_${orgId}`.
- Repeated errors: inspect CloudWatch logs and the webhook ledger before manual
  replay.
