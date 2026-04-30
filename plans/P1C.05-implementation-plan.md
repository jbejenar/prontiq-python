# P1C.05 Implementation Plan

## Intent

Build the console Billing page as a Lago-backed Vercel server-side BFF surface. Users can view current billing state, visible Lago plans, billing usage estimates, invoices, and payment links without exposing Lago or Stripe credentials and without reintroducing AWS `/v1/account/billing*` routes.

## Current State

- `apps/console` has keys, overview, and usage pages.
- AWS private billing routes are retired and must remain retired.
- Lago is the billing source of truth. Stripe is only the payment rail inside Lago.
- Vercel supplies `LAGO_API_URL` and `LAGO_API_KEY`; the console app must validate and use them server-side only.

## Constraints

- Browser code must never call Lago or Stripe directly.
- `LAGO_API_KEY` must never be exposed through public env, client bundles, UI, logs, or DTOs.
- Do not add `/v1/account/billing*` to the AWS API or private OpenAPI spec.
- Do not hard-code plans, prices, quotas, PAYG/package semantics, or local `PLANS` values.
- Plan catalog visibility is Lago metadata-driven.
- P1C.05 does not mutate subscriptions. Replay-safe plan changes are deferred to P1C.05a.

## Approach

Add Next.js route handlers under `apps/console/app/api/billing/*`. Each route verifies Clerk server auth, reads the active org context, and calls Lago using server-held credentials. The customer external id is the Clerk org id, and the subscription external id is `lago_sub_${orgId}`.

## Phases

1. Add console-local Lago client, billing env validation, and Clerk billing auth helpers.
2. Add BFF routes for summary, checkout URL, and invoice payment URL.
3. Add `/billing` UI with current subscription, usage estimate, dynamic Lago plan cards, invoices, and admin-only payment actions.
4. Update architecture, runbooks, roadmap, and console docs. Add P1C.05a follow-up for subscription plan changes.

## Documentation Updates

- `ARCHITECTURE.MD`: console billing BFF now implemented.
- `ROADMAP.md`: mark P1C.04 complete, mark P1C.05 in progress/implemented for review, add P1C.05a.
- `NEXT-WORK.md`: move active sprint to P1C.05.
- `apps/console/HINTS.md` and `apps/console/README.md`: document BFF, env vars, and Lago metadata filtering.
- `docs/runbooks/console-billing.md`: add operator checks, endpoints, and smoke steps.
- `docs/runbooks/lago-commercial-ops.md`: add plan metadata requirements.
- `docs/private-api/account-billing.md`: keep AWS billing routes retired and point to the Vercel BFF.
- `docs/decisions/039-console-billing-bff-native-lago-rendering.md`: record the boundary decision.

## Test Strategy

- Console unit tests cover Lago response mapping, metadata plan filtering, summary composition, and invoice ownership checks.
- Console component tests cover billing page states and payment actions.
- Existing retired AWS billing route tests must continue to pass.
- Run `pnpm --filter console typecheck`, `pnpm --filter console test`, and repo-level verification before PR.

## Risk & Rollback

- Hidden or misconfigured Lago plan metadata can hide all plans. The UI shows an operator-facing empty state instead of hard-coded fallback plans.
- Checkout can be mistaken for a plan change. UI copy explicitly says it only sets up payment method; subscription mutation is deferred.
- Lago outage affects only the billing page; keys and usage remain independent.
- Rollback is a normal PR revert because this ticket adds no persisted state and no subscription mutations.

## Open Questions

None blocking for P1C.05. P1C.05a must choose the idempotency store and exact Lago subscription mutation workflow before implementing plan changes.

## Estimate

4-5.5 engineering days.

## File Checklist

| Phase | Files / Areas | Doc Update |
| --- | --- | --- |
| 1 | `apps/console/lib/billing-*`, `apps/console/lib/server-env.ts` | No |
| 2 | `apps/console/app/api/billing/*` | No |
| 3 | `apps/console/app/(dashboard)/billing/*`, console nav/overview | No |
| 4 | `ROADMAP.md`, `NEXT-WORK.md`, `ARCHITECTURE.MD`, runbooks, ADR, README/HINTS | Yes |

`P1C.05: 4 phases, 9 doc updates, 0 blocking open questions.`
