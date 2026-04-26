# P1B.18a Implementation Plan — Lago Live Certification + Alarm Hygiene

## Intent

Certify the deployed Lago runtime in dev and prod before P1B.18 builds console
billing surfaces on top of it, and stop CloudWatch OK-state email spam from
low-traffic alarms.

One-line intent: prove canonical Lago orgs, metric/plan/customer/subscription
setup, HMAC webhook reconciliation, replay-safe usage forwarding, alert hygiene,
and rollout flags work end to end without mutating unrelated Lago orgs or
enabling Lago billing-period enforcement.

## Current State

- P1B.15 emits `BillingUsageEventV1` behind `BILLING_EVENTS_ENABLED`; default
  remains off.
- P1B.16 deploys `PqLagoEventForwarder`, SQS queues, delivery ledger, and
  queue/Lambda alarms.
- P1B.17 deploys `POST /webhooks/lago`, HMAC verification,
  `prontiq-lago-webhook-events`, reconciliation, and
  `LAGO_WEBHOOK_RECONCILIATION_ENABLED`; default remains off.
- GitHub Environments `dev` and `prod` already contain `LAGO_API_URL`,
  `LAGO_API_KEY`, and `LAGO_WEBHOOK_HMAC_SECRET`.
- Rollout vars for `BILLING_EVENTS_ENABLED`,
  `LAGO_WEBHOOK_RECONCILIATION_ENABLED`, and `COUNTER_PERIOD_SOURCE` are not set;
  SST defaults them to `false`, `false`, and `calendar`.
- Existing gap: no repo-owned helper generates a valid controlled
  `BillingUsageEventV1`; current examples exist only in tests.
- Existing alert bug: `okActions: [ingestAlerts.arn]` is configured on
  email-backed alarms, causing noisy `INSUFFICIENT_DATA -> OK` emails such as
  `PqLagoWebhookErrors`.

## Constraints

- Do not mutate unrelated Lago organizations used by other repos.
- Use canonical Lago orgs: dev `prontiq-dev`, prod `prontiq`.
- Use existing operator-held/local sensitive smoke API keys for final
  API-producer smoke; never commit, print, or paste raw keys.
- Do not add a new key-creation path in this ticket; P1C.03 owns account key
  management.
- Do not hand-build `eventId`; derive it with `deriveBillingUsageEventId`.
- Keep `COUNTER_PERIOD_SOURCE=calendar` in prod.
- Lago must not enter the API hot path.
- Replays must not double-count Lago usage.
- CloudWatch must still email on `ALARM`; routine `OK` transitions must not
  email.

## Approach

Add the missing operator tooling and alert hygiene first, then certify dev and
prod.

1. Remove email `okActions` from alarms wired to `PqIngestAlerts`; keep
   `alarmActions` and `treatMissingData: "notBreaching"`.
2. Add a control-plane smoke helper that loads safe key/customer metadata from
   DynamoDB by `SMOKE_API_KEY_HASH`, derives a valid `BillingUsageEventV1`,
   optionally sends it to SQS, and prints only non-secret evidence.
3. Use existing raw smoke API keys only for the final low-risk API request after
   controlled SQS replay passes.
4. Add separate decision records for smoke-event generation and alarm email
   action policy.

## Phases

### Phase 0 — Plan Artifact

- Create this plan file.
- No runtime behavior change.
- Revert path: delete this file.

### Phase 1 — Alert Hygiene

- Update `sst.config.ts` to remove `okActions: [ingestAlerts.arn]` from alarms
  using `PqIngestAlerts`.
- Keep `alarmActions`, thresholds, metric dimensions, and `treatMissingData`
  unchanged.
- Add a short comment near the alarm definitions: SNS email alerts are ALARM
  only; recovery is checked in CloudWatch dashboards.
- Deploy dev, then prod, and verify `PqLagoWebhookErrors` has no OK action.

### Phase 2 — Smoke Helper

- Add `packages/control-plane/src/lago-live-smoke.ts`.
- Add `packages/control-plane/src/lago-live-smoke.test.ts`.
- Add `@aws-sdk/client-sqs` to `packages/control-plane`.
- Add package script `lago:smoke:event` and include the test in the control-plane
  test script.
- Required live mode env: `STAGE`, `KEYS_TABLE_NAME`, `CUSTOMERS_TABLE_NAME`,
  `SMOKE_API_KEY_HASH`, `REQUEST_COUNT_AFTER_INCREMENT`.
