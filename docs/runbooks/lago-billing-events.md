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
- worker forwards them to Lago with deterministic transaction IDs

## Customer identity requirement

Every queued billing event must carry the P1B.14 `customerId`.

The API hot path must obtain that value from the existing `prontiq-keys` read.
It must not perform an additional `prontiq-customers` read before responding to
the API request. Runtime implementation tickets therefore need to denormalize
`customerId` onto API key records before enabling event emission.

Lago forwarding uses `customerId` as the Lago customer `external_id`. It must not
use `orgId`, `stripeCustomerId`, or Lago `lago_id` as the billing-event customer
identity.

The worker derives the Lago subscription external ID from the same customer ULID:

```text
pq_cust_<ulid> -> pq_sub_<ulid>
```

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

## Worker behavior

`PqLagoEventForwarder` consumes SQS batches with partial batch responses. For
each record it:

1. parses and validates `BillingUsageEventV1`
2. recomputes the deterministic `eventId`
3. records a delivery attempt in `prontiq-billing-event-deliveries` for
   schema-valid events
4. sends a minimal usage event to Lago at `/api/v1/events`
5. marks the delivery row accepted only after Lago returns success

If Lago returns an event-contract rejection (`400` or a specific non-duplicate
`422` validation error such as invalid metric, subscription, properties,
timestamp, or transaction fields), the worker records `failed_permanent`, leaves
the SQS record failed for DLQ/evidence handling, and does not call Lago again on
later redeliveries of the same event hash. Preserve the DLQ record and fix the
event contract before any manual remediation.

If Lago returns `422` because the same `transaction_id` was already received,
the worker treats that response as idempotent success and marks the local ledger
accepted. This covers the replay case where Lago accepted the original request
but the Lambda crashed or timed out before `markAccepted`. If the `422` body is
ambiguous, the worker calls `GET /api/v1/events/{transaction_id}` and only marks
the row accepted when Lago confirms the same transaction and external
subscription. Unconfirmed ambiguous `422` responses stay retryable rather than
becoming permanent local failure evidence.

If Lago returns a recoverable auth/setup/provider failure (`401`, `403`, `404`,
`409`, `429`, `5xx`, ambiguous `422`, another ambiguous `4xx`, or a
network/timeout failure), the worker records `failed_retryable` and leaves the
SQS record failed. After fixing the Lago API key, organization, metric,
customer, or subscription setup, replay the source/DLQ message normally; the
matching retryable ledger row does not block the resend.

The worker processes batches sequentially with a 10 second Lago HTTP timeout,
SQS batch size 3, event-source maximum concurrency 2, and Lambda timeout 45
seconds. Keep that invariant unless the worker is redesigned for bounded
concurrency: `3 * 10s` leaves at least 15 seconds for DynamoDB writes, logging,
and partial batch response before the Lambda deadline. The concurrency cap is on
the SQS event source mapping, not Lambda reserved concurrency, so deploys do not
consume the account's required unreserved concurrency floor.
`attempts` counts worker attempts that reached the Lago-send phase; marking a
failed send does not increment it a second time. Treat it as local worker
evidence, not as a provider-side accepted-event counter.
Delivery-ledger transitions are terminal-state aware: later failure writes do
not downgrade `accepted` or `failed_permanent`, and later success writes do not
overwrite `failed_permanent` or `invalid`. If a duplicate worker sends to Lago
successfully after another worker has already recorded a terminal local
rejection, the worker preserves the terminal row and acknowledges the SQS record
to avoid a retry loop; operators must reconcile the local evidence against Lago
before replaying related DLQ records.

Lago payload:

```json
{
  "event": {
    "transaction_id": "bevt_...",
    "external_subscription_id": "pq_sub_...",
    "code": "prontiq_address_requests",
    "timestamp": 1777075200,
    "properties": {
      "credits": 3
    }
  }
}
```

The worker never sends raw API keys, API-key hashes, key prefixes, query
strings, request headers, IP addresses, user agents, or response payloads to
Lago.

