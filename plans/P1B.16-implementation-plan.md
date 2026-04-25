# P1B.16 Implementation Plan

## Intent

Implement a replay-safe Lago event-forwarder worker that consumes the P1B.15 SQS
billing-event queue, records local delivery evidence, and forwards minimal usage
events to Lago with deterministic transaction IDs.

One-sentence intent: P1B.16 bridges queued `BillingUsageEventV1` records into
Lago without putting Lago on the request path or allowing retries to double-bill.

## Current State

Code:

- `packages/shared/src/billing-events.ts` defines `BillingUsageEventV1` and
  deterministic `eventId` generation.
- `packages/api/src/middleware/auth.ts` can emit billing events to SQS only when
  `BILLING_EVENTS_ENABLED=true`.
- `sst.config.ts` declares the standard source queue and DLQ from P1B.15.
- `packages/control-plane` owns commercial background workers and already uses
  node:test with DynamoDB Local for integration coverage.

Documentation:

- `ARCHITECTURE.MD` defines the Lago target, customer identity, and queue-first
  billing-event buffer.
- `ROADMAP.md` has P1B.16 scoped as the Lago event-forwarder ticket.
- `docs/runbooks/lago-billing-events.md` describes the queue and rollout gate.
- `docs/decisions/016-standard-sqs-for-billing-events.md` captures the standard
  SQS choice.
- `packages/api/HINTS.md` forbids Lago calls from the API hot path.

Live environment observations:

- Canonical Lago orgs exist: `prontiq-dev` in dev and `prontiq` in prod.
- Other Lago orgs exist for other repo/test workflows and must be left
  untouched.
- GitHub Environment secrets/vars are the deployed-stage source of truth for
  platform runtime config.

Unsupported before this ticket:

- No worker consumes the billing-event queue.
- No local delivery ledger records Lago send attempts.
- No deploy-time `LAGO_API_URL` / `LAGO_API_KEY` contract exists for the
  platform worker.

## Constraints

- API handlers must never call Lago or read `prontiq-customers` on the hot path.
- `eventId` must remain deterministic from the P1B.15 event contract.
- Lago payloads must not include raw API keys, API-key hashes, key prefixes,
  query strings, headers, IP addresses, user agents, or response bodies.
- `BILLING_EVENTS_ENABLED` remains default-off until canonical Lago setup and
  replay smoke checks pass in each environment.
- Existing non-canonical Lago orgs are out of scope and must not be mutated.
- Secrets must flow through GitHub Environment secrets/vars and `$util.secret()`,
  not committed files.

Dependencies:

- SQS source queue and DLQ from P1B.15.
- DynamoDB table creation through SST/Pulumi.
- Lago API key for canonical `prontiq-dev` / `prontiq` orgs.
- `LAGO_API_URL` for dev/prod.
- Deploy role permission for new DynamoDB tables.

## Approach

Implement an SQS Lambda in `packages/control-plane`:

- Parse and validate each SQS record as `BillingUsageEventV1`.
- Recompute the deterministic event ID and reject drift.
- Hash the full validated payload for replay-conflict detection.
- Derive `external_subscription_id` as `pq_sub_<same ulid as customerId>`.
- Record attempts and outcomes in a dedicated DynamoDB delivery ledger.
- Send a minimal Lago usage event to `/api/v1/events` with Bearer auth.
- Use SQS partial batch responses so one bad record does not block unrelated
  records in the same batch.

Chosen design:

- Dedicated delivery ledger, not `prontiq-usage`, because delivery evidence has
  a different lifecycle from request-time enforcement counters.
- Individual Lago event sends, not batch API, because SQS per-record retry
  semantics stay simpler and explicit.
- Credit delta in `properties.credits`, not raw request count, because credits
  are the public and enforcement unit.

Rejected alternatives are captured in DEC-017 through DEC-020.

## Phases

### Phase 1: Shared Contracts

Files:

- `packages/shared/src/billing-events.ts`
- `packages/shared/src/billing-events.test.ts`
- `packages/shared/src/index.ts`