- Optional env: `BILLING_EVENTS_QUEUE_URL`, `OCCURRED_AT`,
  `BILLING_ENDPOINT_KEY`, `CREDIT_DELTA`, `USAGE_SCOPE`, `SEND_TO_SQS=true`.
  `BILLING_EVENTS_QUEUE_URL` becomes required when `SEND_TO_SQS=true`.
- Behavior: read key/customer records, verify `customerId`, `keyPrefix`, active
  customer, and `lagoExternalCustomerId = customerId`; derive `eventId`; validate
  with `billingUsageEventV1Schema`; send only when `SEND_TO_SQS=true`.

### Phase 3 — Docs And Decisions

- Create `docs/decisions/025-lago-smoke-event-generation.md`.
- Create `docs/decisions/026-alarm-email-actions-alarm-only.md`.
- Update Lago runbooks with exact helper commands, queue-name mapping, replay
  instructions, alert verification, evidence template, and rollback.
- Update root docs, public billing guide, HINTS, roadmap, and handoff docs with
  the helper/alarm contract now; mark P1B.18a complete only after certification
  evidence exists.
- No public API or OpenAPI schema change.

### Phase 4 — Dev Certification

- Verify GitHub `dev` env points to `https://billing-dev.prontiq.dev` and has
  Lago secrets.
- Verify Lago org `prontiq-dev`, metric `prontiq_address_requests`, aggregation
  over `properties.credits`, plans `free` and `payg`.
- Create or reuse a repo-owned Lago smoke customer/subscription matching the
  smoke key's `customerId` and `pq_sub_<same ulid>`.
- Configure dev Lago webhook endpoint with HMAC and P1B.17 consumed events only.
- Confirm unsigned route returns `400 invalid_signature`.
- Set `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true` in GitHub env `dev`, deploy,
  send/replay one low-risk Lago event, and verify completed ledger/local state.
- With `BILLING_EVENTS_ENABLED=false`, use the helper to send and replay one
  controlled SQS event; verify Lago does not double-count.
- Set `BILLING_EVENTS_ENABLED=true` in GitHub env `dev`, deploy, send one
  low-risk address request using the existing raw smoke key, and verify one
  accepted delivery.

### Phase 5 — Prod Certification

- Repeat Phase 4 against prod with `https://billing.prontiq.dev` and Lago org
  `prontiq`.
- Keep `COUNTER_PERIOD_SOURCE=calendar`.
- Enable `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true` only after webhook
  endpoint/preflight are ready.
- Enable `BILLING_EVENTS_ENABLED=true` only after controlled SQS replay passes
  with producer off.
- Record evidence without secrets: workflow run IDs, stage, safe Lago object
  IDs, event/transaction IDs, ledger statuses, alarm action config, and alarm
  health.

## Documentation Updates

- `plans/P1B.18a-implementation-plan.md`: new committable implementation plan.
- `ARCHITECTURE.MD`: update Lago rollout status and alarm action policy after
  certification.
- `ROADMAP.md`: mark P1B.18a complete only after prod evidence; keep P1B.18
  next.
- `NEXT-WORK.md`: move current phase to P1B.18 after completion.
- `NEXT-SESSION.md`: add P1B.18a evidence, alert-hygiene fix, and next action.
- `README.md`: fix stale roadmap counts and Lago rollout status.
- `CHANGELOG.md`: add P1B.18a and alarm-hygiene entry.
- `AGENTS.md`: update rollout flag guidance for certified stages.
- `packages/docs/guides/billing.mdx`: update Lago migration note so it no
  longer says webhook reconciliation is future-only.
- `docs/decisions/025-lago-smoke-event-generation.md`: one decision,
  alternatives, consequences.
- `docs/decisions/026-alarm-email-actions-alarm-only.md`: one decision,
  alternatives, consequences.
- `docs/runbooks/lago-live-smoke.md`: helper commands, replay, evidence,
  rollback.
- `docs/runbooks/lago-billing-events.md`: helper-based replay smoke reference.
- `docs/runbooks/monitoring-alerting.md`: ALARM-only email policy and manual
  drill update.
- `packages/api/HINTS.md`: `BILLING_EVENTS_ENABLED` may be true only after stage
  certification.
- `packages/control-plane/HINTS.md`: smoke helper must not touch unrelated Lago
  orgs or hand-build event IDs.

## Test Strategy

- Unit: smoke helper derives deterministic `eventId`, validates schema, rejects
  malformed customer/key/customer-row state, and omits secret fields.
- Unit: helper does not send to SQS unless `SEND_TO_SQS=true`.
- Static: grep or test confirms no `okActions: [ingestAlerts.arn]` remain in
  `sst.config.ts`.
- Manual dev/prod webhook: unsigned route returns `400 invalid_signature`;
  signed Lago event completes ledger.
