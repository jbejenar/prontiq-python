# DEC-024: Lago Plan Code Equals Prontiq Tier

## Status

Accepted.

## Context

Webhook reconciliation must translate Lago subscription state into local
enforcement state. A separate mapping table would add another mutable contract
during migration.

## Decision

Lago plan `code` values must equal Prontiq `Tier` values, for example `free` and
`payg`.

Unknown Lago plan codes are reconciliation drift. The webhook records the drift
and returns 500 so Lago retries while operators fix the Lago plan or platform
configuration.

## Considered And Rejected

- **Separate Lago-to-Prontiq plan mapping config.** Rejected for v1 because it
  creates an additional source of truth and can silently mis-map paid access.
- **Default unknown plan codes to Free.** Rejected because it can downgrade
  paying customers silently.
- **Default unknown plan codes to PAYG.** Rejected because it can grant uncapped
  access silently.

## Consequences

- Lago plan creation must use platform tier names exactly.
- The legacy `starter`, `growth`, and `max` tier values remain valid only for
  migration-era records; the current commercial direction is Free + PAYG.
- Operators must resolve plan-code drift before replaying failed Lago webhooks.
