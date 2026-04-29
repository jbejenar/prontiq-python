# P1B.24 — Lago Source-of-Truth Retrofit and Enforcement Projection

## Intent

Make Lago the commercial source of truth for plans, quotas, included units,
PAYG behaviour, package plans, and plan-code changes. Prontiq remains the
request-time bouncer: API key management, local counters, and DynamoDB-backed
enforcement only.

## Current State

- Active runtime still used local `PLANS` in auth, key management,
  provisioning, Lago webhook reconciliation, and quota email.
- Lago webhook reconciliation rejected plan codes that were not TypeScript
  `Tier` values.
- Private account API and console already expose `maxKeys`; the response shape
  can remain stable while the source changes.
- Existing Lago clients only retrieved subscriptions; they did not read
  effective subscription charges or entitlements.

## Constraints

- API hot path must not call Lago.
- Stripe remains only the payment rail inside Lago.
- Endpoint credit weights remain platform-owned via `BILLING_ENDPOINTS`.
- Lago plan writes are out of scope; this ticket only reads Lago and projects
  local enforcement state.
- Dynamic Lago plan codes such as `payg_aud` and future package plans must not
  require code changes.

## Approach

Add a shared Lago projection layer that reads subscription, effective charges,
and entitlements, then writes a denormalized local enforcement projection onto
the org envelope and active key rows. The platform enforces the projection
locally from the key row so the API hot path remains a single DynamoDB read.

Entitlement keys:

- `api_keys.max`
- `address_api.enabled`
- `address_api.monthly_quota`
- `address_api.rate_limit_per_second`
- `address_api.enforcement_mode`

Projection rules:

- Package charge on `prontiq_address_requests` with finite included units maps
  to capped included credits.
- Standard charge on `prontiq_address_requests` without a finite quota maps to
  PAYG `uncapped_tracked`.
- Missing metric, duplicate metric charge, unsupported charge model, or missing
  bouncer entitlement is projection drift.
- Drift preserves last-known-good state and alerts operators.

## Phases

1. Add shared Lago projection types/client/projector and sanitized fixtures.
2. Retrofit runtime paths to use projected fields instead of `PLANS`.
3. Add manual and scheduled reconciliation, disabled by default.
4. Update architecture, decision records, runbooks, roadmap, and private API
   docs.
5. Run tests, OpenAPI generation, grep audit, and SST diff.

## Documentation Updates

- `ARCHITECTURE.MD`: Lago commercial truth and DynamoDB enforcement projection.
- `docs/decisions/037-lago-entitlements-drive-platform-enforcement.md`: new
  source-of-truth decision.
- `docs/decisions/024-lago-plan-code-equals-tier.md`: superseded.
- `docs/runbooks/lago-commercial-ops.md`: entitlement setup and reconciliation.
- `ROADMAP.md`, `AGENTS.md`, `NEXT-WORK.md`, `NEXT-SESSION.md`: handoff and
  roadmap alignment.
- `docs/private-api/account-keys.md`: key limits are Lago-projected.
- `packages/docs/guides/billing.mdx`: Stripe is payment rail only.

## Test Strategy

- Unit-test Free, PAYG, and package projection fixtures.
- Unit-test manual reconciliation repairs active key rows because auth reads
  key rows, not the org envelope.
- Integration-test webhook/manual reconciliation parity.
- Verify auth enforces hard caps for Free/package and tracks PAYG uncapped.
- Verify key creation uses projected `maxKeys`.
- Verify quota email uses projected included credits.
- Grep active runtime for stale `PLANS[record.tier]`,
  `PLANS[envelope.tier]`, and `tierAllowsOverage`.

## Risk And Rollback

- Bad Lago config may block or over-grant access. Mitigate with dry-run,
  disabled-by-default schedule, last-known-good preservation, and drift alarms.
- Lowered key limits are enforced prospectively only; keys are not revoked.
- Rollback by disabling `LAGO_RECONCILIATION_ENABLED`, reverting runtime code,
  preserving current DDB projection, fixing Lago, and rerunning dry-run/apply.

## Open Questions

None.

## Estimate

Five phases, roughly 4-7 engineering days including dev/prod smoke.

## Checklist

| Phase | Files | Docs |
| --- | --- | --- |
| 1 | `packages/control-plane/src/lago-entitlements.ts` | Yes |
| 2 | `auth.ts`, `key-management.ts`, `provisioning.ts`, `lago-webhook-reconciliation.ts`, `quota-email.ts`, `types.ts` | Yes |
| 3 | `lago-reconcile.ts`, `lago-reconcile.bootstrap.ts`, `sst.config.ts`, workflows | Yes |
| 4 | architecture, decisions, runbooks, roadmap, private API docs | Yes |
| 5 | tests/OpenAPI/generated verification | No |

P1B.24: 5 phases, 9 doc updates, 0 open questions.
