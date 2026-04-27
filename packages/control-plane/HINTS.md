# Control Plane Agent Hints

- Clerk `orgId` is the active commercial customer identity. `customerId`,
  `pq_cust_*`, and `pq_sub_*` are legacy P1B.14-P1B.21 evidence only.
- Use `repair:commercial-identity` to update existing org envelopes/API keys to
  the org-based Lago subscription id; inspect dry runs before `--apply`.
- Do not instantiate Stripe for provisioning. P1B.20 removed direct
  platform-owned Stripe runtime paths; Stripe exists only as the payment rail
  configured inside Lago.
- Forward provisioning must bootstrap the Lago Free subscription, write
  denormalized Lago period fields onto the org envelope/API keys, and keep
  persisted `stripeCustomerId` nullable/historical only.
- Lago event forwarding must remain replay-safe: use `eventId` as Lago
  `transaction_id`, derive `external_subscription_id` as `lago_sub_${orgId}`,
  and write delivery evidence before/after send attempts.
- For P1B.18a live smoke, use
  `pnpm --filter @prontiq/control-plane lago:smoke:event` so
  `BillingUsageEventV2.eventId` is derived through the production contract. The
  CLI prints only the safe evidence object; do not add raw keys or API-key
  hashes to docs, PRs, or session notes.
- Lago webhook reconciliation must remain replay-safe: verify HMAC before
  claiming, use `X-Lago-Unique-Key` as the ledger key, and treat same-key /
  different-payload delivery as drift.
- P1B.18a is complete. Preserve the completed dev/prod webhook-ledger evidence.
  P1B.21 has retired the retained prod smoke API key.
- Lago plan codes map directly to Prontiq tiers. Unknown plan codes must fail
  closed; do not silently downgrade to Free or grant PAYG.
- Pending Lago plan transitions must not change local request-time entitlements.
  Record pending metadata and wait for the active replacement snapshot before
  changing `tier`, products, quota, rate limit, or billing-period fields.
- AWS account billing mutations are retired. Future console billing belongs in a
  Vercel server-side BFF that verifies Clerk auth and calls Lago server-side.
- Do not mutate Stripe registries from Lago webhook reconciliation.
- Do not mutate existing non-canonical Lago organizations during platform
  tests. P1B.18a live smoke work may create repo-owned test
  customers/subscriptions in the canonical environment orgs, or dedicated
  repo-owned test orgs only when isolation is required.
- The P1B.21-retired prod smoke key with prefix `pq_live_4a85` must not be
  reused or reactivated. The linked prod smoke customer/subscription, usage row,
  delivery rows, and webhook rows are retained as audit evidence only. Future
  prod smoke requires a new labelled probe and a new ticket. Do not delete
  delivery/webhook ledger evidence or real customer rows during cleanup without
  a dedicated decision.
