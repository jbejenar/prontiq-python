# ADR-004: Honeycomb becomes the backend application trace plane

## Status

Accepted

## Context

`P1F.02` established a solid AWS-native observability baseline: CloudWatch alarms, dashboard `prontiq-production`, SNS email delivery, structured JSON logs, and targeted X-Ray on `PqApi`. That baseline is necessary but not sufficient for backend debugging across the current platform because:

- only `PqApi` has X-Ray today
- webhook, billing, and ingestion Lambdas do not share a single trace-analysis plane
- log reconstruction is still doing too much of the debugging work

Prontiq needs deeper backend traces without replacing the existing AWS-native operations layer.

## Decision

Use Honeycomb as the primary backend application trace-analysis plane for deployed Lambdas, via a direct OpenTelemetry SDK integration in code.

Keep:

- CloudWatch alarms and dashboard
- SNS email alert delivery
- current `PqApi` X-Ray tracing during the rollout transition

Do not include in this decision:

- browser/frontend telemetry
- ECS/Fargate bulk-ingest telemetry
- log forwarding to Honeycomb
- X-Ray retirement

## Consequences

### Positive

- Gives Prontiq one backend trace-analysis surface across API, webhooks, billing, and ingestion Lambdas.
- Preserves the existing CloudWatch/SNS operational baseline rather than forcing a control-plane migration.
- Uses standard OTel instrumentation in-repo instead of Lambda layers or a collector rollout.
- Allows stage isolation with separate `HONEYCOMB_API_KEY` secrets in `dev` and `prod`.

### Negative

- Introduces an external observability vendor for traces.
- Requires explicit privacy discipline around custom attributes.
- Leaves the ECS/Fargate bulk-ingest task and browser telemetry for follow-up work.
- Creates a temporary dual-tracing state on `PqApi` until X-Ray is retired separately.

## Alternatives Considered

### 1. Keep X-Ray as the only trace system

Rejected. It does not scale cleanly across the broader backend surface and still leaves the platform without a shared trace-analysis plane outside the API.

### 2. Add Honeycomb via ADOT Lambda layers / collector rollout

Rejected. It adds more infrastructure and rollout complexity than this ticket needs, with less in-repo control over instrumentation seams.

### 3. Forward logs to Honeycomb instead of exporting traces

Rejected. This ticket is about backend tracing, not replacing structured logs or CloudWatch alarms.
