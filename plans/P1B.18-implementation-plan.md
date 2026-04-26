# P1B.18 Implementation Plan — Console Billing Proxy Surfaces + Lago Plan Changes

## Intent

Implement the Prontiq-owned account billing API contract that the console will
render later in `P1C.05`: current billing state, current plan, payment-status
messaging, invoice/history access, and admin-triggered Lago Free/PAYG plan
changes without returning to Stripe-first UX.

In one sentence: `P1B.18` gives the console stable Prontiq account-billing
routes backed by local enforcement state, Lago, and a replay-safe action ledger.

## Current State

### Ticket Intake

- `P1B.18` depends on `P1B.18a`.
- `P1B.18a` certified dev/prod Lago usage forwarding and webhook
  reconciliation with retained test-only smoke fixtures.
- `P1C.05` depends on this ticket for the UI contract and must not invent direct
  Lago or Stripe browser coupling.
- The ticket explicitly excludes billing-page UI implementation, enterprise
  contracting workflows, and returning Stripe Checkout or Stripe Customer Portal
  as the long-term self-service contract.

### Code Survey

- `packages/api/src/account-handler.ts` already hosts Clerk-JWT-authenticated
  account routes in the `PqAccount` Lambda.
- `packages/api/src/routes/account.ts` currently owns `/v1/account/setup` and
  the `clerkAdminOnly()` middleware boundary.
- `packages/control-plane/src/lago-webhook-reconciliation.ts` reconciles Lago
  webhooks into local enforcement state.
- `packages/control-plane/src/provisioning.ts` owns customer and organization
  envelope creation.
- `packages/shared/src/types.ts` defines `CustomerRecord`,
  `OrgEnvelopeRecord`, and `ApiKeyRecord`.
- `sst.config.ts` owns the `PqAccount` Lambda, DynamoDB table wiring, deploy
  env validation, and CloudWatch alarms.
- Public OpenAPI generation must stay limited to the public data API. Account
  routes need a separate private spec without changing production route
  isolation.

### Documentation Survey

- `ARCHITECTURE.MD` owns the commercial architecture and Lago migration
  sequence.
- `ROADMAP.md` owns ticket status, dependencies, and acceptance criteria.
- `NEXT-WORK.md` and `NEXT-SESSION.md` own handoff state.
- `docs/decisions/*` contains commercial identity, Lago event, webhook, and
  smoke-generation decisions.
- `docs/runbooks/lago-*` covers Lago event forwarding, webhook reconciliation,
  live smoke, customer sync, and commercial operations.
- `packages/docs/openapi.json` and `packages/docs/api-reference/*` own public
  data API docs. `packages/api/openapi.private.json` owns Clerk-authenticated
  account/console contracts.
- `HINTS.md` files guide future agent work and must record the account-billing
  guardrails.

### Unsupported Assumptions

- The codebase does not yet have account billing routes.
- The codebase does not yet have a mutating account-billing action ledger.
- The private OpenAPI generator does not yet include `PqAccount` routes.
- Existing Lago webhook docs still need to clearly distinguish pending
  transition metadata from active entitlement changes.

## Constraints

- `customerId` remains the Prontiq commercial identity.
- Lago customer `external_id` is `customerId`.
- Lago subscription `external_id` is `pq_sub_<customer ulid>`.
- API request hot path must never call Lago.
- Account billing routes must stay in `PqAccount`, not the address `$default`
  Lambda.
- Account billing mutations require Clerk org-admin auth and `Idempotency-Key`.
- P1B.18 self-service plan targets are `free` and `payg` only.
- Production plan changes stay feature-flagged and org-allowlisted until later
  cutover work.
- Do not forward API keys, request URLs, headers, IPs, user agents, query
  strings, or response payloads to Lago.
- Pending Lago transitions must not change local request-time entitlements.
- Billing evidence rows must not be deleted during rollback.
- Secrets must flow through GitHub Environment secrets/vars and `$util.secret()`
  where secret-valued.

## Approach

### Selected Design

