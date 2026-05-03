# P1B.23 Pre-Go-Live Lago Test Fixture + Pricing Cleanup Evidence

Date: 2026-05-03
Stages: `dev`, `prod`
Region: `ap-southeast-2`
AWS account: `493712557159`

This file records safe operational evidence only. It intentionally excludes raw
API keys, API-key hashes, Lago API keys, webhook secrets, private customer
emails, provider tokens, and local secret-file contents.

## Summary

P1B.23 is complete. Prod PAYG pricing is intentionally configured at A$0.0015
per address request, dev/prod Lago reconciliation is clean, retained migration
evidence is preserved, stale repo-created smoke keys are disabled, and one
short-lived key per stage was created, used, accepted by Lago, and revoked.

## Lago Catalog

Production Lago catalog:

| Plan | Currency | Address metric | Charge model | Amount | Metadata posture |
| --- | --- | --- | --- | ---: | --- |
| `free` | `AUD` | `prontiq_address_requests` | `package` | `0` with 5,000 included | console-visible prod Free metadata |
| `payg` | `AUD` | `prontiq_address_requests` | `standard` | `0.0015` | console-visible prod PAYG metadata |

Development Lago catalog:

| Plan | Currency | Address metric | Charge model | Amount | Disposition |
| --- | --- | --- | --- | ---: | --- |
| `free` | `AUD` | `prontiq_address_requests` | `package` | `0` with 5,000 included | retained dev Free plan |
| `payg_aud` | `AUD` | `prontiq_address_requests` | `standard` | `0.0015` | temporary dev-only PAYG smoke plan |
| `starter` | `AUD` | `prontiq_address_requests` | `package` | `0` with 50,000 included | retained dev capped plan |

The original dev `payg` code remains unavailable because the historical dev
plan was created with the wrong currency and retired. Do not copy `payg_aud` to
prod; prod uses canonical `payg`.

## Reconciliation

Final reconciliation results:

| Stage | Result |
| --- | --- |
| `dev` | `{"scanned":4,"projected":4,"changed":0,"drift":0,"errors":0}` |
| `prod` | `{"scanned":2,"projected":2,"changed":0,"drift":0,"errors":0}` |

Retained historical prod smoke evidence rows without current Clerk `orgId`
values are intentionally skipped by the reconciler full scan. They remain
available for audit/replay evidence and are not active customer records.

## API Key Inventory And Disposition

Production key dispositions:

| Environment | Org | Prefix | Active | Disposition |
| --- | --- | --- | --- | --- |
| `prod` | `org_landing_demo_prod` | `pq_live_15d3` | yes | retained operational landing-demo key |
| `prod` | `org_3CtJcr0fzTs6pitpdATB9rBp0vz` | `pq_live_283f` | yes | retained real Clerk-org user key |
| `prod` | `org_3CtJcr0fzTs6pitpdATB9rBp0vz` | `pq_live_0ff7` | yes | retained real Clerk-org user key |
| `prod` | `org_prod` | `pq_live_prod` | no | retained disabled legacy fixture |
| `prod` | `org_prod` | `pq_live_671a` | no | disabled by P1B.23 cleanup |
| `prod` | `org_prontiq_platform_lago_smoke_prod` | `pq_live_4a85` | no | retained disabled P1B.21 evidence |
| `prod` | `org_prontiq_platform_lago_smoke_prod` | `pq_live_03f7` | no | retained disabled P1B.21 post-fix evidence |
| `prod` | `org_3CW9ZfOEGGalHh5KUpsLVBykw40` | `pq_live_0300` | no | one-off P1B.23 prod smoke; revoked after use |

Development key dispositions:

| Environment | Org | Prefix | Active | Disposition |
| --- | --- | --- | --- | --- |
| `dev` | `org_landing_demo_dev` | `pq_live_26b7` | yes | retained operational landing-demo key |
| `dev` | `org_3CtIYMeNMZQF9A9iQqBxkHkV03K` | `pq_live_27de` | yes | retained active dev test-user key |
| `dev` | `org_3CtIYMeNMZQF9A9iQqBxkHkV03K` | `pq_live_fce1` | no | revoked by P1B.23 audit cleanup |
| `dev` | `org_P1B22DevSmoke202604271046` | `pq_live_f1af` | no | revoked by P1B.23 cleanup |
| `dev` | `org_3CW77XA9FGbUX8bMZ0hTPwkalkD` | `pq_live_e284` | no | one-off P1B.23 dev smoke; revoked after use |

