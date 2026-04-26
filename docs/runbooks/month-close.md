# Month-Close Runbook

> Historical only. Absorbed by the Lago-centered commercial runtime and P1B.20
> cleanup on 2026-04-26. This file is retained for git history and migration
> context only; it is not an active operator runbook.

`PqMonthClose` is no longer deployed by Prontiq Platform. Lago owns billing
periods and invoicing; local enforcement reads denormalized Lago period fields
from DynamoDB and reconciles them through `POST /webhooks/lago`.

Current operational procedures live in:

- [lago-commercial-ops.md](./lago-commercial-ops.md)
- [lago-webhook-reconciliation.md](./lago-webhook-reconciliation.md)
- [prod-go-live-cleanup.md](./prod-go-live-cleanup.md)
