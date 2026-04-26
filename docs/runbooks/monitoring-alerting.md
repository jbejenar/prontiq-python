# Monitoring & Alerting Runbook

Phase 1 observability baseline runbook for Prontiq.

## Scope

`P1F.02` implementation scope:

- CloudWatch alarms
- `PqIngestAlerts` SNS email delivery
- CloudWatch dashboard `prontiq-production`
- Honeycomb backend traces for deployed Lambdas
- retained X-Ray tracing on `PqApi`
- structured JSON logs on Lambda execution paths

## Operator Inputs

### GitHub Environment variable

- `ALERT_EMAILS`
  - stage: `prod`
  - format: comma-separated email addresses
  - example: `ops@example.com,alerts@example.com`
- `HONEYCOMB_ENABLED`
  - stages: `dev`, `prod`
  - optional kill switch for backend telemetry export
  - set to `false` to disable Honeycomb export for a redeploy

### GitHub Environment secret

- `HONEYCOMB_API_KEY`
  - stages: `dev`, `prod`
  - value: Honeycomb environment-scoped ingest key

This secret is validated in both deployed stages: GitHub workflow validation checks it before `dev` and `prod` deploys, and `sst.config.ts` rejects missing or whitespace-only values for those same deployed stages.

## Alarm Inventory

Existing alarms retained:

- `PqClerkWebhookErrors`
- `PqLagoWebhookErrors`
- `PqAccountErrors`
- `PqSesFeedbackErrors`
- `PqQuotaEmailWorkerErrors`
- `PqBillingEventsDlqVisible`
- `PqBillingEventsOldestMessage`

New Phase 1 alarms:

- `PqApi5xxRate`
- `PqApiLambdaErrorRate`
- `PqOpenSearchYellow`
- `PqOpenSearchRed`
- `PqOpenSearchLowFreeStorage` (per-node `FreeStorageSpace`, `Minimum` statistic)

All prod alarms notify `PqIngestAlerts`.

Email-backed operational alarms publish SNS email on `ALARM` only. `OK` and
`INSUFFICIENT_DATA` transitions remain visible in CloudWatch and dashboards, but
they must not have email actions. Low-traffic routes such as
`POST /webhooks/lago` naturally move through missing-data states when
`TreatMissingData=notBreaching`; OK-action emails create noise without adding
operational signal.

## Email Subscription Confirmation

After the first prod deploy with `ALERT_EMAILS`:

1. each recipient gets an SNS confirmation email
2. each recipient must click the confirmation link
3. only confirmed recipients receive alarms

Check subscription state:

```bash
aws sns list-subscriptions-by-topic \
  --topic-arn <PqIngestAlerts ARN> \
  --region ap-southeast-2
```

Expected: `SubscriptionArn` is not `PendingConfirmation`.

## Dashboard

Dashboard name:

- `prontiq-production`

Widgets:

- API request count
- API latency `p50/p95/p99`
- API 5xx rate
- API Lambda error rate
- OpenSearch cluster yellow/red state
- OpenSearch free storage
- billing events source queue age / visible messages / DLQ visible messages
- Lago event forwarder Lambda runtime errors
- Lago webhook route 5xx responses
- billing-event source queue age / DLQ depth for per-record Lago delivery
  failures
- critical Lambda error series

## Honeycomb Verification

Honeycomb is the backend trace-analysis plane once `HONEYCOMB_API_KEY` is set
for the stage, `HONEYCOMB_ENABLED` is not `false`, and the stack is deployed.
This is now verified in both `dev` and `prod`.

Expected service names:

- `prontiq-api`
- `prontiq-webhooks`
- `prontiq-billing`
- `prontiq-ingestion`

Verify one representative flow for each service family after deploy.

## X-Ray Verification

Tracing is enabled only on `PqApi`.

Use a real authenticated address request:

```bash
curl -H "X-Api-Key: <valid key>" \
  "https://api.prontiq.dev/v1/address/autocomplete?q=test"
```

Expected X-Ray trace:

- Lambda segment for `PqApi`
- DynamoDB subsegments from auth lookup / usage writes
- explicit `OpenSearch` subsegments from address-query execution

## Logs Insights

Query:

```sql
fields @timestamp, request_id, path, latency
| sort @timestamp desc
```

Expected:

- `request_id` populated on API request lifecycle logs
- `path` populated on API request lifecycle logs
- `latency` populated in milliseconds

Non-request Lambdas still emit JSON, but `path` / `latency` may be absent when not applicable.

## Validation Checklist

1. deploy prod with `ALERT_EMAILS` set
2. confirm SNS email subscriptions
3. verify `aws cloudwatch describe-alarms` shows the new alarms
4. open the `prontiq-production` dashboard
5. make representative backend traffic and verify Honeycomb traces
6. make a real authenticated address API call
7. verify X-Ray trace shape
8. verify Logs Insights query returns structured fields
9. force one alarm into `ALARM` and confirm an email is received
10. restore the alarm to `OK` and confirm the state changes in CloudWatch
    without an OK recovery email

## Alarm Drill

Manual alarm test:

```bash
aws cloudwatch set-alarm-state \
  --alarm-name PqApi5xxRate \
  --state-value ALARM \
  --state-reason "manual observability drill" \
  --region ap-southeast-2
```

After confirmation, restore:

```bash
aws cloudwatch set-alarm-state \
  --alarm-name PqApi5xxRate \
  --state-value OK \
  --state-reason "manual observability drill complete" \
  --region ap-southeast-2
```

Expected result:

- one email is received for the forced `ALARM`
- no email is received for the manual `OK` restore
- CloudWatch alarm history records both state transitions

Verify alarm actions:

```bash
aws cloudwatch describe-alarms \
  --region ap-southeast-2 \
  --query 'MetricAlarms[?starts_with(AlarmName, `Pq`)].{AlarmName:AlarmName,AlarmActions:AlarmActions,OKActions:OKActions,InsufficientDataActions:InsufficientDataActions}'
```

Expected for email-backed `PqIngestAlerts` alarms: `AlarmActions` is populated,
`OKActions` is empty, and `InsufficientDataActions` is empty.

## Rollback

If the observability rollout itself is faulty:

1. set `HONEYCOMB_ENABLED=false` in the target GitHub Environment
2. redeploy the affected stage
3. confirm Honeycomb export is disabled while CloudWatch/SNS/X-Ray remain available
4. revert infra/code only if the disable-and-redeploy path is insufficient

No data repair is required. Historical CloudWatch logs, Honeycomb traces, and X-Ray traces remain until retention expiry or vendor retention limits.
