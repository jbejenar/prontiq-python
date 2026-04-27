# Lago Billing Events Runbook

## Current Contract

The address API emits billing events only after DynamoDB usage enforcement
succeeds. Events go to SQS; request handlers must not call Lago directly.

Active event shape:

- `version = 2`
- `orgId = Clerk organization id`
- `eventId = deterministic bevt_* derived from orgId, api key hash, endpoint,
  credit delta, usage scope, and post-increment count`
- `lago external_subscription_id = lago_sub_${orgId}`
- Minimal Lago payload: transaction id, subscription id, metric code,
  timestamp, and credit count

The worker may not forward API-key hashes, prefixes, request URLs, headers,
IP addresses, user agents, query strings, or response payloads to Lago.

## Operational Checks

1. Confirm `BILLING_EVENTS_ENABLED=true`.
2. Confirm active API key rows have `orgId` and `lagoSubscriptionExternalId`.
3. Generate traffic through the normal address API or the live smoke helper.
4. Confirm the source SQS queue drains.
5. Confirm `prontiq-billing-event-deliveries` records accepted delivery.
6. Confirm Lago shows the usage event on `lago_sub_${orgId}`.

## Replay

Replay only from recorded delivery/queue evidence. Preserve the original
`eventId`; it is the Lago `transaction_id` and idempotency key.

## Failure Handling

- If SQS has visible messages, inspect the worker logs before replaying.
- If the DLQ has messages, inspect the payload schema and event-id derivation.
- If Lago rejects an event because the subscription is missing, run the
  commercial identity repair dry-run, then apply only after confirming the org.
- If the API hot path fails before usage is incremented, no billing event should
  exist.
