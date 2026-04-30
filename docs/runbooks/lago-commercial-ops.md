# Lago Commercial Operations Runbook

Target-state operator guidance for plan, pricing, and credit-weight changes in
the Lago commercial architecture.

## Purpose

In the target architecture:

- Lago owns plans and commercial pricing
- Lago owns plan quantities, PAYG/package behavior, and bouncer entitlements
- Prontiq owns endpoint credit weights and request-time enforcement from the
  local DynamoDB projection

## Change rules

- keep public pricing aligned to the current business direction: Free + PAYG
- add package/pack plans in Lago without adding TypeScript tier values
- treat endpoint credit-weight changes as commercial changes that require
  coordinated documentation updates
- keep `prontiq_address_requests` as the address API metric unless the
  platform meter contract is intentionally changed

## Verification

- confirm effective subscription charges and entitlements project cleanly
- confirm plan codes are meaningful operator labels; they do not need to match
  Prontiq TypeScript tiers
- confirm each subscription has these entitlements where applicable:
  `api_keys.max`, `address_api.enabled`, `address_api.monthly_quota`,
  `address_api.rate_limit_per_second`, and `address_api.enforcement_mode`
- confirm `address_api.rate_limit_per_second` is a positive integer for every
  enabled address product. Do not use blank/null/0/fractional values to mean
  "unlimited"; that is drift and should preserve last-known-good enforcement.
- confirm new-org provisioning has an active Lago Free subscription and valid
  Lago Free projection before the local `ORG#{orgId}` envelope exists. If
  bootstrap/projection fails, retry the webhook or `/v1/account/setup`; do not
  manually create productless local org envelopes.
- confirm Lago customers use AUD currency before exposing self-service billing
  through a future console BFF
- confirm console billing changes use `docs/runbooks/console-billing.md`
  and do not reintroduce platform-owned account billing routes
- confirm console-visible plans carry `prontiq_console_visible=true` in Lago
  metadata. Use `prontiq_environment=dev|prod|all` to scope visibility and
  `prontiq_test=true` or `prontiq_internal=true` to hide test/internal plans.
  Do not rely on plan names like `TEST - ...` for filtering.
- confirm Free, PAYG, and pack/package plans expose their actual Lago charges;
  the console billing page renders those charges dynamically and must not use a
  hard-coded plan catalog.
- confirm each enabled metric code matches the platform `meterEventName`
- confirm credit metrics aggregate the `credits` property by sum
- confirm subscriptions use `lago_sub_${orgId}` external IDs derived from
  Clerk org IDs
- confirm PAYG subscriptions produce `quotaPerProduct = null` and
  `enforcementMode = uncapped_tracked` locally after reconciliation
- confirm any legacy-tier rows missing projection fields still behave according
  to their historical `PLANS` fallback, while unknown dynamic plan codes without
  projection are Free/hard-capped until reconciliation applies
- run reconciliation in dry-run before enabling scheduled apply:
  `pnpm --filter @prontiq/control-plane lago:reconcile -- --org <orgId> --dry-run`
- confirm apply updates the full `ORG#<orgId>` envelope projection, including
  plan/status and current billing-period fields, even if the org has no active
  keys; active API key rows are repaired separately because request-time auth
  reads the key row projection and does not call Lago
- enable scheduled reconciliation only after dry-run and webhook evidence are
  clean; `LAGO_RECONCILIATION_ENABLED=false` is the safe default
- confirm Prontiq endpoint credit weights match the published Credits guide
- confirm docs, roadmap, and console messaging stay aligned

## Final Production Go-Live Gate

P1B.21 completed the final production go-live cleanup on 2026-04-27. The
retained production smoke key with prefix `pq_live_4a85` is disabled and must
not be reused. The related customer/subscription and ledger rows are retained as
audit evidence only.

For the completed evidence, read
`docs/operations/p1b21-prod-go-live-cleanup-evidence.md`. For future production
probe creation or cleanup, use `docs/runbooks/prod-go-live-cleanup.md` and
create a new labelled probe under a new ticket.
