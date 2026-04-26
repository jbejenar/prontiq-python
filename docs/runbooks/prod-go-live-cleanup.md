# Final Prod Go-Live Cleanup Runbook

Operator checklist for `P1B.21`. Use this after `P1B.20` has completed, when
the Lago-backed commercial path is ready for real customer go-live and retained
production smoke fixtures no longer need to support migration work.

## Scope

This runbook owns final production smoke-fixture retirement and commercial-plane
go-live posture.

It covers:

- inventorying repo-owned prod smoke/test artifacts retained through the Lago
  migration
- deciding whether each artifact is deleted, disabled, relabelled as an
  operational probe, or retained as audit evidence
- verifying production Lago catalog and runtime flags
- checking queues, DLQs, alarms, DNS/TLS, and SES authentication
- running one final post-cleanup smoke through the production API and Lago
  forwarder

It does not cover:

- console billing proxy/API implementation (`P1B.18`)
- Stripe legacy retirement (`P1B.19`)
- post-cutover Stripe config/surface deletion (`P1B.20`)
- deleting or editing real customer data

## Safety Rules

- Do not paste or commit raw API keys, Lago API keys, webhook secrets, private
  customer emails, API-key hashes, or local secret-file contents.
- Do not mutate unrelated Lago organizations used by other repos.
- Do not delete real customer/org rows.
- Do not delete billing delivery-ledger or webhook-ledger rows unless a ticket
  explicitly decides that retained audit evidence is no longer required.
- Retain smoke fixtures during `P1B.18`, `P1B.19`, and `P1B.20` unless they are
  unsafe; they are expected to support migration validation.
- Prefer revoking or disabling smoke API keys at final go-live over
  hard-deleting evidence needed for replay/drift analysis.
- Keep `COUNTER_PERIOD_SOURCE=calendar` unless a later cutover decision
  explicitly approves Lago billing-period enforcement scopes.

## Preconditions

Do not start final fixture retirement until:

- `P1B.18`, `P1B.19`, and `P1B.20` are complete
- repo-owned prod smoke API key/customer/subscription exists or has documented
  prior evidence from the migration
- at least one API-originated prod billing event has been accepted in
  `prontiq-billing-event-deliveries`
- prod billing-event source queue and DLQ are empty
- no CloudWatch alarms are in `ALARM`
- the smoke artifact identifiers can be recorded safely without raw API keys,
  hashes, webhook secrets, or local secret-file contents

If these preconditions are not true, continue the relevant Lago migration ticket
instead of retiring fixtures early.

## Artifact Inventory

Create a safe inventory before changing anything. Record safe identifiers only.

Inventory these artifact classes:

- GitHub Environment variables controlling prod commercial rollout
- prod Lambda environment values for rollout flags
- repo-owned prod smoke API key record in `prontiq-keys`
- repo-owned prod smoke customer row in `prontiq-customers`
- prod smoke usage row in `prontiq-usage`
- prod smoke billing delivery rows in `prontiq-billing-event-deliveries`
- prod Lago customer and subscription used for smoke
- prod Lago webhook endpoint configuration
- local ignored smoke files by filename only, not content

For each artifact, choose one disposition:

- `delete`: only for disposable fixture data that is not replay/audit evidence
- `disable`: for API keys or subscriptions that should not be usable at go-live
- `relabel`: for retained operational probes that must remain visibly
  non-customer
- `retain`: for audit/replay evidence, with a reason and retention owner

## Runtime Flag Check

Check GitHub Environment config and the deployed Lambda environment.

Expected final go-live posture:

- `BILLING_EVENTS_ENABLED` may be `false` during inventory/cleanup if operators
  want to prevent accidental new emissions
- after catalog, queue, DLQ, and alarm prechecks pass, set
  `BILLING_EVENTS_ENABLED=true`, redeploy prod, and verify the live API Lambda
  environment before the controlled post-cleanup smoke
- if post-cleanup smoke passes, leave `BILLING_EVENTS_ENABLED=true` as the
  recorded go-live posture unless the release owner explicitly chooses to keep
  customer billing disabled until a later launch window
- if post-cleanup smoke fails, set `BILLING_EVENTS_ENABLED=false`, redeploy, and
  stop before real customer go-live proceeds