- Manual dev/prod forwarder: controlled SQS event reaches
  `prontiq-billing-event-deliveries.status=accepted`.
- Manual dev/prod replay: same event keeps same `transaction_id` and does not
  double-count Lago usage.
- Manual dev/prod producer: after `BILLING_EVENTS_ENABLED=true`, one low-risk
  address request queues and forwards exactly one accepted event.
- Manual alert verification: `PqLagoWebhookErrors` and other touched alarms have
  ALARM action only; no OK-state email arrives after deploy.
- Full validation: `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- Optional if DynamoDB Local is available:
  `pnpm --filter @prontiq/control-plane test:integration`.

## Risk & Rollback

- Bad Lago metric/plan/subscription causes delivery failures: set
  `BILLING_EVENTS_ENABLED=false`, fix Lago setup, replay preserved SQS/DLQ
  evidence.
- Wrong webhook HMAC or event set causes retries: set
  `LAGO_WEBHOOK_RECONCILIATION_ENABLED=false`, fix Lago endpoint/secret, replay
  from Lago.
- Producer enabled before replay safety: set `BILLING_EVENTS_ENABLED=false`; do
  not delete ledger or queue evidence.
- Removing OK emails hides recovery notifications: restore `okActions` only on
  selected alarms in a follow-up; ALARM notifications remain intact.
- Lago smoke objects/usage events cannot be erased cleanly from provider
  history; name them clearly as repo-owned smoke evidence.

## Open Questions

None. The smoke API key source is locked: use existing operator-held/local
sensitive smoke key material and do not create a new key-management path in
P1B.18a.

## Closeout Audit — 2026-04-26

P1B.18a must remain open after the current audit. The usage-forwarding half has
safe evidence: dev and prod both have accepted delivery-ledger rows, empty
billing source queues/DLQs, healthy Lago alarms, and inventoried repo-owned
test-only smoke fixtures. The webhook half is not certified:
`LAGO_WEBHOOK_RECONCILIATION_ENABLED=false` is still deployed in both
`PqLagoWebhook` Lambdas, and both `prontiq-lago-webhook-events-dev` and
`prontiq-lago-webhook-events` have zero completed rows.

The next execution step is not P1B.18 implementation. It is to configure or
confirm the Lago HMAC webhook endpoints, enable
`LAGO_WEBHOOK_RECONCILIATION_ENABLED=true` through GitHub Environment deploys,
send one valid low-risk webhook smoke event per stage, and record completed
ledger rows without exposing webhook secrets or raw key material.

## Estimate

- Phase 0: 0.25 day.
- Phase 1: 0.25-0.5 day.
- Phase 2: 0.5 day.
- Phase 3: 0.5 day.
- Phase 4: 0.5-1 day.
- Phase 5: 0.5-1 day.

## File Checklist

| Phase | File                                                   | Doc Update    |
| ----- | ------------------------------------------------------ | ------------- |
| 0     | `plans/P1B.18a-implementation-plan.md`                 | Yes           |
| 1     | `sst.config.ts`                                        | No            |
| 1     | `docs/runbooks/monitoring-alerting.md`                 | Yes           |
| 2     | `packages/control-plane/src/lago-live-smoke.ts`        | No            |
| 2     | `packages/control-plane/src/lago-live-smoke.test.ts`   | No            |
| 2     | `packages/control-plane/package.json`                  | No            |
| 2     | `pnpm-lock.yaml`                                       | No            |
| 3     | `docs/decisions/025-lago-smoke-event-generation.md`    | Yes           |
| 3     | `docs/decisions/026-alarm-email-actions-alarm-only.md` | Yes           |
| 3     | `docs/runbooks/lago-live-smoke.md`                     | Yes           |
| 3     | `docs/runbooks/lago-billing-events.md`                 | Yes           |
| 3     | `ARCHITECTURE.MD`                                      | Yes           |
| 3     | `README.md`                                            | Yes           |
| 3     | `CHANGELOG.md`                                         | Yes           |
| 3     | `AGENTS.md`                                            | Yes           |
| 3     | `packages/docs/guides/billing.mdx`                     | Yes           |
| 3     | `packages/api/HINTS.md`                                | Yes           |
| 3     | `packages/control-plane/HINTS.md`                      | Yes           |
| 4     | GitHub Environment `dev` vars and Lago dev config      | Evidence only |
| 5     | GitHub Environment `prod` vars and Lago prod config    | Evidence only |
| 5     | `ROADMAP.md`, `NEXT-WORK.md`, `NEXT-SESSION.md`        | Yes           |

P1B.18a: 6 phases, 16 doc updates, 0 open questions.
