# P1B.14 Implementation Plan — CustomerId + Customer Mapping Contract

> Historical implementation plan. Its "Current State" section describes the
> repo before P1B.14 and before the later Lago cutover. P1B.20 removed the
> platform-owned Stripe webhook, billing cron, and month-close from active
> deploys.

## Intent

Define one stable, platform-owned, org-scoped `customerId` contract across Clerk, Prontiq, Lago, and migration-era Stripe so downstream billing, console, and reconciliation work has one customer identity model.

## Current State

- `P1B.14` depends on completed `P1B.05`; downstream tickets `P1B.15`-`P1B.18` depend on this customer identity contract.
- Live provisioning writes `ORG#{orgId}` rows in `prontiq-keys` through `createProvisioningService().provisionOrg(...)`, with `stripeCustomerId`, `ownerEmail`, `tier`, `products`, `paymentOverdue`, `stripeSubscriptionId`, `subscriptionItems`, `hasFirstKey`, and `completedAt`.
- `packages/shared/src/types.ts` has `ApiKeyRecord` and `OrgEnvelopeRecord` with Stripe linkage but no `customerId` or customer mapping type.
- API-key auth currently performs one `prontiq-keys` read on the hot path, then increments `prontiq-usage`; no customer table exists and no customer-table read should be added to the hot path later.
- At the time this plan was written, legacy Stripe billing was live:
  `PqBillingCron` ran hourly, `PqMonthClose` ran monthly at
  `cron(30 0 1 * ? *)`, and Stripe webhooks reconciled subscription/payment
  state. This is historical context only after P1B.20.
- Infra currently declares `prontiq-keys`, `prontiq-usage`, `prontiq-audit`, and `prontiq-ses-suppressions`; no `prontiq-customers` table exists.
- At the time this plan was written, docs said Lago was the target commercial
  system, but the shared `customerId` model was still pending in runtime.
- Official Lago docs define a Lago-owned `lago_id` and application-provided customer `external_id`; this plan uses `external_id = customerId`.

## Constraints

- No runtime code, migrations, infra resources, queues, Lambdas, API endpoints, or feature flags in `P1B.14`.
- Do not change or break live Stripe provisioning, Stripe webhook, billing cron, month-close, Clerk webhook, account setup, API-key auth, quota enforcement, or SES flows.
- Do not put Lago on the request path.
- Do not require a `prontiq-customers` lookup during API-key-authenticated requests.
- Stripe IDs are nullable migration/payment-rail linkage only.
- Lago `lago_id` is provider-owned cache data only.
- Future GDPR/account deletion docs must include `prontiq-customers`.
- `prontiq-platform` owns the customer mapping contract; `prontiq-lago` owns Lago hosting, not Prontiq's durable customer identity mapping.

## Approach

- Define platform customer IDs as opaque `pq_cust_<ulid>` values.
- Define future `prontiq-customers` table keyed by `orgId`, with `customerId-index` for reverse lookup by Lago/customer-facing events.
- Define required mapping fields: `orgId`, `customerId`, `lagoExternalCustomerId`, `lagoCustomerId`, `stripeCustomerId`, `ownerEmail`, `status`, `createdAt`, `updatedAt`, and optional `backfilledAt`, `archivedAt`, `conflictReason`.
- Define `lagoExternalCustomerId = customerId`; store Lago's `lago_id` as nullable `lagoCustomerId`.
- Define lifecycle `status` as `active | archived | migration_conflict`; keep billing delinquency in billing/enforcement state, not customer lifecycle.
- Require later runtime tickets to denormalize `customerId` onto `ORG#{orgId}` envelopes and API key records so hot-path billing-event emission does not require customer-table reads.
- Backfill plan: preserve existing mapping by `orgId`; otherwise derive from `ORG#{orgId}`; preserve existing `stripeCustomerId`; create exactly one `customerId` per org; mark conflicts for operator review rather than creating duplicate Lago identities.
- Rejected: Clerk `orgId` as `customerId`, because it couples commercial identity to the auth vendor.
- Rejected: Stripe customer ID as `customerId`, because Stripe is no longer the commercial source of truth.
- Rejected: Lago `lago_id` as `customerId`, because it is provider-owned and unavailable before Lago customer creation.
- Rejected: `ORG#{orgId}` as the canonical customer mapping, because it is a provisioning envelope in the key table, not the long-term customer mapping table.