- `COUNTER_PERIOD_SOURCE=calendar`
- `LAGO_WEBHOOK_RECONCILIATION_ENABLED=false` unless the Lago webhook endpoint is
  actively configured and valid webhook smoke has passed

Record final flag values without secrets.

## Lago Catalog Check

Verify in the canonical production Lago org:

- org: `prontiq`
- metric code: `prontiq_address_requests`
- metric aggregation: sum of `properties.credits`
- plan codes: production-relevant codes such as `free` and `payg`
- customer external IDs: `pq_cust_<ulid>`
- subscription external IDs: `pq_sub_<same ulid>`

Production catalog items must not use test-only names or descriptions unless
they are explicitly retained smoke fixtures. Test fixtures must be clearly
labelled as non-customer data.

## Queue And Alarm Check

Verify the production billing queues are quiet:

```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-southeast-2.amazonaws.com/493712557159/prontiq-billing-events \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed \
  --region ap-southeast-2

aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-southeast-2.amazonaws.com/493712557159/prontiq-billing-events-dlq \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed \
  --region ap-southeast-2
```

Expected:

- visible messages: `0`
- not-visible messages: `0`
- delayed messages: `0`

Verify no production alarms are in `ALARM`:

```bash
aws cloudwatch describe-alarms \
  --region ap-southeast-2 \
  --state-value ALARM \
  --query 'MetricAlarms[].AlarmName'
```

Email-backed operational alarms should notify on `ALARM` only:

```bash
aws cloudwatch describe-alarms \
  --region ap-southeast-2 \
  --query 'MetricAlarms[?contains(AlarmName, `PqLago`) || contains(AlarmName, `PqSes`) || contains(AlarmName, `PqApi`)].{AlarmName:AlarmName,AlarmActions:AlarmActions,OKActions:OKActions,InsufficientDataActions:InsufficientDataActions}'
```

Expected for email-backed alarms:

- `AlarmActions` contains the alert SNS topic
- `OKActions` is empty
- `InsufficientDataActions` is empty

## DNS, TLS, And Email Auth Check

Verify status without copying provider tokens or secrets:

- `api.prontiq.dev` resolves and serves TLS
- `billing.prontiq.dev` resolves and serves TLS
- SES domain identity for `prontiq.dev` is verified in `ap-southeast-2`
- DKIM CNAMEs resolve
- apex SPF includes SES
- `_dmarc.prontiq.dev` is present with the intended policy/alignment
- custom MAIL FROM `bounce.prontiq.dev` is successful in SES
- `bounce.prontiq.dev` MX and SPF records resolve

Record pass/fail status only.

## Final Post-Cleanup Smoke

After cleanup/disposition decisions are applied and prechecks are green:

1. Set `BILLING_EVENTS_ENABLED=true` in the prod GitHub Environment if it is not
   already true.
2. Redeploy prod and verify the live API Lambda environment shows
   `BILLING_EVENTS_ENABLED=true`.
3. Use a fresh go-live probe or intentionally retained repo-owned prod smoke API
   key.
4. Confirm the matching customer row is active and mapped to the intended Lago
   customer/subscription.
5. Send exactly one low-risk address API request.
6. Verify the API returns `200`.
7. Verify one new billing delivery row is `accepted`.
8. Verify the billing source queue and DLQ are empty.
9. Verify no CloudWatch alarms enter `ALARM`.
10. Record the safe event ID and run IDs only.

If the smoke would reuse a previously sent cumulative count, advance or recreate
the retained probe first. Do not create a same-`eventId`/different-payload
collision as part of the go-live check.

## Rollback

If cleanup or post-cleanup smoke fails:

- set `BILLING_EVENTS_ENABLED=false` in the prod GitHub Environment and redeploy
  to stop new API-originated usage events
- leave existing delivery-ledger rows intact for diagnosis
- do not replay DLQ messages until the root cause is understood
- if a smoke API key was created, revoke or disable it
- record the failure mode and stop before real customer go-live proceeds

## Evidence Checklist

Record these in PR/session notes:

- cleanup ticket ID: `P1B.21`
- prod deploy/run IDs used for flag changes
- final rollout flag values
- artifact inventory with disposition
- safe Lago metric/plan/customer/subscription identifiers
- queue/DLQ counts
- alarm health summary
- DNS/TLS/email-auth status summary
- post-cleanup smoke event ID and delivery status
- statement that unrelated Lago orgs and real customer rows were untouched