Build a Prontiq account-billing service in `@prontiq/control-plane`, expose it
through `PqAccount`, and record every provider mutation in a DynamoDB
`prontiq-billing-actions` ledger. Use Lago for billing state and payment portal
access, but keep browser and hot-path code talking only to Prontiq-owned APIs.

### Alternatives Considered

- Direct console-to-Lago calls: rejected because the browser would need provider
  coupling and Prontiq would lose a stable contract boundary.
- Stripe Customer Portal as the main account-billing surface: rejected because
  it preserves the superseded Stripe-first UX during a Lago migration.
- No ledger for plan changes: rejected because retries would be unsafe and
  billing support would lack evidence.
- Immediate local downgrade on Lago `pending` transitions: rejected because Lago
  can schedule a future downgrade while current-period entitlement should
  remain active.

## Phases

### Phase 1 — Infra and Shared State

- Add a `prontiq-billing-actions` DynamoDB table with `actionId` primary key,
  `orgId-updatedAt-index`, and TTL.
- Link the table to `PqAccount`.
- Add `BILLING_ACTIONS_TABLE_NAME`,
  `CONSOLE_BILLING_PLAN_CHANGES_ENABLED`,
  `CONSOLE_BILLING_PLAN_CHANGE_ALLOWED_ORG_IDS`, `LAGO_API_KEY`,
  `LAGO_API_URL`, and `LAGO_PAYMENT_PROVIDER_CODE` to `PqAccount`.
- Add pending Lago transition metadata fields to `OrgEnvelopeRecord` and
  `ApiKeyRecord`.
- Rollback: disable the feature flag, revert infra, and retain ledger rows if
  the table was deployed.

### Phase 2 — Control-Plane Account Billing Service

- Add `packages/control-plane/src/account-billing.ts`.
- Implement billing summary lookup from local DynamoDB plus bounded Lago
  subscription retrieval.
- Implement Lago customer create/update using `POST /api/v1/customers`.
- Implement Lago subscription plan change using
  `PUT /api/v1/subscriptions/{external_id}`.
- Implement Lago portal URL retrieval using
  `GET /api/v1/customers/{external_customer_id}/portal_url`.
- Implement idempotency hashing and replay through `prontiq-billing-actions`.
- Implement explicit ledger state handling: successful rows replay only with a
  response body, permanent failures replay as stored failures, and retryable or
  stale in-flight rows are conditionally reclaimable only for the same request
  hash.
- Consult the action ledger before no-op or pending-transition guards so
  same-key replay/resume works after local pending metadata exists; apply those
  guards only to fresh actions.
- Consult existing ledger evidence before live Lago reads for both portal and
  plan-change mutations, so stored replay/failure/resume paths work during Lago
  outages.
- For fresh plan-change actions, check pending transition metadata before
  returning no-op so scheduled transitions are not hidden by unchanged local
  entitlements.
- Store accepted Lago subscription outcomes before local metadata repair so a
  same-key retry can resume local repair without resubmitting the provider
  mutation.
- Rollback: stop callers via feature flag; keep service code inert if routes are
  reverted.

### Phase 3 — Account API Routes and Private OpenAPI

- Add `GET /v1/account/billing`.
- Add `POST /v1/account/billing/plan-change`.
- Add `POST /v1/account/billing/portal-session`.
- Keep routes under `clerkAdminOnly()`.
- Add an account-aware private OpenAPI composition file for internal contract
  generation.
- Regenerate the private OpenAPI spec and keep public OpenAPI free of
  `/v1/account/*` routes.
- Rollback: remove routes and regenerate specs; no data repair required
  unless provider mutations already occurred.

### Phase 4 — Lago Transition Reconciliation Hardening

- Extend Lago subscription parsing for `previous_plan_code`, `next_plan_code`,
  and `downgrade_plan_date`.
- Record pending transition metadata without changing tier, products, quota,
  rate limit, billing period, or overdue state.
- Preserve entitlements on `subscription.terminated` if a current active
  replacement subscription is returned by Lago lookup.
- Clear pending transition metadata when active/inactive terminal reconciliation
  applies.
- Rollback: revert reconciliation changes only after confirming no pending
  transitions depend on the new metadata.

