# P1F.03 — Honeycomb Backend Telemetry Rollout

## Intent

Integrate Honeycomb as Prontiq's primary backend trace-analysis plane for deployed Lambdas in `dev` and `prod`, using stage-specific `HONEYCOMB_API_KEY`, without regressing the current CloudWatch/SNS/X-Ray baseline.

## Current State

- `P1F.02` is live and gives Prontiq CloudWatch alarms, SNS email delivery, dashboard `prontiq-production`, structured JSON logs, and targeted X-Ray on `PqApi`.
- There is no existing Honeycomb package in the repo.
- In-scope deployed Lambda surfaces are:
  - API: `PqApi`, `PqAccount`
  - Webhooks: `PqClerkWebhook`, `PqStripeWebhook`
  - Control-plane: `PqSesFeedback`, `PqQuotaEmailWorker`, `PqBillingCron`, `PqMonthClose`
  - Ingestion: `PqIngestReadManifest`, `PqIngestCreateIndex`, `PqIngestHealthCheck`, `PqIngestAliasSwap`, `PqIngestOnFailure`, `PqIngestRouter`, `PqIngestCleanup`
- Explicitly deferred surfaces:
  - `packages/ingestion/src/fargate-bulk-ingest.ts`
  - `packages/ingestion/src/bulk-ingest.ts`
  - frontend/browser telemetry
- Secrets currently flow through GitHub Environment secrets/vars into workflow `env:`, then through `process.env` in `sst.config.ts`, then into Lambda env via `$util.secret(...)`.

## Constraints

- New secret: `HONEYCOMB_API_KEY`
  - required for deployed `dev` and `prod`
  - not required for CI `check` / `integration-test`
  - not required for local personal stages
- Honeycomb region is US and traces export to `https://api.honeycomb.io/v1/traces`.
- Scope is traces only. No log forwarding in this ticket.
- CloudWatch alarms, SNS email delivery, dashboard, and X-Ray on `PqApi` remain in place.
- Sensitive data must never be exported:
  - raw address query strings
  - request bodies
  - API keys or hashes
  - JWTs
  - email addresses
  - Stripe secrets
- Root `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` must stay green with no Honeycomb key set.

## Approach

Create a new internal package, `@prontiq/observability`, that owns:

- Honeycomb OTLP trace exporter configuration
- no-op behavior when `HONEYCOMB_API_KEY` is absent
- Lambda handler wrapping with explicit `forceFlush()`
- bounded attribute helpers
- manual span helpers for named OpenSearch operations

Use direct OpenTelemetry SDK instrumentation in code. Do not introduce ADOT Lambda layers, collectors, log forwarding, frontend telemetry, or ECS/Fargate secret delivery in this ticket.

## Phases

### Phase 1 — Add `@prontiq/observability`

Files:
- `packages/observability/*`

Changes:
- Add OTel OTLP/HTTP exporter config for Honeycomb traces.
- Add Lambda wrapper that starts a root span and force-flushes before success return and before rejected handler completion.
- Add allow-listed attribute helpers and manual span helpers.
- Add package README, HINTS, and tests.

Mergeability:
- Safe to merge before any secret exists because missing `HONEYCOMB_API_KEY` disables export cleanly.

### Phase 2 — Instrument API and webhook Lambdas

Files:
- `packages/api/src/{index.ts,account-handler.ts,tracing.ts}`
- `packages/webhooks/src/{clerk.ts,stripe.ts}`

Changes:
- Wrap exported Lambda handlers with `wrapLambdaHandler()`.
- Preserve existing X-Ray behavior in `packages/api/src/tracing.ts`.
- Add matching OTel child spans for existing named OpenSearch operations.
- Add bounded request and webhook attributes only.

Mergeability:
- Safe with telemetry disabled.

### Phase 3 — Instrument control-plane and ingestion Lambdas; wire secrets

Files:
- `packages/control-plane/src/{billing-cron.ts,month-close.ts,quota-email.ts,ses-feedback.ts}`
- `packages/ingestion/src/{create-index.ts,alias-swap.ts,lib.ts,read-manifest.ts,health-check.ts,on-failure.ts,router.ts,cleanup.ts}`
- `sst.config.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-prod.yml`

Changes:
- Wrap all in-scope Lambda handlers.
- Add named manual spans around central OpenSearch operations in ingestion.
- Add `HONEYCOMB_API_KEY` to deployed-stage secret validation in `sst.config.ts`.
- Inject `HONEYCOMB_API_KEY` and `PRONTIQ_STAGE` into all in-scope Lambda environments.
- Validate `HONEYCOMB_API_KEY` in deployed-stage workflows only.

Mergeability:
- Safe with telemetry disabled locally/CI; deploys require the secret in `dev` and `prod`.

### Phase 4 — Docs, rollout, and verification

Files:
- roadmap, architecture, README, AGENTS, changelog
- ADR-004
- Honeycomb runbook
- monitoring runbook

Changes:
- Describe Honeycomb as the backend trace plane.
- Keep CloudWatch/SNS and X-Ray documented during the transition.
- Document Honeycomb environment/key setup and rollout steps.
- Add `P1F.03` to the roadmap.

