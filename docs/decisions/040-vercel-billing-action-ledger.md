# DEC-040: Vercel Billing Actions Use the DynamoDB Ledger

## Status

Superseded by DEC-041 for active plan-change mutations. Historical context
only.

## Question

Where should replay evidence for console-initiated Lago plan changes live now
that account billing routes are a Vercel BFF instead of AWS `/v1/account/*`?

## Historical Decision

`apps/console` writes replay-safe billing action evidence directly to the
existing `prontiq-billing-actions*` DynamoDB table from Vercel server-side route
handlers. The Vercel credential is dedicated to this table and may only read,
write, query, transact, and delete rows in the billing action ledger.

This was replaced by DEC-041 before go-live. The active implementation moved
the same ledger semantics into `POST /v1/account/billing/plan-change`, so
Vercel no longer needs DynamoDB credentials for plan changes.

Each plan-change request uses a browser-generated `Idempotency-Key`. The BFF
stores one action row keyed by `orgId + route + Idempotency-Key` and one
org-level lock row keyed by `LOCK#billing.plan-change#${orgId}`. The action row
protects browser/Vercel retries; the lock row prevents two different
idempotency keys from racing into two Lago mutations for the same org.

Lago remains the billing source of truth. The BFF records provider acceptance
and returns a pending reconciliation state. Local API enforcement changes only
after Lago webhook reconciliation updates DynamoDB.

Terminal action rows are immutable at the ledger condition level. The BFF uses
strongly consistent reads for idempotency decisions, replays
`provider_accepted`, `provider_in_flight`, `failed_permanent`, and
`outcome_unknown`, and only reclaims `failed_retryable` or expired
pre-provider `processing` rows. Immediately before the Lago mutation, the BFF
transitions the action and org lock to `provider_in_flight` with a per-attempt
token. If the process dies, times out, Lago runs longer than the pre-provider
lease, or success finalization fails, same-key retries replay a manual-reconcile
response and do not submit another Lago mutation. Ambiguous Lago or transport
failures that are caught by the route are finalized as terminal
`outcome_unknown` rows. An operator must inspect Lago and reconcile state before
a new billing action is attempted.

## Historical Options Considered

- Reintroduce AWS `/v1/account/billing/plan-change`: originally rejected while
  account billing routes were retired in favor of the console BFF; accepted
  later by DEC-041 after the architecture was corrected so browser plan
  changes use the same Clerk-JWT account API pattern as key management.
- Use Lago-only idempotency: rejected because Prontiq needs request-hash
  conflict detection and durable customer-action evidence.
- Let Vercel update local bouncer projection directly: rejected because that
  duplicates Lago reconciliation logic outside the control plane.
- Use only per-click idempotency without an org lock: rejected because two
  different clicks could race and submit conflicting Lago plan changes.
- Reclaim expired provider-in-flight rows automatically: rejected because the
  Lago mutation is not provider-idempotent under a stable Prontiq key.

## Historical Consequences

- At the time, Vercel Preview and Production needed dedicated billing-action
  AWS credentials. DEC-041 removes that requirement; Vercel no longer needs
  DynamoDB credentials for plan changes.
- `prontiq-billing-actions*` became active replay evidence for billing
  mutations. DEC-041 keeps the table active but moves all writes behind the
  private account API.
- Plan changes are safe to replay with the same `Idempotency-Key`; terminal
  outcomes do not trigger another Lago mutation.
- Unknown Lago outcomes are terminal `outcome_unknown` rows, not retryable
  provider failures.
- Unfinalized `provider_in_flight` rows block same-key retries and different-key
  plan changes until Lago state is inspected or the original attempt finalizes.
- Different requests with the same `Idempotency-Key` return
  `IDEMPOTENCY_CONFLICT`.
- Concurrent different plan-change actions for the same org return
  `ACTION_IN_PROGRESS` until the lock is released; provider-in-flight locks are
  deliberately long-lived manual-reconcile fences.