### Phase 5 — Documentation and Handoff

- Update architecture, roadmap, handoff, runbooks, private docs, HINTS, and
  changelog.
- Add decision records for API proxying, the action ledger, and Lago transition
  semantics.
- Rollback: docs must be reverted with code, except decisions may be retained if
  they describe an abandoned/reverted approach.

### Phase 6 — Verification

- Run typechecks, focused tests, integration tests where local dependencies are
  available, OpenAPI generation, diff check, and secret grep.
- Run a targeted documentation grep for stale Stripe-first and pending-downgrade
  wording.
- Rollback: no runtime effect.

## Documentation Updates

- `ARCHITECTURE.MD`: add account billing contract, route ownership, mutation
  safety, and pending transition semantics.
- `ROADMAP.md`: mark `P1B.18` complete, update Lago progress, and make `P1B.19`
  the next Lago migration ticket.
- `NEXT-WORK.md`: update current state, live endpoints, and next-work handoff.
- `NEXT-SESSION.md`: add the session handoff for P1B.18 completion and P1B.19
  start.
- `README.md`: update Lago migration progress and summarize account billing
  APIs.
- `CHANGELOG.md`: add the user-visible account billing API entry.
- `DEC-027`: decide Prontiq-owned account billing APIs over direct Lago/Stripe
  console coupling.
- `DEC-028`: decide a DynamoDB billing-action ledger for mutating billing
  actions.
- `DEC-029`: decide that pending Lago transitions are metadata-only until the
  active replacement state is observed.
- `HINTS.md`: update package/app hints for account-billing route ownership,
  ledger requirements, and console UI boundaries.
- `packages/api/openapi.private.json`: regenerate with account-billing routes.
- `packages/docs/openapi.json`: verify it excludes account-billing routes.
- `docs/private-api/account-billing.md`: document the private account billing
  API contract for internal/frontend use.
- `packages/docs/guides/billing.mdx`: describe account billing as private
  console surfaces, not public API-key endpoints.
- `docs/runbooks/console-billing.md`: add rollout, smoke, failure, and rollback
  procedures.
- `docs/runbooks/lago-webhook-reconciliation.md`: update pending transition
  operator semantics.
- `docs/runbooks/lago-commercial-ops.md`: add account billing mutation guidance.
- `docs/runbooks/lago-customer-sync.md`: add customer payment-provider upsert
  guidance.
- API contract docs: OpenAPI is the contract source; no separate schema doc is
  needed beyond the generated API reference.
- Migration notes: no consumer-breaking migration; feature flag keeps mutation
  rollout controlled.

## Test Strategy

- Unit tests verify Lago client endpoint paths, request bodies, AUD customer
  configuration, subscription update payloads, portal URL parsing, transport
  failure normalization, provider 429/5xx handling, 404 subscription lookup,
  malformed JSON handling, and action-ledger retry semantics.
- Account route integration tests verify Clerk-admin gated billing summary and
  `Idempotency-Key` forwarding plus missing/blank header rejection before
  service dispatch.
- Control-plane integration tests verify pending Lago transitions preserve local
  entitlements and active replacement snapshots prevent false downgrades.
- OpenAPI generation verifies the private spec includes account-billing routes
  and the public spec excludes them.
- Typecheck and lint verify ESM imports, strict TypeScript, and formatting.
- Manual verification after deploy:
  - `GET /v1/account/billing` returns the active test org state.
  - `POST /v1/account/billing/portal-session` returns a Lago portal URL.
  - `POST /v1/account/billing/plan-change` succeeds only for allowlisted test
    orgs and writes a `prontiq-billing-actions` row.
  - Lago webhook reconciliation updates local state after Lago emits the plan
    transition event.

## Risk & Rollback

- Failure mode: missing `PqAccount` IAM/link for `prontiq-billing-actions`.
  Rollback/fix: link the table to `PqAccount`; disable plan changes until
  deployed.
- Failure mode: Lago accepts a plan change but webhook reconciliation lags.
  Rollback/fix: keep local entitlements unchanged, inspect Lago and ledger rows,
  then replay webhook or submit a compensating Lago plan change.
