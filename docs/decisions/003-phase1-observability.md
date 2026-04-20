# ADR-003: Phase 1 observability uses CloudWatch + SNS/email + targeted X-Ray

## Status

Accepted

Superseded in part by [ADR-004](004-honeycomb-application-telemetry.md) for backend trace analysis. CloudWatch alarms/dashboard, SNS email delivery, and structured JSON logging remain in force.

## Context

`P1F.02` needs a Phase 1 observability baseline that is production-ready without introducing another vendor or a large telemetry rollout. The live platform already has partial CloudWatch alarms on webhook and control-plane failure surfaces, but it is missing:

- prod email subscriptions for alarm delivery
- a CloudWatch dashboard
- address-API 5xx and Lambda error-rate alarms
- OpenSearch health/storage alarms
- deterministic `Lambda → DynamoDB → OpenSearch` tracing
- one JSON log shape across Lambda execution paths

Forces:

- Phase 1 must stay AWS-native.
- The roadmap’s evidence is concrete: `CloudWatch + X-Ray`, `SNS → email`, and a Logs Insights query on `request_id`, `path`, and `latency`.
- We should not rename or migrate the existing alert topic unless the ticket actually requires it.
- OpenSearch tracing must not depend on library transport internals that may change under us.

## Decision

Use:

- **CloudWatch alarms + dashboard** for metrics and operator visibility
- **the existing `PqIngestAlerts` SNS topic** with prod email subscriptions from `ALERT_EMAILS`
- **raw JSON application logs** emitted by a shared logger helper, not Lambda advanced JSON log format
- **X-Ray active tracing on `PqApi` only**
- **AWS SDK v3 capture for DynamoDB** plus **explicit `OpenSearch` subsegments around address-query execution**

## Consequences

### Positive

- Meets the Phase 1 roadmap without introducing Datadog, Sentry, PagerDuty, Slack, or OTel.
- Keeps the existing alert topology intact; only subscriptions and additional alarms are added.
- Makes OpenSearch traces deterministic because the query layer creates the subsegments directly.
- Keeps Logs Insights field extraction stable because the application owns the JSON shape.

### Negative

- Only `PqApi` is traced in Phase 1; deeper control-plane tracing remains future work.
- Raw JSON logs require application-level discipline; Lambda’s platform formatter does not enforce shape for us.
- Email delivery is only as good as subscription confirmation; this remains a manual operator step.

## Alternatives Considered

### 1. Create a new `PqPlatformAlerts` topic

Rejected. The existing `PqIngestAlerts` topic is already shared by non-ingestion alarms, and renaming it adds migration churn with no Phase 1 benefit.

### 2. Enable Lambda tracing without explicit query instrumentation

Rejected. Lambda active tracing alone does not reliably prove OpenSearch timing/segments.

### 3. Use Lambda advanced JSON log format

Rejected. It risks changing top-level field extraction and double-wrapping application logs when the roadmap already expects a specific Logs Insights query shape.

### 4. Introduce EMF or ADOT/OTel

Rejected. Both are larger telemetry decisions than this ticket requires. CloudWatch-native metrics plus targeted X-Ray instrumentation are sufficient for Phase 1.
