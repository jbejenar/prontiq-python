# P1F.04 Post-Deploy Smoke Evidence

This document records safe evidence for the permanent deploy smoke fixtures and
workflow runs. Do not paste raw API keys, API-key hashes, secrets, headers, or
customer data.

## Fixture Evidence

| Stage | Smoke org label | Clerk org id | Key prefix | Key id | Plan | GitHub Environment secret | Created at |
| ----- | --------------- | ------------ | ---------- | ------ | ---- | ------------------------- | ---------- |
| dev   | P1F.04 dev deploy smoke | `org_3CtIYMeNMZQF9A9iQqBxkHkV03K` | `pq_live_e63a` | `key_01KQPKEFVQ2YNK0GY5BEYR1B9N` | `starter` | `dev.PRONTIQ_KEY` | 2026-05-03T09:41:54.167Z |
| prod  | P1F.04 prod deploy smoke | `org_3CtJcr0fzTs6pitpdATB9rBp0vz` | `pq_live_79a3` | `key_01KQPKEG6EVQ3S3JQSB1R58MSR` | `payg` | `prod.PRONTIQ_KEY` | 2026-05-03T09:41:54.510Z |

Earlier P1F.04 fixture attempts used synthetic org ids and were revoked before
closeout. Active deploy smoke keys must remain attached to real Clerk org ids
because billing-event schema validation requires `org_[A-Za-z0-9]+`.

## Workflow Evidence

| Stage | Workflow                                       | Run id | Result | Notes                                      |
| ----- | ---------------------------------------------- | ------ | ------ | ------------------------------------------ |
| dev   | `ci.yml` / `smoke-dev`                         | `25275099592` | pass | Address API smoke plus dev account smokes passed after `dev.PRONTIQ_KEY` was provisioned. |
| prod  | `deploy-prod.yml` / `smoke-prod`               | `25275577644` | pass | Address API smoke passed after moving the prod fixture to a real Clerk org. |
| prod  | `deploy-prod.yml` / `force_smoke_failure=true` | `25275789480` | expected fail | Red `smoke-prod` with invalid key proves prod smoke failure blocks workflow green status. |

## Branch Protection Gate

GitHub branch protection remains externally blocked for this private repo unless
GitHub Pro is enabled or the repo becomes public. P1F.04 shipped the workflow
checks and documents the required status check, but this repository cannot
enable the rule while GitHub returns HTTP 403.

```text
gh api repos/jbejenar/prontiq-platform/branches/main/protection
{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature.","documentation_url":"https://docs.github.com/rest/branches/branch-protection#get-branch-protection","status":"403"}
```
