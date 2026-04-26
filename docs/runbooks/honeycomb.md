# Honeycomb Runbook

Backend trace rollout for `P1F.03`.

Status:

- verified in `dev` on 2026-04-20
- verified in `prod` on 2026-04-20

## Scope

- Honeycomb backend traces for deployed Lambdas
- `HONEYCOMB_API_KEY` secret setup
- `dev` and `prod` rollout verification

Not in scope:

- browser/frontend telemetry
- ECS/Fargate bulk-ingest telemetry
- CloudWatch alarm/dashboard operations

## Honeycomb Environments

Create two Honeycomb environments:

- `prontiq-dev`
- `prontiq-prod`

Create one environment-scoped ingest key per environment.

## GitHub Secret Setup

Set the Honeycomb ingest key in GitHub Environment secrets:

- Environment: `dev`
  - secret: `HONEYCOMB_API_KEY`
- Environment: `prod`
  - secret: `HONEYCOMB_API_KEY`

Deployed-stage workflows fail fast if this secret is missing or whitespace-only.

Optional GitHub Environment variable:

- `HONEYCOMB_ENABLED`
  - stages: `dev`, `prod`
  - default: unset / `true`
  - rollback value: `false`

## Service Map

Expected Honeycomb service names:

- `prontiq-api`
- `prontiq-webhooks`
- `prontiq-billing`
- `prontiq-ingestion`

## Rollout

### Dev

1. Create Honeycomb environment `prontiq-dev`.
2. Create an environment-scoped ingest key.
3. Store it as GitHub Environment secret `HONEYCOMB_API_KEY` for `dev`.
4. Deploy `dev`.
5. Generate representative traffic for:
   - one address API request
   - one account or webhook path
   - one billing/control-plane path
   - one ingestion Lambda path
6. Verify traces exist in Honeycomb under the four service names.

### Prod

1. Create Honeycomb environment `prontiq-prod`.
2. Create an environment-scoped ingest key.
3. Store it as GitHub Environment secret `HONEYCOMB_API_KEY` for `prod`.
4. Deploy `prod`.
5. Verify the same service-name layout and representative traces.

## Verification Checklist

- `HONEYCOMB_API_KEY` present in the target GitHub Environment
- deploy succeeds
- traces visible for:
  - `prontiq-api`
  - `prontiq-webhooks`
  - `prontiq-billing`
  - `prontiq-ingestion`
- CloudWatch alarms/dashboard still behave normally
- `PqApi` X-Ray traces still exist during the transition

## Privacy Rules

Custom span attributes must not contain:

- raw address query strings
- request bodies
- API keys or hashes
- JWTs
- email addresses
- payment provider secrets

If any sensitive data appears in Honeycomb, revoke the ingest key immediately and redeploy with telemetry disabled.

## Rollback

If Honeycomb telemetry is faulty:

1. leave `HONEYCOMB_API_KEY` in place
2. set GitHub Environment variable `HONEYCOMB_ENABLED=false` for the target stage
3. redeploy the stage
4. verify Honeycomb export is disabled
5. continue to use CloudWatch/SNS/X-Ray during incident response

If the key itself is compromised:

1. revoke the Honeycomb ingest key in Honeycomb
2. rotate `HONEYCOMB_API_KEY` in GitHub, or set `HONEYCOMB_ENABLED=false` first if telemetry must stay off during the incident
3. redeploy the affected stage

## Kill Switch

Honeycomb export is enabled by default when `HONEYCOMB_API_KEY` is present.

To disable export without breaking deployed-stage validation:

1. set GitHub Environment variable `HONEYCOMB_ENABLED=false`
2. redeploy the stage

To re-enable export:

1. remove the override or set `HONEYCOMB_ENABLED=true`
2. redeploy the stage

Telemetry already exported to Honeycomb cannot be withdrawn.
