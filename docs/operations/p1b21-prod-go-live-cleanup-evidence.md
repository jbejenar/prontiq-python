# P1B.21 Prod Go-Live Cleanup Evidence

Date: 2026-04-27  
Stage: `prod`  
Region: `ap-southeast-2`  
AWS account: `493712557159`

This file records safe operational evidence only. It intentionally excludes raw
API keys, API-key hashes, Lago API keys, webhook secrets, local ignored file
contents, private customer emails, and provider tokens.

## Summary

P1B.21 is complete. The retained repo-owned production smoke API key was used
for one final API-originated smoke, the resulting Lago delivery was accepted,
and the smoke API key was then disabled. Billing remains enabled for go-live.

## Fixture Inventory And Disposition

| Artifact                 | Safe identifier                        | Disposition              | Reason                                                                           |
| ------------------------ | -------------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| Prod smoke org           | `org_prontiq_platform_lago_smoke_prod` | Retain                   | Test-only org identifier links migration evidence.                               |
| Prod smoke customer      | `pq_cust_01KQ3TT9XZZDR2CAZTV1TX1KBS`   | Retain as audit evidence | Required to interpret accepted billing and webhook evidence.                     |
| Prod smoke subscription  | `pq_sub_01KQ3TT9XZZDR2CAZTV1TX1KBS`    | Retain as audit evidence | Linked to accepted Lago usage events; not an active probe after key disablement. |
| Prod smoke API key       | prefix `pq_live_4a85`                  | Disabled                 | Final smoke completed; active reusable prod test key is no longer needed.        |
| Prod smoke usage row     | `address#period#2026-04-26_2026-05-25` | Retain                   | Usage counter evidence; request count ended at `11`.                             |
| Delivery ledger          | `prontiq-billing-event-deliveries`     | Retain                   | Replay and drift evidence.                                                       |
| Webhook ledger           | `prontiq-lago-webhook-events`          | Retain                   | Replay and drift evidence.                                                       |
| Local ignored smoke file | `.env.prod-lago-smoke.local`           | Retain locally only      | Historical operator input; raw values remain uncommitted.                        |

No unrelated Lago organizations or real customer rows were mutated.

## Final Runtime Posture

GitHub Environment `prod` safe variables:

- `BILLING_EVENTS_ENABLED=true`
- `COUNTER_PERIOD_SOURCE=lago`
- `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true`
- `LAGO_API_URL=https://billing.prontiq.dev`

Live Lambda environment checks:

- `PqApi`: `BILLING_EVENTS_ENABLED=true`
- `PqApi`: `COUNTER_PERIOD_SOURCE=lago`
- `PqLagoWebhook`: `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true`

## Final API-Originated Smoke

- Endpoint: `GET /v1/address/validate`
- API response: `200`
- Final accepted event ID: `bevt_f7833d581725b732d04d3eed3fd7c484`
- Delivery status: `accepted`
- Accepted at: `2026-04-27T01:05:39.225Z`
- Customer: `pq_cust_01KQ3TT9XZZDR2CAZTV1TX1KBS`
- Subscription: `pq_sub_01KQ3TT9XZZDR2CAZTV1TX1KBS`
- Credit delta: `1`

After the final smoke, the retained prod smoke API key was disabled with a
conditional update matching the safe fixture identifiers. A follow-up request
with the same key returned:

- HTTP status: `401`
- Error code: `INVALID_API_KEY`

## Post-Fix Prod Verification

After PR #163 fixed manual smoke event collision handling, production was
redeployed from `main` with workflow run `24974503448`.

The retired P1B.21 smoke key `pq_live_4a85` remained disabled and returned
`401 INVALID_API_KEY`, so a fresh labelled temporary probe was created only for
post-fix verification:

- Temporary key prefix: `pq_live_03f7`
- Label: `TEST - P1B.21 Post-Fix Prod Smoke 20260427`
- Customer: `pq_cust_01KQ3TT9XZZDR2CAZTV1TX1KBS`
- Subscription: `pq_sub_01KQ3TT9XZZDR2CAZTV1TX1KBS`

Verification results:

- Full production API smoke: `10/10` passed against `https://api.prontiq.dev`.
- Lago-period proof event: `bevt_c0902af1ae5916a464bc40ea6758f1c5`
- Delivery status: `accepted`
- Accepted at: `2026-04-27T03:09:16.580Z`
- Delivery attempts: `1`
- Usage scope: `address#period#2026-04-26_2026-05-25`
- Source queue and DLQ: `0` visible, `0` not visible, `0` delayed
- Relevant CloudWatch alarm check returned `[]`

After verification, the temporary key `pq_live_03f7` was disabled with reason
`P1B.21 post-fix prod smoke complete`. Local temporary raw-key material was
removed. Do not reactivate or reuse this key.

## Queue, DLQ, And Alarm State

Post-cleanup SQS state:

| Queue                        | Visible | Not visible | Delayed |
| ---------------------------- | ------: | ----------: | ------: |
| `prontiq-billing-events`     |     `0` |         `0` |     `0` |
| `prontiq-billing-events-dlq` |     `0` |         `0` |     `0` |

CloudWatch alarm check:

- `describe-alarms --state-value ALARM` returned `[]`.

## DNS, TLS, And Email Auth

DNS/TLS checks:

- `api.prontiq.dev` served HTTPS and `/v1/health` returned `200`.
- `billing.prontiq.dev` served HTTPS and responded over TLS.

SES and mail-auth checks:

- SES identity `prontiq.dev` is verified for sending in `ap-southeast-2`.
- SES DKIM status is `SUCCESS`.
- Custom MAIL FROM domain is `bounce.prontiq.dev`.
- Custom MAIL FROM status is `SUCCESS`.
- Apex SPF: `v=spf1 include:amazonses.com ~all`.
- DMARC: `v=DMARC1; p=quarantine; adkim=s; aspf=r`.
- `bounce.prontiq.dev` SPF: `v=spf1 include:amazonses.com ~all`.
- `bounce.prontiq.dev` MX: `10 feedback-smtp.ap-southeast-2.amazonses.com`.

## Residual Notes

- The retained Lago customer/subscription are not ongoing probes; they are
  retained only as audit evidence linked to migration events.
- Future production smoke tests must create a new labelled key/probe through a
  dedicated ticket, or use a real customer launch flow.
- Do not reactivate the disabled `pq_live_4a85` key without a new decision.
- Do not reactivate the disabled post-fix temporary probe `pq_live_03f7`.
