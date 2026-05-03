# Smoke Classification Runbook

## Purpose

This runbook defines which smoke checks run on every deploy and which remain
operator-run. The boundary prevents CI from silently adding fragile prod auth
flows or mutating commercial state on every deploy.

## Categories

| Category            | Meaning                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `ci-every-deploy`   | Runs automatically after a stage deploy and may block the workflow from going green. |
| `runbook-on-demand` | Operator-run certification or incident check.                                        |
| `manual-ui-only`    | Requires a real browser/user session or step-up flow.                                |

## Current Smokes

| Smoke                         | Command / flow                                          | Category            | Stage scope           | Reason                                                       |
| ----------------------------- | ------------------------------------------------------- | ------------------- | --------------------- | ------------------------------------------------------------ |
| Address API                   | `pnpm --filter @prontiq/api smoke`                      | `ci-every-deploy`   | dev + prod            | Public hot path, uses `X-Api-Key`, no Clerk session.         |
| Account setup                 | `pnpm --filter @prontiq/api smoke:account-setup`        | `ci-every-deploy`   | dev only              | Verifies private recovery path with dev Clerk test user.     |
| Keys list/create              | `pnpm --filter @prontiq/api smoke:keys`                 | `ci-every-deploy`   | dev only              | Mutates dedicated dev key fixture; not prod-safe automation. |
| Keys step-up gate             | `pnpm --filter @prontiq/api smoke:keys-stepup`          | `ci-every-deploy`   | dev only              | Verifies blocked branch with Backend SDK token.              |
| Keys audit                    | `pnpm --filter @prontiq/api smoke:keys-audit`           | `ci-every-deploy`   | dev only              | Verifies dev audit surface.                                  |
| Account usage                 | `pnpm --filter @prontiq/api smoke:account-usage`        | `ci-every-deploy`   | dev only              | Verifies private usage API in dev.                           |
| Lago live event               | `pnpm --filter @prontiq/control-plane lago:smoke:event` | `runbook-on-demand` | dev/prod operator-run | Mutates billing delivery evidence and must stay deliberate.  |
| Console rotate/revoke success | Browser with real Clerk session and reverification      | `manual-ui-only`    | dev/prod operator-run | Backend SDK tokens cannot satisfy real step-up success.      |

## Address API Deploy Smoke

The Address API deploy smoke requires:

- `PRONTIQ_API`: deployed stage URL from SST outputs.
- `PRONTIQ_KEY`: GitHub Environment secret for the stage.
- A dedicated labelled smoke org/key in that stage.

The smoke must never print raw API keys. Evidence may record only key prefix,
key id, stage, org label/id, plan, creation time, and workflow run id.

## Retired Production Keys

Never reuse or reactivate these retired production smoke keys:

- `pq_live_4a85`
- `pq_live_03f7`
- `pq_live_0300`

P1F.04 permanent prod smoke must use a new labelled probe.

## Adding A New Smoke

Any new smoke must declare:

- category
- stage scope
- data it mutates
- credentials required
- whether it can run unattended
- rollback/rotation procedure for its fixture

Update this runbook and the PR template checklist in the same PR.
