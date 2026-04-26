# DEC-032: Lago Billing Periods Become The Cutover Counter Source

## Status

Accepted.

## Context

The API can already use denormalized Lago billing-period fields when `COUNTER_PERIOD_SOURCE=lago`. Calendar periods were retained during rollout while Lago webhook reconciliation and smoke evidence were being proven.

## Decision

P1B.19 makes `COUNTER_PERIOD_SOURCE=lago` the post-cutover deployed posture. The request path still reads only local DynamoDB fields and falls back to calendar scope if a key lacks `billingPeriodKey`.

## Considered And Rejected

- Keep calendar periods after Stripe retirement: rejected because Lago would own billing periods while local enforcement used a different period model.
- Query Lago synchronously from auth middleware: rejected because no vendor belongs on the hot path.
- Hard-fail requests missing Lago period fields immediately: rejected because calendar fallback is a safer rollback path during cutover verification.

## Consequences

- Cutover preflight must verify active orgs have Lago subscription and billing-period fields.
- New provisioning must bootstrap a Lago Free subscription before returning success.
- Existing Lago-period usage rows remain evidence and are not deleted during rollback.
