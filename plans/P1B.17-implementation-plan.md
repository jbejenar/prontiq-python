# P1B.17 Implementation Plan

## Intent

Reconcile Lago subscription and invoice events back into Prontiq local
enforcement state without putting Lago on the API hot path.

One-line intent: consume a small, explicit Lago webhook event set, update local
plan/payment/billing-period fields idempotently, and keep `prontiq-usage` as the
request-time enforcement store.

## Current State

- `P1B.14` defines platform-owned `customerId = pq_cust_<ulid>`.
- `P1B.15` emits `BillingUsageEventV1` to SQS behind `BILLING_EVENTS_ENABLED`.
- `P1B.16` forwards queued usage events to Lago with deterministic transaction
  ids and delivery evidence.
- No inbound Lago webhook existed before this ticket.
- API auth increments local DynamoDB counters and must not call Lago.

## Constraints

- Lago is commercial truth; DynamoDB remains enforcement truth.
- Webhook processing must be idempotent by Lago `X-Lago-Unique-Key`.
- Same unique key with a different payload hash is drift, not a valid replay.
- PAYG is uncapped but tracked.
- Free remains hard-capped.
- `COUNTER_PERIOD_SOURCE=calendar` is the safe default.
- Secrets stay in GitHub Environment secrets and are wrapped with
  `$util.secret()` in SST.

## Approach

Implement a transport adapter in `@prontiq/webhooks`, a reconciliation service in
`@prontiq/control-plane`, shared Lago webhook types in `@prontiq/shared`, a
dedicated DynamoDB ledger, and documentation/runbook/ADR updates.

## Phases

### Phase 1: Shared Contracts

- Add shared Lago webhook event constants, processing statuses, ledger shape,
  and stable payload hashing.
- Add Lago reconciliation fields to key/envelope record types.
- Add plan enforcement mode so PAYG can be uncapped but tracked.

### Phase 2: Control Plane Reconciliation

- Add `createLagoWebhookReconciliationService`.
- Resolve customers by `prontiq-customers.customerId-index`.
- Fetch current Lago subscription state by derived subscription id.
- Update org envelope and API key records with plan, subscription, period, and
  overdue fields.
- Mark previous Lago-period usage rows closed when a new period key appears.

### Phase 3: Webhook Adapter And Infra

- Add `POST /webhooks/lago`.
- Verify HMAC signatures before ledger claims.
- Add `prontiq-lago-webhook-events`.
- Add `PqLagoWebhookErrors` alarm.
- Add deploy config validation and env wiring.

### Phase 4: Documentation And Verification

- Update architecture, roadmap, runbooks, hints, changelog, README, and session
  docs.
- Add tests for hashing, webhook signature verification, service behavior, and
  DynamoDB reconciliation.

## Documentation Updates

- `ARCHITECTURE.MD`: add Lago webhook reconciliation contract, ledger table,
  route, security model, and PAYG/counter-period semantics.
- `ROADMAP.md`: mark P1B.17 complete with implementation notes.
- `NEXT-WORK.md`: move current phase to P1B.18.
- `NEXT-SESSION.md`: add Session 34 summary.
- `README.md`: update server-to-server surface and roadmap progress.
- `CHANGELOG.md`: add P1B.17 entry.
- `AGENTS.md`: add Lago webhook and secret-management guidance.
- `packages/api/HINTS.md`: document no Lago hot-path period lookup and PAYG
  enforcement mode.
- `packages/control-plane/HINTS.md`: document Lago webhook idempotency and
  plan-code fail-closed behavior.
- `docs/runbooks/lago-webhook-reconciliation.md`: expand rollout, drift,
  rollback, and verification steps.
- `docs/runbooks/lago-billing-events.md`: reference inbound webhook
  prerequisite.
