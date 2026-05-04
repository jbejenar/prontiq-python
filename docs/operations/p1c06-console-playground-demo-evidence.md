# P1C.06 Console Playground Demo Key Evidence

Date: 2026-05-04
Stages: `dev`, `prod`
Region: `ap-southeast-2`
AWS account: `493712557159`

This file records safe operational evidence only. It intentionally excludes raw
API keys, API-key hashes, provider tokens, webhook secrets, and local secret-file
contents. Raw console playground demo keys are stored outside the repository.

## Summary

The console playground now uses dedicated API keys for demo execution. These
keys are separate from the historical landing-page demo keys and are governed by
the backend API-key policy attached to each demo org. The console remains a
controlled caller only; quota, rate limits, usage counters, billing events, and
abuse controls are enforced by the backend.

## Required Vercel Environment

Configure these as server-side environment variables on the
`prontiq-platform-console` Vercel project:

| Environment | Variable | Value posture |
| --- | --- | --- |
| Preview | `PRONTIQ_CONSOLE_PLAYGROUND_DEMO_API_KEY` | sensitive raw dev demo key, stored outside repo |
| Preview | `PRONTIQ_CONSOLE_PLAYGROUND_DEMO_BACKEND_POLICY_CONFIRMED` | `1` |
| Production | `PRONTIQ_CONSOLE_PLAYGROUND_DEMO_API_KEY` | sensitive raw prod demo key, stored outside repo |
| Production | `PRONTIQ_CONSOLE_PLAYGROUND_DEMO_BACKEND_POLICY_CONFIRMED` | `1` |

Vercel deployments must be redeployed after changing these variables. Existing
deployments do not pick up server-side env changes retroactively.

## Console Demo Key Inventory

| Stage | Org | Prefix | Active | Tier | Enforcement | Quota | Rate limit | Product | Disposition |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- |
| `dev` | `org_ConsolePlaygroundDemoDev` | `pq_live_4669` | yes | `free` | `hard_cap` | `10000` | `10` | `address` | console playground demo key |
| `prod` | `org_ConsolePlaygroundDemoProd` | `pq_live_5906` | yes | `free` | `hard_cap` | `10000` | `10` | `address` | console playground demo key |

## Validation Evidence

| Stage | Endpoint | API status | Quota header | Billing delivery | External subscription |
| --- | --- | ---: | --- | --- | --- |
| `dev` | `GET /v1/address/autocomplete` | `200` | `x-ratelimit-limit: 10000` | `accepted` | `lago_sub_org_ConsolePlaygroundDemoDev` |
| `prod` | `GET /v1/address/autocomplete` | `200` | `x-ratelimit-limit: 10000` | `accepted` | `lago_sub_org_ConsolePlaygroundDemoProd` |

Dev accepted billing event evidence observed for:

| Event ID | Status | Attempts |
| --- | --- | ---: |
| `bevt_0bf5aa2000f0d151876477b957b5c289` | `accepted` | `1` |
| `bevt_3061349997aa8ec550a75d2bf622f4d8` | `accepted` | `1` |
| `bevt_dd313e3a8858615a3eda89c475ce5cc3` | `accepted` | `1` |

Prod accepted billing event evidence observed for:

| Event ID | Status | Attempts |
| --- | --- | ---: |
| `bevt_4fede9a4f1d831d7e042f0b03768f15f` | `accepted` | `1` |

## Cleanup Notes

The historical landing-page demo keys remain active because they may still back
the landing-page demo and their raw values are not recoverable from DynamoDB.
They must not be reused for console playground execution because their current
policy is not the console demo policy.

| Stage | Org | Prefix | Active | Current posture | Console playground disposition |
| --- | --- | --- | --- | --- | --- |
| `dev` | `org_landing_demo_dev` | `pq_live_26b7` | yes | historical landing-demo key, enterprise/uncapped style row | do not use for console playground |
| `prod` | `org_landing_demo_prod` | `pq_live_15d3` | yes | historical landing-demo key, enterprise/uncapped style row | do not use for console playground |

One failed dev setup key was created against the historical underscore-style
landing demo org and then immediately deactivated because billing event v2
requires Clerk-shaped `org_<alnum>` organization IDs.

| Stage | Org | Prefix | Active | Disposition |
| --- | --- | --- | --- | --- |
| `dev` | `org_landing_demo_dev` | `pq_live_6980` | no | revoked; invalid console demo org shape for billing event v2 |

## Follow-Up

When the landing-page demo is migrated to dedicated hard-capped demo orgs, revoke
the historical `org_landing_demo_*` keys and update this evidence file and
`docs/operations/p1b23-pre-go-live-cleanup-evidence.md`.
