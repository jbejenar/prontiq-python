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
- Do not mutate existing non-canonical Lago organizations during platform
  tests. Create P1B.16-specific test orgs only when a live Lago smoke test needs
  isolation.