- Failure mode: idempotency key is reused with a different body.
  Rollback/fix: return `IDEMPOTENCY_CONFLICT`; operator must retry with a new
  action only after inspecting the ledger.
- Failure mode: production org is accidentally allowlisted early.
  Rollback/fix: remove the org from
  `CONSOLE_BILLING_PLAN_CHANGE_ALLOWED_ORG_IDS`, redeploy, and audit ledger/Lago
  state.
- Irreversible surface: provider-side Lago changes and customer portal session
  creation are external effects; they must be repaired with compensating Lago
  operations rather than database deletion.

## Open Questions

None for implementation. Production self-service rollout policy remains a later
cutover decision owned by `P1B.19`/`P1B.20`.

## Estimate

- Phase 1: 0.5-1 day, blocked by no unknowns.
- Phase 2: 1.5-2 days, depends on Lago endpoint contract verification.
- Phase 3: 1-1.5 days, depends on route and OpenAPI typing.
- Phase 4: 1 day, depends on existing webhook reconciliation tests.
- Phase 5: 0.5-1 day, depends on full grep audit.
- Phase 6: 0.5-1 day, depends on local DynamoDB/OpenSearch availability.

## File Checklist

| Phase | File                                                                         | Doc update |
| ----- | ---------------------------------------------------------------------------- | ---------- |
| 1     | `sst.config.ts`                                                              | No         |
| 1     | `packages/shared/src/types.ts`                                               | No         |
| 2     | `packages/control-plane/src/account-billing.ts`                              | No         |
| 2     | `packages/control-plane/src/account-billing.test.ts`                         | No         |
| 2     | `packages/control-plane/src/index.ts`                                        | No         |
| 2     | `packages/control-plane/package.json`                                        | No         |
| 3     | `packages/api/src/routes/account.ts`                                         | No         |
| 3     | `packages/api/src/routes/account.integration.test.ts`                        | No         |
| 3     | `packages/api/src/openapi.ts`                                                | No         |
| 3     | `package.json`                                                               | No         |
| 3     | `.github/workflows/ci.yml`                                                   | No         |
| 4     | `packages/control-plane/src/lago-webhook-reconciliation.ts`                  | No         |
| 4     | `packages/control-plane/src/lago-webhook-reconciliation.integration.test.ts` | No         |
| 5     | `ARCHITECTURE.MD`                                                            | Yes        |
| 5     | `ROADMAP.md`                                                                 | Yes        |
| 5     | `NEXT-WORK.md`                                                               | Yes        |
| 5     | `NEXT-SESSION.md`                                                            | Yes        |
| 5     | `README.md`                                                                  | Yes        |
| 5     | `CHANGELOG.md`                                                               | Yes        |
| 5     | `docs/decisions/027-console-billing-account-api.md`                          | Yes        |
| 5     | `docs/decisions/028-billing-action-ledger.md`                                | Yes        |
| 5     | `docs/decisions/029-lago-plan-transition-semantics.md`                       | Yes        |
| 5     | `docs/runbooks/console-billing.md`                                           | Yes        |
| 5     | `docs/runbooks/lago-webhook-reconciliation.md`                               | Yes        |
| 5     | `docs/runbooks/lago-commercial-ops.md`                                       | Yes        |
| 5     | `docs/runbooks/lago-customer-sync.md`                                        | Yes        |
| 5     | `packages/api/HINTS.md`                                                      | Yes        |
| 5     | `packages/control-plane/HINTS.md`                                            | Yes        |
| 5     | `apps/console/HINTS.md`                                                      | Yes        |
| 5     | `packages/docs/guides/billing.mdx`                                           | Yes        |
| 5     | `docs/private-api/account-billing.md`                                        | Yes        |
| 5     | `packages/api/openapi.private.json`                                          | Yes        |
| 5     | `packages/docs/openapi.json`                                                 | Yes        |
| 6     | Verification commands only                                                   | No         |

P1B.18: 6 phases, 22 doc updates, 0 open questions.