## Phases

| Phase | Work                                          | Files                                                         | Contracts                                                                             | Migration | Rollback              |
| ----- | --------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------- | --------------------- |
| 1     | Create the plan artifact after syncing `main` | `plans/P1B.14-implementation-plan.md`                         | None                                                                                  | None      | Delete the plan file  |
| 2     | Add decision records                          | ADR-013/014/015                                               | Customer id ownership, customer table ownership, Lago external id mapping             | None      | Revert ADR files      |
| 3     | Update architecture and target contracts      | Architecture, Billing guide, frontend strategy, Lago runbooks | Customer table shape, resolution rules, hot-path denormalization rule, backfill rules | Plan only | Revert docs           |
| 4     | Update roadmap and handoff docs               | Roadmap, next-work, README, AGENTS, changelog, next-session   | Mark P1B.14 complete after docs land; promote P1B.15                                  | None      | Revert docs           |
| 5     | Verify consistency                            | No new files                                                  | Static contract checks                                                                | None      | Fix docs before merge |

## Documentation Updates

| File                                                        | Update                | Summary                                                                                                                   |
| ----------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `plans/P1B.14-implementation-plan.md`                       | Create                | Committable implementation-plan artifact.                                                                                 |
| `docs/decisions/013-platform-owned-customer-id.md`          | Create                | Decision: platform-owned `pq_cust_<ulid>`; reject Clerk, Stripe, and Lago IDs.                                            |
| `docs/decisions/014-dedicated-customers-table.md`           | Create                | Decision: dedicated `prontiq-customers` mapping table; reject using `ORG#{orgId}` as canonical customer table.            |
| `docs/decisions/015-lago-external-id-equals-customer-id.md` | Create                | Decision: Lago `external_id = customerId`; Lago `lago_id` is nullable provider cache.                                     |
| `ARCHITECTURE.MD`                                           | Modify                | Add customer identity contract, table shape, resolution flow, denormalization rule, backfill rules, GDPR deletion update. |
| `docs/FRONTEND-STRATEGY.md`                                 | Modify                | Replace pending `customerId` wording with the defined target contract for future console work.                            |
| `packages/docs/guides/billing.mdx`                          | Modify                | Move `customerId` from pending target wording to defined target contract; state runtime implementation lands later.       |
| `docs/runbooks/lago-customer-sync.md`                       | Modify                | Add lookup, creation, conflict, and verification steps for customer mapping.                                              |
| `docs/runbooks/lago-billing-events.md`                      | Modify                | Require queued billing events to carry the P1B.14 `customerId`.                                                           |
| `docs/runbooks/lago-webhook-reconciliation.md`              | Modify                | Resolve Lago events by external customer id equal to `customerId`.                                                        |
| `ROADMAP.md`                                                | Modify                | Close P1B.14 after contract docs land, update counts, and expand ticket evidence with table/backfill details.             |
| `NEXT-WORK.md`                                              | Modify                | Promote P1B.15; keep SES production access as background operator follow-up.                                              |
| `README.md`                                                 | Modify                | Update roadmap counts and Lago migration progress.                                                                        |
| `AGENTS.md`                                                 | Modify                | Add rule: `customerId` is platform identity; provider IDs are linkage only.                                               |
| `CHANGELOG.md`                                              | Modify                | Add unreleased note for the customer identity contract.                                                                   |
| `NEXT-SESSION.md`                                           | Modify                | Record P1B.14 closure and P1B.15 handoff.                                                                                 |
| HINTS.md                                                    | No change             | Existing app HINTS already warn against Stripe-forward billing; no new app override needed.                               |
| Package READMEs                                             | No change             | No package runtime surface changes in this ticket.                                                                        |
| OpenAPI/API docs                                            | No change             | No endpoint schema or response shape changes in P1B.14.                                                                   |
| Migration notes                                             | Covered in docs above | Backfill and conflict handling live in `ARCHITECTURE.MD` and `lago-customer-sync.md`.                                     |

