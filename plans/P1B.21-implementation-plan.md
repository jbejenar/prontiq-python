# P1B.21 Implementation Plan

## Intent

Close the Lago migration go-live gate by inventorying retained production smoke
fixtures, running one final API-originated prod smoke, disabling the retained
prod smoke API key, and documenting the final commercial runtime posture without
recording secrets.

## Current State

- P1B.20 removed the platform-owned legacy Stripe runtime and deploy config.
- Prod billing events are enabled and use Lago-period counter scopes.
- The retained repo-owned prod smoke fixture is:
  - org: `org_prontiq_platform_lago_smoke_prod`
  - customer: `pq_cust_01KQ3TT9XZZDR2CAZTV1TX1KBS`
  - subscription: `pq_sub_01KQ3TT9XZZDR2CAZTV1TX1KBS`
  - key prefix: `pq_live_4a85`
- Local ignored smoke files exist for operator use only and must not be
  committed or quoted.

## Constraints

- Do not commit raw API keys, API-key hashes, Lago API keys, webhook secrets,
  private customer data, or local secret-file contents.
- Do not delete delivery-ledger or webhook-ledger rows.
- Do not mutate unrelated Lago organizations used by other repos.
- Keep Lago and Stripe off the API hot path.
- Keep final runtime posture as `BILLING_EVENTS_ENABLED=true`,
  `COUNTER_PERIOD_SOURCE=lago`, and
  `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true` unless a rollback ticket changes
  it.

## Approach

Use the existing retained prod smoke API key for exactly one final
API-originated billing smoke, verify the resulting delivery-ledger row is
accepted, then disable only that key by setting `active=false`. Retain customer,
usage, delivery, webhook, and Lago customer/subscription evidence for audit and
replay analysis.

Rejected alternatives:

- Hard-delete all smoke evidence: rejected because it destroys replay/debug
  evidence for the Lago migration.
- Leave the smoke API key active as an operational probe: rejected because there
  are no customers yet and a live reusable prod key is unnecessary risk.
- Cancel/delete the Lago smoke subscription: rejected because the subscription
  is linked to already accepted migration evidence and does not admit requests
  once the platform API key is disabled.

## Phases

### Phase 1 — Inventory And Precheck

- Read the retained prod smoke key/customer/usage state from DynamoDB using
  local ignored operator env.
- Re-derive the candidate final smoke event ID and verify it does not already
  exist in `prontiq-billing-event-deliveries`.
- Verify prod GitHub Environment and live Lambda rollout flags.
- Verify source queue, DLQ, and CloudWatch alarm state.

### Phase 2 — Final Smoke And Key Disablement

- Send one low-risk `address.validate` request through `api.prontiq.dev`.
- Verify the API returns `200`.
- Verify the new delivery row is `accepted`.
- Set only the retained smoke API key `active=false` with a conditional
  DynamoDB update against safe fixture identifiers.
- Verify the raw key now returns `401 INVALID_API_KEY`.

### Phase 3 — Documentation Closeout

- Add safe evidence under `docs/operations/`.
- Add a decision record for disabling the key and retaining audit evidence.
- Mark P1B.21 complete in the roadmap and handoff docs.
- Update runbooks and package hints so future agents do not reuse retired prod
  smoke credentials.

## Documentation Updates

- `ARCHITECTURE.MD`: record that the Lago migration is complete and prod smoke
  API access is retired.
- `ROADMAP.md`: mark P1B.21 complete and update the Lago migration count to
  `9/9`.
- `NEXT-WORK.md`: move recommended next work beyond the Lago migration.
- `NEXT-SESSION.md`: add the P1B.21 closeout session.
- `README.md`: update progress counts and current commercial posture.
- `CHANGELOG.md`: add the P1B.21 closeout.
- `docs/decisions/034-prod-smoke-fixture-disposition.md`: capture the fixture
  disposition decision.
- `docs/operations/p1b21-prod-go-live-cleanup-evidence.md`: record safe
  evidence and verification results.
- `docs/runbooks/prod-go-live-cleanup.md`: convert from pre-cleanup checklist to
  reusable closeout/rollback guidance.
- `docs/runbooks/lago-live-smoke.md`: record that prod smoke fixtures are now
  retired.
- `docs/runbooks/lago-commercial-ops.md`: remove stale spliced alarm text and
  point to the P1B.21 evidence.
- `packages/api/HINTS.md` and `packages/control-plane/HINTS.md`: prevent future
  reuse of retired prod smoke fixtures.

No public OpenAPI, private OpenAPI, SDK, package README, schema, or code changes
are required.

## Test Strategy

- Run markdown-safe repo searches for stale `P1B.21` pending/deferred language.
- Run `pnpm format:check`.
- Run targeted documentation lint/search checks for secret leakage patterns.
- Live verification:
  - prod API health returned `200`
  - final prod smoke returned `200`
  - delivery row `bevt_f7833d581725b732d04d3eed3fd7c484` reached `accepted`
  - source queue and DLQ were empty
  - CloudWatch had no alarms in `ALARM`
  - disabled key returned `401 INVALID_API_KEY`

## Risk & Rollback

- If the final smoke fails, leave the key disabled and stop customer go-live
  until the delivery row and queues are diagnosed.
- If disabling the key breaks a needed future prod probe, create a new labelled
  one through a new ticket rather than reactivating the historical key.
- If billing-event emission must be stopped, set `BILLING_EVENTS_ENABLED=false`
  and redeploy prod.

## Open Questions

None.

## Estimate

- Phase 1: 1-2 hours.
- Phase 2: 1 hour.
- Phase 3: 2-4 hours.

## File Checklist

| Phase | File                                                     | Doc update |
| ----- | -------------------------------------------------------- | ---------- |
| 1     | `plans/P1B.21-implementation-plan.md`                    | Yes        |
| 2     | `docs/operations/p1b21-prod-go-live-cleanup-evidence.md` | Yes        |
| 3     | `docs/decisions/034-prod-smoke-fixture-disposition.md`   | Yes        |
| 3     | `ROADMAP.md`                                             | Yes        |
| 3     | `NEXT-WORK.md`                                           | Yes        |
| 3     | `NEXT-SESSION.md`                                        | Yes        |
| 3     | `README.md`                                              | Yes        |
| 3     | `CHANGELOG.md`                                           | Yes        |
| 3     | `ARCHITECTURE.MD`                                        | Yes        |
| 3     | `docs/runbooks/prod-go-live-cleanup.md`                  | Yes        |
| 3     | `docs/runbooks/lago-live-smoke.md`                       | Yes        |
| 3     | `docs/runbooks/lago-commercial-ops.md`                   | Yes        |
| 3     | `packages/api/HINTS.md`                                  | Yes        |
| 3     | `packages/control-plane/HINTS.md`                        | Yes        |

P1B.21: 3 phases, 12 doc updates, 0 open questions.
