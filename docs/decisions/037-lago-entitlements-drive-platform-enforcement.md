# DEC-037: Lago Entitlements Drive Platform Enforcement

## Status

Accepted.

## Context

Prontiq now uses Clerk org IDs as the commercial identity and Lago as the
commercial system of record. The previous local `PLANS` registry and
plan-code-equals-tier rule made Prontiq a second source of truth for plan
limits. That fails once operators add PAYG variants, package plans, or
subscription-specific overrides in Lago.

## Decision

Lago effective subscription charges and entitlements drive Prontiq's local
enforcement projection.

Prontiq reads Lago, projects the result onto DynamoDB org/key records, and
enforces that projection locally. API request handlers do not call Lago.

Required bouncer entitlements:

- `api_keys.max`
- `address_api.enabled`
- `address_api.monthly_quota`
- `address_api.rate_limit_per_second`
- `address_api.enforcement_mode`

For enabled address access, `address_api.rate_limit_per_second` must project to
a positive integer. A missing, null, zero, fractional, negative, or non-numeric
rate limit is drift because writing it locally would disable burst limiting on
the API hot path.

Lago plan codes are dynamic strings. Unknown plan code alone is not drift.
Unprojectable charges or entitlements are drift.

Migration compatibility is intentionally narrow: records on legacy
`free`/`payg`/`starter`/`growth`/`max`/`enterprise` tiers that pre-date
projection fields keep their historical `PLANS` behavior until reconciliation
writes a Lago projection. Unknown dynamic Lago plan codes without a projection
fall back to the Free hard-cap posture so new plan mistakes fail safe rather
than silently granting access.

## Considered And Rejected

- **Continue local `PLANS` as commercial truth.** Rejected because it requires
  code changes for commercial plan edits and can diverge from Lago.
- **Require Lago plan code to equal TypeScript tier.** Rejected because PAYG
  variants and package plans need dynamic plan codes.
- **Call Lago from API request handlers.** Rejected because Lago must stay off
  the hot path.
- **Use metadata first.** Rejected because Lago entitlements are the native
  mechanism for plan privileges and subscription overrides.

## Consequences

- DynamoDB remains request-time enforcement state, but it is a projection of
  Lago commercial truth.
- New-org provisioning validates an active Lago Free subscription and its
  projection before committing the first `ORG#{orgId}` envelope. A non-Free,
  inactive, missing, or invalid Lago projection is retryable and must not create
  a local productless org.
- Plan edits in Lago require reconciliation, not a code deploy.
- Billing-period and subscription-status changes require envelope
  reconciliation even when no active keys exist, because the envelope is the
  source for future key creation.
- Local `PLANS` remains only as a legacy-row compatibility fallback and must
  not be used to model new commercial plans.
- Invalid Lago config preserves last-known-good enforcement state and alerts
  operators.
- `DEC-024` is superseded.
