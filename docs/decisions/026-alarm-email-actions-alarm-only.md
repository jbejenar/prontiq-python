# ADR-026: CloudWatch email alerts are ALARM-only

## Status

Accepted.

## Question

Should CloudWatch alarms that notify the `PqIngestAlerts` email topic also email
on OK transitions?

## Decision

No. Email-backed operational alarms notify `PqIngestAlerts` only on `ALARM`.
Recovery and OK states remain visible in CloudWatch alarms and dashboards, but
they are not emailed.

## Considered And Rejected

- **Keep OK email actions.** Rejected because low-traffic routes naturally move
  through `INSUFFICIENT_DATA -> OK` when missing datapoints are treated as
  non-breaching, which creates alert fatigue.
- **Change `treatMissingData`.** Rejected because missing data is not itself a
  failure for low-traffic webhooks or queues.
- **Disable Lago webhook alarms.** Rejected because the route still needs an
  actionable signal for real 5xx bursts during rollout.

## Consequences

- ALARM notifications still email the configured operators.
- Operators verify recovery in CloudWatch dashboards or with
  `aws cloudwatch describe-alarms`.
- If a specific alarm later needs recovery email, that must be a deliberate
  exception with its own rationale.
