# DEC-023: Lago Billing Periods Are Denormalized Onto Local Counters

## Status

Accepted.

## Context

Prontiq request-time enforcement must stay local and fast. Lago owns commercial
billing periods, but the API hot path cannot call Lago to decide which counter
scope to increment.

## Decision

Lago webhook reconciliation denormalizes current billing-period fields onto
`prontiq-keys` org envelope and API-key rows:

- `billingPeriodStartedAt`
- `billingPeriodEndingAt`
- `billingPeriodKey`

The code keeps `COUNTER_PERIOD_SOURCE=calendar` as the safe default when the
variable is unset. After the P1B.19 cutover, deployed dev/prod environments set
`COUNTER_PERIOD_SOURCE=lago`, so auth middleware increments
`{product}#period#{billingPeriodKey}` if the key has a period key; otherwise it
falls back to calendar scope.

## Considered And Rejected

- **Synchronous Lago period lookup in auth middleware.** Rejected because Lago is
  not allowed on the request path.
- **Immediate hard cutover to Lago periods.** Rejected because deployed
  environments need time to populate period fields and verify reconciliation.
- **Continue calendar-month-only forever.** Rejected because it can diverge from
  Lago subscriptions that do not align to calendar month boundaries.

## Consequences

- Enabling Lago-period scopes was a separate rollout step from deploying the
  webhook; P1B.19 is that rollout step for deployed dev/prod.
- Prior Lago-period rows can be marked `closed=true` by reconciliation when a
  new period key appears.
- PAYG remains uncapped but tracked in the active local scope.
