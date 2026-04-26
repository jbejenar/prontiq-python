# ADR-012: Documentation uses target-v-next posture during the Lago migration

## Status

Accepted

## Decision

Canonical architecture and roadmap docs describe the Lago-centered commercial
architecture, while still explicitly labeling the old Stripe-centric path as
legacy shipped implementation and, after P1B.19, rollback-only runtime.

## Consequences

- The repo avoids presenting two competing forward-looking billing designs.
- Current live behavior remains documented honestly in API reference and
  runbooks, including rollback-only legacy Stripe surfaces.
