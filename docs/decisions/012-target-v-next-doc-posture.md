# ADR-012: Documentation uses target-v-next posture during the Lago migration

## Status

Accepted

## Decision

Canonical architecture and roadmap docs describe the Lago target architecture,
while still explicitly labeling the current Stripe-centric path as legacy shipped
implementation.

## Consequences

- The repo avoids presenting two competing forward-looking billing designs.
- Current live behavior remains documented honestly in API reference and legacy
  runbooks.
