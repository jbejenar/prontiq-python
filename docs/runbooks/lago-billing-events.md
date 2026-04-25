# Lago Billing Event Forwarding Runbook

Operator guidance for the platform billing-event buffer and target Lago
forwarding path.

## Purpose

The architecture emits billing events from Prontiq into a durable SQS queue,
then forwards them to Lago asynchronously. `P1B.15` implements the queue and
API producer; `P1B.16` implements the Lago consumer.

## Scope

This runbook documents the **target Lago billing-event path**:

- Prontiq hot path emits billing events when `BILLING_EVENTS_ENABLED=true`
- SQS buffers them in `prontiq-billing-events` / `prontiq-billing-events-<stage>`
- DLQ is `prontiq-billing-events-dlq` / `prontiq-billing-events-dlq-<stage>`
- worker forwards them to Lago with deterministic transaction IDs in P1B.16

## Customer identity requirement

Every queued billing event must carry the P1B.14 `customerId`.

The API hot path must obtain that value from the existing `prontiq-keys` read.
It must not perform an additional `prontiq-customers` read before responding to
the API request. Runtime implementation tickets therefore need to denormalize
`customerId` onto API key records before enabling event emission.

Lago forwarding uses `customerId` as the Lago customer `external_id`. It must not
use `orgId`, `stripeCustomerId`, or Lago `lago_id` as the billing-event customer
identity.

## Event contract

The producer emits `BillingUsageEventV1` after DynamoDB usage enforcement
succeeds. Required fields include:

- deterministic `eventId`
- `customerId`, `orgId`, `apiKeyHash`, and `keyPrefix`
- product, billing endpoint key, meter event name, and credit delta
- usage scope and cumulative request count after increment
- source request id, method, path without query string, and stage

Never include raw API keys, request headers, IP addresses, user agents, query
strings, or response payloads.

## Queue failure semantics

When event emission is enabled:

1. API key auth, product gating, burst limiting, and quota enforcement run first.
2. If enforcement fails, no billing event is queued.
3. If enforcement succeeds, the API writes the event to SQS before invoking the
   route handler.
4. If SQS write fails, the handler returns `500 INTERNAL_ERROR` after the local
   usage increment and logs repair context.

Do not purge source or DLQ messages without operator approval; once event
emission is enabled they are billing evidence.

## Backfill and rollout

Before setting `BILLING_EVENTS_ENABLED=true` in a deployed stage:

1. deploy the `prontiq-customers` table and billing queues
2. run `CUSTOMERS_TABLE_NAME=<table> KEYS_TABLE_NAME=<table> pnpm --filter @prontiq/control-plane backfill:customers`
3. inspect dry-run output for conflicts
4. resolve `migration_conflict` customers manually
5. run `CUSTOMERS_TABLE_NAME=<table> KEYS_TABLE_NAME=<table> pnpm --filter @prontiq/control-plane backfill:customers -- --apply`
6. verify every active API key has `customerId`
7. enable `BILLING_EVENTS_ENABLED=true` and redeploy

## Verification

- confirm request-time credit enforcement works without Lago on the hot path
- confirm queued events contain `customerId`
- confirm billing events are queued durably
- confirm DLQ visible-message alarm and source queue oldest-age alarm exist
- confirm worker forwards events into Lago once
- confirm replay uses the same transaction ID