- `docs/runbooks/lago-customer-sync.md`: add subscription id prerequisite.
- `docs/runbooks/lago-commercial-ops.md`: add plan-code and PAYG checks.
- `docs/runbooks/monitoring-alerting.md`: add Lago webhook alarm.
- `docs/decisions/021-lago-webhook-hmac-signatures.md`: HMAC over JWT.
- `docs/decisions/022-dedicated-lago-webhook-ledger.md`: dedicated ledger.
- `docs/decisions/023-lago-billing-period-counter-scopes.md`: denormalized
  periods.
- `docs/decisions/024-lago-plan-code-equals-tier.md`: direct plan mapping.

## Test Strategy

- Shared unit tests: stable Lago webhook payload hashing and explicit consumed
  event set.
- Webhook unit tests: HMAC success/failure, missing unique key, disabled 503
  propagation.
- Control-plane unit tests: disabled behavior, ignored event, duplicate event,
  missing customer drift.
- Control-plane integration tests: DynamoDB ledger idempotency, subscription
  reconciliation, prior-period closure, payment overdue/recovery toggles.
- API integration tests: PAYG is uncapped but tracked; Lago period source uses
  denormalized billing period fields.
- Full validation: package tests, typecheck, and integration tests with
  DynamoDB Local.

## Risk & Rollback

- Failure mode: Lago webhook configured while reconciliation is disabled.
  Rollback: keep/restore `LAGO_WEBHOOK_RECONCILIATION_ENABLED=false`; Lago will
  retry 503 responses.
- Failure mode: Lago plan code does not match a Prontiq tier. Rollback: fix Lago
  plan code or deploy deliberate platform support, then replay.
- Failure mode: Lago period source enabled before period fields are populated.
  Rollback: set `COUNTER_PERIOD_SOURCE=calendar` and redeploy.

No shipped data mutation is irreversible; ledger and usage rows are evidence and
should not be deleted during rollback.

## Open Questions

- Exact production enablement date remains an operator decision after canonical
  Lago org/customer/subscription smoke checks.
- Whether legacy Stripe tiers beyond Free/PAYG should be removed from the shared
  plan registry belongs to later cleanup tickets, not P1B.17.

## Estimate

- Phase 1: 0.5 day.
- Phase 2: 1 day.
- Phase 3: 0.5 day.
- Phase 4: 0.5-1 day.

## File Checklist

| Phase | File                                                              | Doc Update |
| ----- | ----------------------------------------------------------------- | ---------- |
| 1     | `packages/shared/src/lago-webhooks.ts`                            | No         |
| 1     | `packages/shared/src/types.ts`                                    | No         |
| 1     | `packages/shared/src/constants.ts`                                | No         |
| 2     | `packages/control-plane/src/lago-webhook-reconciliation.ts`       | No         |
| 2     | `packages/control-plane/src/lago-webhook-reconciliation*.test.ts` | No         |
| 3     | `packages/webhooks/src/lago.ts`                                   | No         |
| 3     | `packages/webhooks/src/lago.bootstrap.ts`                         | No         |
| 3     | `sst.config.ts`                                                   | No         |
| 3     | `.github/workflows/ci.yml`                                        | No         |
| 3     | `.github/workflows/deploy-prod.yml`                               | No         |
| 3     | `infra/deploy-role-policy.json`                                   | No         |
| 4     | `ARCHITECTURE.MD`                                                 | Yes        |
| 4     | `ROADMAP.md`                                                      | Yes        |
| 4     | `NEXT-WORK.md`                                                    | Yes        |
| 4     | `NEXT-SESSION.md`                                                 | Yes        |
| 4     | `README.md`                                                       | Yes        |
| 4     | `CHANGELOG.md`                                                    | Yes        |
| 4     | `AGENTS.md`                                                       | Yes        |
| 4     | `docs/runbooks/*.md`                                              | Yes        |
| 4     | `docs/decisions/021-024-*.md`                                     | Yes        |
| 4     | `packages/*/HINTS.md`                                             | Yes        |

P1B.17: 4 phases, 14 doc updates, 2 open questions.