Rollout order:
1. Create Honeycomb environment `prontiq-dev`.
2. Create an environment-scoped ingest key.
3. Store it as GitHub Environment secret `HONEYCOMB_API_KEY` for `dev`.
4. Deploy `dev`.
5. Verify traces for `prontiq-api`, `prontiq-webhooks`, `prontiq-billing`, and `prontiq-ingestion`.
6. Repeat for `prod`.

## Documentation Updates

- `ROADMAP.md`
  - add `P1F.03 — Honeycomb Backend Telemetry`
  - update totals/progress counts
- `ARCHITECTURE.MD`
  - monitoring row
  - §10 Monitoring & Alerting
  - telemetry privacy exclusions
- `README.md`
  - observability summary
  - deploy prerequisite: `HONEYCOMB_API_KEY`
- `AGENTS.md`
  - secret-flow guidance for `HONEYCOMB_API_KEY`
  - Honeycomb backend-only scope
- `CHANGELOG.md`
  - unreleased Honeycomb backend telemetry entry
- `docs/decisions/004-honeycomb-application-telemetry.md`
- `docs/decisions/003-phase1-observability.md`
  - superseded-in-part note
- `docs/runbooks/honeycomb.md`
- `docs/runbooks/monitoring-alerting.md`
  - add Honeycomb verification while retaining CloudWatch/SNS/X-Ray procedures
- `NEXT-WORK.md`
  - make `P1F.03` rollout the active next step until stage secrets and deploy verification are complete
- `NEXT-SESSION.md`
  - record implementation and the remaining rollout steps

Not required:
- `docs/FRONTEND-STRATEGY.md`
- OpenAPI / API reference docs
- billing meter or event-shape docs

## Test Strategy

- Unit:
  - no-op when `HONEYCOMB_API_KEY` is absent
  - attribute helper drops forbidden keys
  - wrapper flushes before return
  - wrapper flushes before error completion
- Integration:
  - OTLP exporter emits a request with Honeycomb header
  - named OpenSearch spans remain intact in API tracing helper
- Regression:
  - deployed-stage validation rejects missing/whitespace `HONEYCOMB_API_KEY`
  - existing X-Ray behavior remains intact
  - no sensitive fields are exported as custom attributes
- Full repo gates:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm build`
  - `pnpm test`
- Manual rollout verification:
  - dev then prod Honeycomb datasets visible for all four backend service families

## Risk & Rollback

- Risk: exporter lifecycle adds latency on short-lived Lambdas.
  - Rollback: remove `HONEYCOMB_API_KEY` from stage env or revert the ticket; X-Ray/CloudWatch stay available.
- Risk: sensitive data leakage.
  - Rollback: revoke Honeycomb ingest key immediately, remove stage secret, redeploy disabled configuration.
- Risk: deploy breaks from secret validation.
  - Rollback: remove secret requirement temporarily or revert the ticket.

Telemetry already exported to Honeycomb cannot be withdrawn.

## Open Questions

None blocking.

Explicitly deferred:
- ECS/Fargate bulk-ingest telemetry
- frontend/browser telemetry
- X-Ray retirement

## Estimate

- Phase 1: 0.5–1 day
- Phase 2: 1–1.5 days
- Phase 3: 1–1.5 days
- Phase 4: 0.5–1 day

Total: 3–5 days

## Checklist

| Phase | Files | Action | Doc update |
|---|---|---|---|
| 1 | `plans/P1F.03-implementation-plan.md` | Create | Yes |
| 1 | `packages/observability/{package.json,tsconfig.json,README.md,HINTS.md}` | Create | README/HINTS |
| 1 | `packages/observability/src/{index.ts,config.ts,lambda.ts,attributes.ts,*.test.ts}` | Create | No |
| 2 | `packages/api/src/{index.ts,account-handler.ts,tracing.ts}` | Modify | No |
| 2 | `packages/webhooks/src/{clerk.ts,stripe.ts}` | Modify | No |
| 3 | `packages/control-plane/src/{billing-cron.ts,month-close.ts,quota-email.ts,ses-feedback.ts}` | Modify | No |
| 3 | `packages/ingestion/src/{create-index.ts,alias-swap.ts,lib.ts,read-manifest.ts,health-check.ts,on-failure.ts,router.ts,cleanup.ts}` | Modify | No |
| 3 | `sst.config.ts`, `.github/workflows/ci.yml`, `.github/workflows/deploy-prod.yml`, `pnpm-lock.yaml` | Modify | No |
| 4 | `ROADMAP.md`, `ARCHITECTURE.MD`, `README.md`, `AGENTS.md`, `CHANGELOG.md`, `NEXT-WORK.md`, `NEXT-SESSION.md` | Modify | Yes |
| 4 | `docs/decisions/004-honeycomb-application-telemetry.md`, `docs/runbooks/honeycomb.md` | Create | Yes |
| 4 | `docs/decisions/003-phase1-observability.md`, `docs/runbooks/monitoring-alerting.md` | Modify | Yes |

`P1F.03: 4 phases, 12 doc updates, 0 open questions.`
