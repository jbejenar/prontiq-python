# Control Plane Agent Hints

- `customerId` is platform-owned and must remain stable once assigned.
- Existing legacy `ORG#{orgId}` envelopes without `customerId` are valid
  provisioning replays; do not mutate them in the provisioning preflight path.
- Use `backfill:customers` for legacy customer denormalization and inspect dry
  runs before `--apply`.
- Do not add generated `customerId` to Stripe customer-create metadata while
  Stripe idempotency keys are still based only on `orgId`.