Contracts:

- Add `deriveLagoExternalSubscriptionId(customerId)`.
- Preserve existing `BillingUsageEventV1` and `eventId` semantics.

Data migrations:

- None.

Feature flags:

- No flag behavior changes.

Rollout:

- Mergeable independently; does not deploy a runtime worker.

### Phase 2: Worker And Ledger

Files:

- `packages/control-plane/src/lago-event-forwarder.ts`
- `packages/control-plane/src/lago-event-forwarder.bootstrap.ts`
- `packages/control-plane/src/lago-event-forwarder.test.ts`
- `packages/control-plane/src/lago-event-forwarder.integration.test.ts`
- `packages/control-plane/package.json`

Contracts:

- Lago payload shape is minimal and credit-delta based.
- Delivery ledger statuses: `processing`, `accepted`, `failed_retryable`,
  `failed_permanent`, `invalid`.
- Ledger PK: `eventId`.
- Ledger GSI: `customerId-acceptedAt-index`.

Data migrations:

- None; new table only.

Feature flags:

- Worker is deployed regardless of `BILLING_EVENTS_ENABLED`; the producer flag
  controls live event flow.

Rollout:

- Deploy worker first with producer flag false.

### Phase 3: Infra, CI, And Environment Config

Files:

- `sst.config.ts`
- `infra/deploy-role-policy.json`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-prod.yml`
- `.env.example`

Contracts:

- New DynamoDB table `prontiq-billing-event-deliveries` or staged equivalent.
- New Lambda `PqLagoEventForwarder`.
- New alarm `PqLagoEventForwarderErrors`.
- Required deployed config: `LAGO_API_URL` var and `LAGO_API_KEY` secret.

Data migrations:

- None.

Feature flags:

- `BILLING_EVENTS_ENABLED` remains false until validation.

Rollout:

- Set GitHub env vars/secrets before deploy.
- Deploy dev, verify no unexpected queue consumption when flag is false.
- Deploy prod with the same IAM/config pattern.

### Phase 4: Documentation And Operator Runbooks

Files:

- `ARCHITECTURE.MD`
- `AGENTS.md`
- `README.md`
- `CHANGELOG.md`
- `ROADMAP.md`
- `NEXT-WORK.md`
- `NEXT-SESSION.md`
- `packages/api/HINTS.md`
- `packages/control-plane/HINTS.md`
- `docs/runbooks/lago-billing-events.md`
- `docs/runbooks/lago-customer-sync.md`
- `docs/runbooks/lago-commercial-ops.md`
- `docs/runbooks/monitoring-alerting.md`
- `packages/docs/guides/billing.mdx`
- `packages/docs/guides/credits.mdx`
- `docs/decisions/017-lago-default-subscription-id.md`
- `docs/decisions/018-lago-credit-delta-sum-metering.md`
- `docs/decisions/019-billing-event-delivery-ledger.md`
- `docs/decisions/020-lago-usage-event-minimal-payload.md`

Contracts:

- P1B.16 becomes shipped.
- P1B.17 becomes next.
- Runbooks document canonical orgs and replay smoke gating.

Data migrations:

- None.

Feature flags:

- Docs explicitly preserve the producer gate.

Rollout:

- Merge with code so future agents do not treat the forwarder as pending.

## Documentation Updates

- `ARCHITECTURE.MD`: add Lago forwarder contract, delivery ledger, payload
  shape, retry behavior, and rollout gate.
- `DEC-017`: derive Lago external subscription IDs from `customerId`.
- `DEC-018`: send Lago credit deltas and require sum aggregation.
- `DEC-019`: use a dedicated delivery ledger.
- `DEC-020`: send a minimal Lago usage payload.
- `HINTS.md`: update API and control-plane agent guardrails.
- `README.md`: update current implementation summary and progress counts.
- `CHANGELOG.md`: add P1B.16 release note.
- API / contract docs: update billing and credits public docs.
- Runbooks: update billing-event, customer-sync, commercial-ops, and monitoring
  runbooks.
- Migration notes: no schema migration, but deploy notes require GitHub env
  config and `BILLING_EVENTS_ENABLED=false` until smoke tests pass.

## Test Strategy

Unit:

- Shared derivation accepts `pq_cust_<ulid>` and rejects malformed IDs.
- Worker builds the minimal Lago payload.
- Worker normalizes Lago API URLs.
- Worker forwards valid SQS records and marks ledger accepted.
- Worker skips accepted duplicates.
- Worker rejects tampered event IDs before sending.
- Worker leaves malformed JSON and schema-invalid payloads without ledger rows,
  because event identity fields are not trustworthy until schema validation
  passes.
- Worker records only event-contract `400` and specific non-duplicate `422`
  validation failures as permanent.
- Worker treats Lago duplicate-transaction `422` responses, or ambiguous `422`
  responses confirmed by `GET /api/v1/events/{transaction_id}`, as idempotent
  success for the same deterministic `transaction_id`, covering
  post-send/pre-ledger crash replay.
- Worker records auth/setup/provider failures (`401`, `403`, `404`, `409`,
  `429`, `5xx`, ambiguous `422`, ambiguous `4xx`, network, timeout) as
  retryable so operators can fix Lago configuration and replay without DynamoDB
  surgery.
- Worker does not resend an event that already has a matching
  `failed_permanent` delivery row; it keeps the SQS record failed for DLQ and
  operator evidence instead.
- Worker keeps `failed_permanent` terminal at the ledger condition level and
  does not double-count a Lago send attempt when the failure row is recorded.
- Worker keeps delivery-ledger transitions terminal-state aware: later failure
  writes cannot downgrade accepted or `failed_permanent` rows, and later success
  writes cannot overwrite `failed_permanent` or `invalid` rows.

Integration:

- DynamoDB Local creates the delivery ledger with the customer/time GSI.
- Attempt/accepted state is idempotent.
- Same event ID with a different payload hash is rejected as a conflict.
- Permanent failures are not reopened by later record attempts, and failure
  marking does not double-count worker attempts that reached the Lago-send
  phase.
- Accepted rows are not downgraded if a duplicate worker fails after another
  worker has already marked the event accepted.
- Permanent-failure rows are not overwritten if a duplicate worker reaches Lago
  successfully and then marks the delivery accepted after the terminal local
  failure was recorded.
- Retryable auth/setup failures can be replayed successfully after operators fix
  Lago configuration.
- Replay after a Lago duplicate-transaction `422`, including an ambiguous `422`
  confirmed by `GET /api/v1/events/{transaction_id}`, marks the delivery ledger
  accepted.
- SQS batch size 3, event-source maximum concurrency 2, 10 second Lago HTTP
  timeout, and 45 second Lambda timeout keep the sequential batch within the
  Lambda deadline with at least 15 seconds of response margin while avoiding
  Lambda reserved concurrency reservations.

Contract:

- `sst.config.ts` requires `LAGO_API_URL` and `LAGO_API_KEY` in deployed stages.
- Workflows validate the same env config before deploy.

Manual:

- Confirm GitHub Environment vars/secrets exist for dev and prod.
- Deploy dev with `BILLING_EVENTS_ENABLED=false`.
- Create or use P1B.16-specific Lago smoke data without touching other orgs.
- Send one controlled event and replay it; verify one Lago accepted event and
  one accepted delivery row.

## Risk & Rollback

Failure mode: Lago rejects events because metric/subscription setup is missing.

- Rollback: keep `BILLING_EVENTS_ENABLED=false`; fix Lago setup; replay from SQS
  or DLQ after operator review. These failures remain `failed_retryable`, not
  terminal.

Failure mode: worker sends a malformed payload.

- Rollback: disable the worker by reverting the deploy or setting reserved
  concurrency to zero; preserve SQS/DLQ messages; patch payload code; replay
  retryable records after verification. Terminal `failed_permanent` rows require
  explicit operator review before remediation.

Failure mode: duplicate replay produces billing drift.

- Rollback: stop producer flag, inspect `prontiq-billing-event-deliveries`,
  compare Lago transaction IDs, and correct Lago state manually before enabling
  traffic again.

Cleanly undoable:

- Code, Lambda, alarm, and table can be reverted before producer enablement.

Not cleanly undoable:

- Once real events are sent to Lago and invoiced, remediation requires Lago
  commercial correction rather than a pure code rollback.

## Open Questions

- Confirm exact canonical Lago metric code for address usage before enabling
  the producer flag. Owner: product/operator.
- Confirm whether P1B.17 will reconcile from Lago webhooks only or also poll
  Lago for periodic consistency checks. Owner: next ticket.
- Confirm production-access SES approval timing separately; not a P1B.16 blocker.

## Estimate

- Phase 1: 0.5 day, no external blockers.
- Phase 2: 1-1.5 days, blocked only by Lago payload verification.
- Phase 3: 0.5-1 day, depends on GitHub env and deploy-role policy updates.
- Phase 4: 0.5 day, no external blockers.

## File Checklist

| Phase | File                                                                  | Code   | Docs   |
| ----- | --------------------------------------------------------------------- | ------ | ------ |
| 1     | `packages/shared/src/billing-events.ts`                               | Modify | No     |
| 1     | `packages/shared/src/billing-events.test.ts`                          | Modify | No     |
| 1     | `packages/shared/src/index.ts`                                        | Modify | No     |
| 2     | `packages/control-plane/src/lago-event-forwarder.ts`                  | Create | No     |
| 2     | `packages/control-plane/src/lago-event-forwarder.bootstrap.ts`        | Create | No     |
| 2     | `packages/control-plane/src/lago-event-forwarder.test.ts`             | Create | No     |
| 2     | `packages/control-plane/src/lago-event-forwarder.integration.test.ts` | Create | No     |
| 2     | `packages/control-plane/package.json`                                 | Modify | No     |
| 3     | `sst.config.ts`                                                       | Modify | No     |
| 3     | `infra/deploy-role-policy.json`                                       | Modify | No     |
| 3     | `.github/workflows/ci.yml`                                            | Modify | No     |
| 3     | `.github/workflows/deploy-prod.yml`                                   | Modify | No     |
| 3     | `.env.example`                                                        | Modify | Yes    |
| 4     | `ARCHITECTURE.MD`                                                     | No     | Modify |
| 4     | `AGENTS.md`                                                           | No     | Modify |
| 4     | `README.md`                                                           | No     | Modify |
| 4     | `CHANGELOG.md`                                                        | No     | Modify |
| 4     | `ROADMAP.md`                                                          | No     | Modify |
| 4     | `NEXT-WORK.md`                                                        | No     | Modify |
| 4     | `NEXT-SESSION.md`                                                     | No     | Modify |
| 4     | `packages/api/HINTS.md`                                               | No     | Modify |
| 4     | `packages/control-plane/HINTS.md`                                     | No     | Modify |
| 4     | `docs/runbooks/lago-billing-events.md`                                | No     | Modify |
| 4     | `docs/runbooks/lago-customer-sync.md`                                 | No     | Modify |
| 4     | `docs/runbooks/lago-commercial-ops.md`                                | No     | Modify |
| 4     | `docs/runbooks/monitoring-alerting.md`                                | No     | Modify |
| 4     | `packages/docs/guides/billing.mdx`                                    | No     | Modify |
| 4     | `packages/docs/guides/credits.mdx`                                    | No     | Modify |
| 4     | `docs/decisions/017-lago-default-subscription-id.md`                  | No     | Create |
| 4     | `docs/decisions/018-lago-credit-delta-sum-metering.md`                | No     | Create |
| 4     | `docs/decisions/019-billing-event-delivery-ledger.md`                 | No     | Create |
| 4     | `docs/decisions/020-lago-usage-event-minimal-payload.md`              | No     | Create |

P1B.16: 4 phases, 19 doc updates, 3 open questions.
