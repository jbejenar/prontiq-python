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
- confirm account billing plan changes use `docs/runbooks/console-billing.md`
  and are gated by stage flags/allowlists until cutover
- confirm each enabled metric code matches the platform `meterEventName`
- confirm credit metrics aggregate the `credits` property by sum
- confirm subscriptions use `pq_sub_<ulid>` external IDs derived from
  `pq_cust_<ulid>` customer IDs
- confirm PAYG subscriptions produce `quotaPerProduct = null` locally after
  webhook reconciliation
- confirm Prontiq endpoint credit weights match the published Credits guide
- confirm docs, roadmap, and console messaging stay aligned

## Final Production Go-Live Gate

Retained repo-owned production smoke fixtures may support the remaining Lago
migration work if they are clearly labelled/inventoried as test-only. Do not
mutate unrelated Lago organizations or delete useful migration fixtures before
P1B.18, P1B.19, and P1B.20 unless a safety issue requires it.

Before real customer go-live after P1B.20, complete
`docs/runbooks/prod-go-live-cleanup.md`. That gate must inventory repo-owned
prod smoke artifacts, decide whether each is deleted/disabled/relabelled/
retained, recheck production flags and catalog state, and run one final
post-cleanup smoke.
