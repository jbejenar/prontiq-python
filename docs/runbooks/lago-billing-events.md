# Lago Billing Event Forwarding Runbook

Target-state operator guidance for billing-event forwarding into Lago.

## Purpose

The target architecture emits billing events from Prontiq into a durable queue,
then forwards them to Lago asynchronously.

## Scope

This runbook documents the **target Lago billing-event path**:

- Prontiq hot path emits billing events
- SQS buffers them
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

## Verification

- confirm request-time credit enforcement works without Lago on the hot path
- confirm queued events contain `customerId`
- confirm billing events are queued durably
- confirm worker forwards events into Lago once
- confirm replay uses the same transaction ID
