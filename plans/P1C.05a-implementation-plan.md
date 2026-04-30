# P1C.05a — Replay-safe Lago Plan Changes

## Intent

Let org admins change Lago plans from the console Billing page with replay
safety, step-up protection, and clean reconciliation into local API
enforcement.

## Current State

- Console billing uses a Vercel BFF for summary, checkout, and invoice payment
  links.
- Checkout creates a Lago/Stripe payment setup URL only; it does not mutate the
  subscription.
- Lago customer external id is Clerk `orgId`.
- Lago subscription external id is `lago_sub_${orgId}`.
- Local API enforcement reads DynamoDB bouncer projection and is updated by Lago
  webhook reconciliation.
- `prontiq-billing-actions*` exists and is reused for Vercel billing action
  evidence.

## Constraints

- Lago is the source of truth for plans, prices, subscriptions, PAYG/free/package
  behavior, invoices, and payment provider state.
- Prontiq owns API keys, request-time enforcement, local usage counters, queued
  usage events, and webhook reconciliation.
- Browser code must not call Lago, Stripe, or DynamoDB.
- Do not reintroduce AWS `/v1/account/billing*`.
- Do not change public OpenAPI, private OpenAPI, or SDKs.
- Plan changes must be same-origin, org-admin-only, feature-flagged,
  allowlist-gated in prod initially, and Clerk step-up protected.
- Local enforcement changes only after Lago webhook/reconcile.

## Approach

Use the console Vercel BFF as the orchestration boundary. The BFF records a
replay-safe action row and an org-level mutation lock in
`prontiq-billing-actions*`, then calls Lago's upgrade/downgrade flow:
`POST /api/v1/subscriptions` with `external_id = lago_sub_${orgId}` and the
target `plan_code`.

Before the Lago mutation, the route writes a `provider_in_flight` fence with a
per-attempt token. Expired pre-provider `processing` rows can be reclaimed, but
`provider_in_flight` rows replay as manual-reconcile evidence and cannot call
Lago again without operator inspection.

The route returns accepted, pending, or noop state from Lago. Local bouncer
state remains unchanged until Lago webhook reconciliation updates DynamoDB.

## Phases

1. Ledger and lock: add the console billing-action DynamoDB helper, env contract,
   scoped AWS client, and action/lock state machine.
2. Route: add billing step-up, Lago subscription mutation, and
   `POST /api/billing/plan-change`.
3. UI: change plan cards to call the new route through Clerk
   `useReverification()` and an `Idempotency-Key`.
4. Docs: update architecture, decisions, runbooks, roadmap, and handoff docs.
5. Demo key audit: document `PRONTIQ_LANDING_DEMO_API_KEY` for the landing
   Vercel project.

## Documentation Updates

- `ARCHITECTURE.MD`: console plan-change BFF, replay ledger, org lock, step-up,
  pending Lago transitions, and webhook reconciliation.
- `docs/decisions/040-vercel-billing-action-ledger.md`: decision for
  Vercel-to-DynamoDB billing actions.
- `docs/decisions/028-billing-action-ledger.md`: clarify the ledger is reused
  by Vercel billing mutations.
- `docs/runbooks/console-billing.md`: env, IAM, plan-change smoke, replay,
  lock recovery, webhook lag, and rollback.
- `docs/runbooks/lago-webhook-reconciliation.md`: post-plan-change verification.
- `docs/private-api/account-billing.md`: keep AWS billing routes retired.
- `apps/console/HINTS.md` and `apps/console/README.md`: BFF plan-change rules
  and env vars.
- `apps/landing/README.md`: landing demo API key requirement.
- `packages/docs/guides/billing.mdx`: customer-facing Lago-backed plan-change
  note.
- `ROADMAP.md`, `NEXT-WORK.md`, `NEXT-SESSION.md`: status and evidence.

## Test Strategy

- Ledger tests: claim, replay, conflict, org lock, strongly consistent reads,
  stale pre-provider `processing` lock/retryable local state, provider boundary
  fencing, per-attempt token conditions, immutable terminal rows,
  provider-accepted replay, `provider_in_flight` replay, permanent failures,
  and `outcome_unknown` replay.
- Billing auth tests: missing/malformed/stale/fresh `fva` and Clerk-native
  reverification body.
- Lago client tests: `POST /subscriptions` request shape and pending transition
  parsing.
- Route tests: origin, auth, admin, feature flag, allowlist, idempotency,
  target validation, current noop, pending guard, lock contention, and stored
  replay.
- UI tests: admin change, member disabled, step-up retry, no
  `STEP_UP_MISCONFIGURED` loop, pending badge, payment setup fallback, and
  checkout/invoice regression.
- Dev smoke: PAYG to Starter, duplicate replay, concurrent double-click,
  pending downgrade, Lago webhook reconciliation, DDB bouncer projection, and
  API enforcement headers after reconciliation.

## Risk & Rollback

- Duplicate Lago mutation: prevented by action ledger plus org lock, terminal
  row immutability, provider-in-flight fencing, per-attempt tokens, and strongly
  consistent idempotency reads.
- Ledger unavailable before claim: return `BILLING_ACTION_LEDGER_UNAVAILABLE`
  and do not call Lago.
- Lago accepted but final write failed: do not mark the action as failed or
  release the lock; retry returns `LAGO_PLAN_CHANGE_OUTCOME_UNKNOWN`, and an
  operator must inspect Lago state before any new plan-change action.
- Lago/provider outcome ambiguous after a claimed action: store terminal
  `outcome_unknown` evidence when the error is caught; leave unfinalized
  provider-boundary attempts as `provider_in_flight`; require operator Lago
  inspection/reconciliation before a fresh action.
- Webhook lag: UI reports reconciliation pending; operator replays Lago webhook
  or runs `lago:reconcile`.
- Step-up misconfigured: fail loud with `STEP_UP_MISCONFIGURED`.
- Bad rollout: disable `PRONTIQ_BILLING_PLAN_CHANGES_ENABLED`.

## Open Questions

None.

## Estimate

- Ledger and route: 2-2.5 days.
- UI and tests: 1 day.
- Docs and smoke: 1-1.5 days.

## Checklist

| Phase | Files / Areas | Docs |
| --- | --- | --- |
| 1 | Console ledger, env, deps | Yes |
| 2 | Billing auth, Lago client, service, route | Yes |
| 3 | Billing API client, UI, tests | Yes |
| 4 | Architecture, decisions, runbooks, roadmap, handoff | Yes |
| 5 | Landing demo env docs | Yes |

`P1C.05a: 5 phases, 13 doc updates, 0 open questions.`
