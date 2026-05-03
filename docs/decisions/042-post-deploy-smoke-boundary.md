# DEC-042 — Post-Deploy Smoke Boundary

## Status

Accepted.

## Context

P1F.04 extends deploy verification so dev and prod deploys exercise the public
Address API after SST deploy completes. Existing Clerk-authenticated account
smokes are useful in dev but are not durable in prod because prod Clerk hardens
against Backend SDK session creation without a live operator session.

Some smokes are safe every deploy. Others mutate commercial state or require a
real browser/step-up flow and must stay operator-run.

## Decision

Classify every smoke by both category and stage scope:

- `ci-every-deploy`: runs automatically after deploy.
- `runbook-on-demand`: operator-run certification or incident tool.
- `manual-ui-only`: browser/user-flow verification that cannot be represented
  by backend tokens.

The public Address API smoke is `ci-every-deploy` in both dev and prod. It uses
only `X-Api-Key` against the deployed stage URL and a dedicated labelled smoke
org/key.

Clerk-authenticated account/key/usage smokes remain dev-only CI checks. Prod
private-account verification remains manual UI unless a future ticket ships a
durable prod-safe auth path.

Lago live event smoke remains runbook-only. It creates billing delivery evidence
and must stay deliberate.

## Considered And Rejected

- Running prod Clerk account smokes in CI: rejected because prod Clerk session
  creation is not durable under current hardening.
- Running Lago smoke on every deploy: rejected because it intentionally mutates
  billing delivery evidence and is a certification/runbook action.
- Keeping Address API smoke operator-only: rejected because the public API is
  the customer hot path and regressions should fail the deploy workflow.

## Consequences

Dev deploys verify both public Address API and private account surfaces.

Prod deploys verify the public customer hot path automatically; private account
flows remain manual.

Dedicated smoke keys are operational fixtures and must be rotated or replaced
without touching retired migration keys.