All other listed dev smoke keys were already inactive before P1B.23 closeout.

## Lago Customer And Subscription Evidence

Production active Clerk-org subscriptions:

| Org | Plan | Subscription external ID | Status |
| --- | --- | --- | --- |
| `org_3CtJcr0fzTs6pitpdATB9rBp0vz` | `payg` | `lago_sub_org_3CtJcr0fzTs6pitpdATB9rBp0vz` | `active` |
| `org_3CW9ZfOEGGalHh5KUpsLVBykw40` | `free` | `lago_sub_org_3CW9ZfOEGGalHh5KUpsLVBykw40` | `active` |

Retained synthetic prod migration evidence:

| Org envelope | Disposition |
| --- | --- |
| `ORG#org_prontiq_platform_lago_smoke_prod` | retained as P1B.21 audit evidence |
| `ORG#org_prontiq_platform_p1b18_prod_test_20260426t102809z` | retained as P1B.18/P1B.21 audit evidence |
| `ORG#org_prontiq_platform_p1b18_prod_test_20260426t102428z` | retained as P1B.18/P1B.21 audit evidence |

No unrelated Lago organizations or real customer rows were deleted.

## Final Dev Smoke

One short-lived dev key was created through the key-management service and
revoked immediately after the smoke request.

| Field | Value |
| --- | --- |
| Endpoint | `GET /v1/address/validate` |
| API status | `200` |
| Response confidence | `high` |
| Smoke key prefix | `pq_live_e284` |
| Smoke key ID | `key_01KQPCBT4R2X0ZV3J0FV5CS5K0` |
| Smoke key created at | `2026-05-03T07:38:06.220Z` |
| Smoke key revoked at | `2026-05-03T07:38:10.548Z` |
| Billing event ID | `bevt_c9ec5eb7579aaae3757bbe9c39b637aa` |
| Delivery status | `accepted` |
| Accepted at | `2026-05-03T07:38:10.408Z` |
| External subscription | `lago_sub_org_3CW77XA9FGbUX8bMZ0hTPwkalkD` |
| Credit delta | `1` |

The raw key was not recorded.

## Final Prod Smoke

One short-lived prod key was created through the key-management service and
revoked immediately after the smoke request.

| Field | Value |
| --- | --- |
| Endpoint | `GET /v1/address/validate` |
| API status | `200` |
| Response confidence | `high` |
| Smoke key prefix | `pq_live_0300` |
| Smoke key ID | `key_01KQPBXS40RVKVY6N53G77VA0G` |
| Smoke key created at | `2026-05-03T07:30:26.423Z` |
| Smoke key revoked at | `2026-05-03T07:30:32.711Z` |
| Billing event ID | `bevt_2814283dfdf6821005f0d1c8ade4cdd3` |
| Delivery status | `accepted` |
| Accepted at | `2026-05-03T07:30:30.323Z` |
| External subscription | `lago_sub_org_3CW9ZfOEGGalHh5KUpsLVBykw40` |
| Credit delta | `1` |

The raw key was not recorded.

## Queue, DLQ, And Alarm State

Post-cleanup SQS state:

| Queue | Visible | Not visible | Delayed |
| --- | ---: | ---: | ---: |
| `prontiq-billing-events-dev` | `0` | `0` | `0` |
| `prontiq-billing-events-dlq-dev` | `0` | `0` | `0` |
| `prontiq-billing-events` | `0` | `0` | `0` |
| `prontiq-billing-events-dlq` | `0` | `0` | `0` |

CloudWatch alarm check:

- `describe-alarms --state-value ALARM` returned `[]`.

## Runtime Flags

Live Lambda posture:

- Prod Lago reconciler: `LAGO_RECONCILIATION_ENABLED=true`
- Prod Lago reconciler: `LAGO_API_URL=https://billing.prontiq.dev`
- Prod Lago webhook: `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true`

The deploy workflow now passes `LAGO_RECONCILIATION_ENABLED` into SST deploys,
so the live Lambda setting is preserved across future prod deployments.

## Residual Notes

- P1F.04 owns any future permanent production smoke API key.
- P1B.23 intentionally used one-off dev/prod smoke keys and revoked them
  immediately.
- Retained synthetic Lago/customer/subscription rows are audit evidence, not
  active probes.
- The production PAYG price is now intentional: A$0.0015 per
  `prontiq_address_requests` unit.
