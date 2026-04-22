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

## Verification

- confirm request-time credit enforcement works without Lago on the hot path
- confirm billing events are queued durably
- confirm worker forwards events into Lago once
- confirm replay uses the same transaction ID
