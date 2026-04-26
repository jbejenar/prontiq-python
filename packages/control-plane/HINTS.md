# Control Plane Agent Hints

- `customerId` is platform-owned and must remain stable once assigned.
- Existing legacy `ORG#{orgId}` envelopes without `customerId` are valid
  provisioning replays; do not mutate them in the provisioning preflight path.
- Use `backfill:customers` for legacy customer denormalization and inspect dry
  runs before `--apply`.
- Do not add generated `customerId` to Stripe customer-create metadata while
  Stripe idempotency keys are still based only on `orgId`.
- Lago event forwarding must remain replay-safe: use `eventId` as Lago
  `transaction_id`, derive `external_subscription_id` from `customerId`, and
  write delivery evidence before/after send attempts.
- For P1B.18a live smoke, use
  `pnpm --filter @prontiq/control-plane lago:smoke:event` so
  `BillingUsageEventV1.eventId` is derived through the production contract. The
  CLI prints only the safe evidence object; do not add raw keys or API-key
  hashes to docs, PRs, or session notes.
- Lago webhook reconciliation must remain replay-safe: verify HMAC before
  claiming, use `X-Lago-Unique-Key` as the ledger key, and treat same-key /
  different-payload delivery as drift.
- P1B.18a is complete. Preserve the completed dev/prod webhook-ledger evidence
  and retained smoke fixtures until the P1B.21 cleanup gate.
- Lago plan codes map directly to Prontiq tiers. Unknown plan codes must fail
  closed; do not silently downgrade to Free or grant PAYG.
- Do not mutate Stripe registries from Lago webhook reconciliation.
- Do not mutate existing non-canonical Lago organizations during platform
  tests. P1B.18a live smoke work may create repo-owned test
  customers/subscriptions in the canonical environment orgs, or dedicated
  repo-owned test orgs only when isolation is required.
- Retained prod smoke fixtures may support P1B.18, P1B.19, and P1B.20, but
  must stay clearly labelled/inventoried as repo-owned test-only data. P1B.21
  owns final deletion, disablement, relabelling, or explicit retention before
  real customer go-live. Do not delete delivery/webhook ledger evidence or real
  customer rows during cleanup without a dedicated decision.
