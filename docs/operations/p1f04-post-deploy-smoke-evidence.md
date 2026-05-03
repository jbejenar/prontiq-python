# P1F.04 Post-Deploy Smoke Evidence

This document records safe evidence for the permanent deploy smoke fixtures and
workflow runs. Do not paste raw API keys, API-key hashes, secrets, headers, or
customer data.

## Fixture Evidence

| Stage | Smoke org label | Clerk org id | Key prefix | Key id | Plan | GitHub Environment secret | Created at |
| ----- | --------------- | ------------ | ---------- | ------ | ---- | ------------------------- | ---------- |
| dev   | TODO            | TODO         | TODO       | TODO   | TODO | `dev.PRONTIQ_KEY`         | TODO       |
| prod  | TODO            | TODO         | TODO       | TODO   | TODO | `prod.PRONTIQ_KEY`        | TODO       |

## Workflow Evidence

| Stage | Workflow                                       | Run id | Result | Notes                                      |
| ----- | ---------------------------------------------- | ------ | ------ | ------------------------------------------ |
| dev   | `ci.yml` / `smoke-dev`                         | TODO   | TODO   | Address API smoke plus dev account smokes. |
| prod  | `deploy-prod.yml` / `smoke-prod`               | TODO   | TODO   | Address API smoke only.                    |
| prod  | `deploy-prod.yml` / `force_smoke_failure=true` | TODO   | TODO   | Expected red smoke job using invalid key.  |

## Branch Protection Gate

GitHub branch protection is externally blocked for this private repo unless
GitHub Pro is enabled or the repo becomes public. Record the final status here
when P1F.04 closes.

```text
TODO: paste non-secret `gh api .../branches/main/protection` result or
screenshot reference.
```
