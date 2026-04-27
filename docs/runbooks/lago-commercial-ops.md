# Lago Commercial Operations Runbook

Target-state operator guidance for plan, pricing, and credit-weight changes in
the Lago commercial architecture.

## Purpose

In the target architecture:

- Lago owns plans and commercial pricing
- Prontiq owns endpoint credit weights and request-time enforcement

## Change rules

- keep public pricing aligned to the current business direction: Free + PAYG
- do not canonize illustrative plan/package values from historical planning
- treat endpoint credit-weight changes as commercial changes that require
  coordinated documentation updates

## Verification

- confirm plan metadata in Lago matches the intended commercial surface
- confirm plan codes exactly match Prontiq tiers (`free`, `payg`, etc.)
- confirm Lago customers use AUD currency before exposing self-service billing
  through a future console BFF
- confirm console billing changes use `docs/runbooks/console-billing.md`
  and do not reintroduce platform-owned account billing routes
- confirm each enabled metric code matches the platform `meterEventName`
- confirm credit metrics aggregate the `credits` property by sum
- confirm subscriptions use `lago_sub_${orgId}` external IDs derived from
  Clerk org IDs
- confirm PAYG subscriptions produce `quotaPerProduct = null` locally after
  webhook reconciliation
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
