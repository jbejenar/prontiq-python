# @prontiq/observability

Shared backend observability package for Prontiq.

This package owns Honeycomb trace export, Lambda handler wrapping, bounded span
attributes, and manual span helpers for backend services.

Scope for `P1F.03`:

- Honeycomb backend traces for deployed Lambdas
- no-op behavior when `HONEYCOMB_API_KEY` is unset
- no browser telemetry
- no ECS/Fargate telemetry
- no log export