## Backfill and rollout

For full P1B.18a live certification, use
`docs/runbooks/lago-live-smoke.md`. For production go-live cleanup after
certification, use `docs/runbooks/prod-go-live-cleanup.md`. The checklist below
remains the forwarder-specific portion.

Before setting `BILLING_EVENTS_ENABLED=true` in a deployed stage:

1. deploy the `prontiq-customers` table and billing queues
2. run `CUSTOMERS_TABLE_NAME=<table> KEYS_TABLE_NAME=<table> pnpm --filter @prontiq/control-plane backfill:customers`
3. inspect dry-run output for conflicts
4. resolve `migration_conflict` customers manually
5. run `CUSTOMERS_TABLE_NAME=<table> KEYS_TABLE_NAME=<table> pnpm --filter @prontiq/control-plane backfill:customers -- --apply`
6. verify every active API key has `customerId`
7. deploy `PqLagoEventForwarder` with `LAGO_API_URL` and `LAGO_API_KEY`
8. verify the canonical Lago organization exists for the environment
   (`prontiq-dev` in dev, `prontiq` in prod)
9. verify the Lago billable metric code matches `meterEventName` and sums
   `properties.credits`
10. verify the Lago customer and subscription external IDs match
    `pq_cust_<ulid>` and `pq_sub_<ulid>`
11. run a replay smoke check with
    `pnpm --filter @prontiq/control-plane lago:smoke:event` and prove the
    second replay does not double-count
12. configure Lago webhook reconciliation per
    `docs/runbooks/lago-webhook-reconciliation.md`
13. keep `COUNTER_PERIOD_SOURCE=calendar` until webhook reconciliation has
    populated billing-period fields
14. enable `BILLING_EVENTS_ENABLED=true` and redeploy

## Verification

- confirm request-time credit enforcement works without Lago on the hot path
- confirm queued events contain `customerId`
- confirm billing events are queued durably
- confirm DLQ visible-message alarm and source queue oldest-age alarm exist
- confirm worker forwards events into Lago once
- confirm replay uses the same transaction ID
- confirm malformed JSON/schema-invalid payloads fail to the source queue/DLQ
  without ledger rows, while schema-valid deterministic-ID mismatches create
  `invalid` ledger evidence
- confirm `PqLagoEventForwarderErrors` is alarmed for worker crashes
- confirm `PqLagoWebhookErrors` is alarmed for inbound reconciliation failures
- confirm source queue age and DLQ alarms are the primary signal for per-record
  Lago delivery failures
- confirm accepted rows appear in `prontiq-billing-event-deliveries`
- confirm `401` or `403` from a deliberately bad Lago API key records
  `failed_retryable`, then succeeds after restoring the key and replaying the
  same message
- confirm replay after a simulated Lago duplicate-transaction `422` marks the
  delivery ledger `accepted`
- confirm replay after an ambiguous `422` plus successful
  `GET /api/v1/events/{transaction_id}` confirmation marks the delivery ledger
  `accepted`

## Controlled Smoke Event Helper

P1B.18a adds a control-plane helper for stage certification:

```bash
STAGE=<dev|prod> \
KEYS_TABLE_NAME=<keys-table> \
CUSTOMERS_TABLE_NAME=<customers-table> \
BILLING_EVENTS_QUEUE_URL=<billing-events-queue-url> \
SMOKE_API_KEY_HASH=<sha256-hash-only> \
REQUEST_COUNT_AFTER_INCREMENT=<next-count> \
SEND_TO_SQS=true \
pnpm --filter @prontiq/control-plane lago:smoke:event
```

The helper validates that the smoke key is active, has `customerId`, points to an
active customer row, and that `lagoExternalCustomerId = customerId`. It derives
the production `eventId` and derived Lago subscription external ID; do not
replace it with hand-built JSON during certification.

Use the actual stage table names. Dev names are suffixed, for example
`prontiq-keys-dev` and `prontiq-customers-dev`; prod names are unsuffixed, for
example `prontiq-keys` and `prontiq-customers`.
