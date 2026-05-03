# Lago Live Smoke Runbook

## Current Contract

P1B.22 changed the live smoke helper to the active commercial identity model:

- Clerk `orgId` is the active Prontiq and Lago customer identity.
- Lago customer `external_id = orgId`.
- Lago subscription `external_id = lago_sub_${orgId}`.
- The helper emits `BillingUsageEventV2` with `orgId`.
- The helper reads `prontiq-keys` only. It must not require `prontiq-customers`.

Legacy `BillingUsageEventV1`, `pq_cust_*`, `pq_sub_*`, and
`CUSTOMERS_TABLE_NAME` references are historical P1B.14-P1B.21 evidence only.

This helper is `runbook-on-demand`, not `ci-every-deploy`. P1F.04 deploy smoke
uses the public Address API smoke instead. Do not wire `lago:smoke:event` into
every deploy because it intentionally creates billing delivery evidence.

## Preconditions

- A labelled test org exists in Clerk and Lago.
- The test org has an active API key row in `prontiq-keys`.
- The matching `ORG#{orgId}` envelope exists in `prontiq-keys`.
- `BILLING_EVENTS_ENABLED=true` in the target stage when sending to SQS.
- The source queue and DLQ are empty before the smoke.

## Dry Run

```bash
KEYS_TABLE_NAME=prontiq-keys-dev \
SMOKE_API_KEY_HASH=<api-key-hash> \
REQUEST_COUNT_AFTER_INCREMENT=1 \
STAGE=dev \
pnpm --filter @prontiq/control-plane lago:smoke:event
```

Expected evidence includes `orgId`, `eventId`, `externalSubscriptionId`,
`keyPrefix`, `meterEventName`, `stage`, and `sentToSqs=false`.

## Send To SQS

```bash
KEYS_TABLE_NAME=prontiq-keys-dev \
BILLING_EVENTS_QUEUE_URL=<source-queue-url> \
SMOKE_API_KEY_HASH=<api-key-hash> \
REQUEST_COUNT_AFTER_INCREMENT=1 \
SEND_TO_SQS=true \
STAGE=dev \
pnpm --filter @prontiq/control-plane lago:smoke:event
```

## Verification

- `prontiq-billing-event-deliveries` has an accepted row for the printed
  `eventId`.
- The delivery row records `orgId`.
- Lago has a usage event with `transaction_id = eventId`.
- Lago subscription external ID is `lago_sub_${orgId}`.
- Source queue and DLQ drain to zero.
- No relevant CloudWatch alarm is in `ALARM`.

## Safety Rules

- Do not hand-build transaction IDs.
- Do not reuse retired prod smoke keys.
- Do not use another repository's test org.
- Do not print raw API keys, HMAC secrets, or Lago API keys.