## Test Strategy

- Run Prettier check on all touched Markdown/MDX files.
- Run roadmap integrity check for ticket headings, ids, counts, and completed totals.
- Grep regression: no non-legacy doc describes Stripe as the customer source of truth.
- Grep contract: `customerId`, `lagoExternalCustomerId`, `lagoCustomerId`, and `stripeCustomerId` wording is consistent across architecture, billing guide, and runbooks.
- Manual review: confirm `P1B.15`-`P1B.18` can consume `customerId` without redefining identity semantics.
- No unit, integration, or E2E runtime tests are required because `P1B.14` ships no code.

## Risk & Rollback

- Risk: docs imply runtime support already exists. Mitigation: every public-facing doc must distinguish "contract defined" from "runtime implemented in later tickets." Rollback: revert docs PR.
- Risk: future implementation adds `prontiq-customers` reads to the request path. Mitigation: architecture must require denormalized `customerId` on org envelopes and API key records. Rollback: revert docs PR.
- Risk: customer lifecycle status gets confused with billing/payment state. Mitigation: lifecycle statuses stay limited to mapping lifecycle; payment overdue remains separate. Rollback: revert docs PR.
- Risk: backfill creates duplicate commercial identities. Mitigation: conflict status and operator review are required for duplicate `stripeCustomerId`, duplicate `orgId`, or existing mismatched `customerId`. Rollback: docs-only until later migration ticket.
- Irreversible changes: none in `P1B.14`.

## Open Questions

- Blocking questions: none.
- Deferred to `P1B.15`, owner `prontiq-platform`: exact SQS billing-event schema and deterministic event identity.
- Deferred to `P1B.16`, owner `prontiq-lago` operator / Lago docs: verify the deployed Lago version supports current documented customer `external_id` semantics.
- Deferred to `P1B.19`, owner operator: inventory real production Stripe customers before legacy billing cutover.
- Deferred to account deletion ticket, owner platform: exact purge script behavior for `prontiq-customers`.

## Estimate

| Phase | Effort       | Sequencing              | Blockers                              |
| ----- | ------------ | ----------------------- | ------------------------------------- |
| 1     | 0.25 day     | First                   | Local branch must be synced to `main` |
| 2     | 0.5 day      | After phase 1           | None                                  |
| 3     | 0.75-1 day   | After ADRs              | None                                  |
| 4     | 0.25-0.5 day | After architecture docs | Roadmap count care                    |
| 5     | 0.25 day     | Last                    | None                                  |

## File Checklist

| Phase | File                                                        | Action | Doc Update |
| ----- | ----------------------------------------------------------- | ------ | ---------- |
| 1     | `plans/P1B.14-implementation-plan.md`                       | Create | Yes        |
| 2     | `docs/decisions/013-platform-owned-customer-id.md`          | Create | Yes        |
| 2     | `docs/decisions/014-dedicated-customers-table.md`           | Create | Yes        |
| 2     | `docs/decisions/015-lago-external-id-equals-customer-id.md` | Create | Yes        |
| 3     | `ARCHITECTURE.MD`                                           | Modify | Yes        |
| 3     | `docs/FRONTEND-STRATEGY.md`                                 | Modify | Yes        |
| 3     | `packages/docs/guides/billing.mdx`                          | Modify | Yes        |
| 3     | `docs/runbooks/lago-customer-sync.md`                       | Modify | Yes        |
| 3     | `docs/runbooks/lago-billing-events.md`                      | Modify | Yes        |
| 3     | `docs/runbooks/lago-webhook-reconciliation.md`              | Modify | Yes        |
| 4     | `ROADMAP.md`                                                | Modify | Yes        |
| 4     | `NEXT-WORK.md`                                              | Modify | Yes        |
| 4     | `README.md`                                                 | Modify | Yes        |
| 4     | `AGENTS.md`                                                 | Modify | Yes        |
| 4     | `CHANGELOG.md`                                              | Modify | Yes        |
| 4     | `NEXT-SESSION.md`                                           | Modify | Yes        |

`P1B.14: 5 phases, 16 doc updates, 0 blocking open questions.`
