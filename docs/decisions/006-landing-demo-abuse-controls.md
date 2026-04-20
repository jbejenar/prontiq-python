# ADR-006: Landing demo abuse control is progressive rate limiting, not CAPTCHA-first

## Status

Accepted

## Context

The `P1C.01` landing demo is a public unauthenticated surface. That means it can be abused for request amplification or simple scraping. The question is how much protection belongs in the first shipped version without turning the demo into a hostile conversion experience.

## Decision

Ship progressive proxy-side abuse controls in `apps/landing`:

- server-issued anonymous demo-session cookie buckets for per-visitor isolation
- coarse per-instance token-bucket rate limiting as a secondary shared guard until a trusted client-IP primitive exists at the app boundary
- atomic route-level limiter accounting so shared-guard rejections do not drain a visitor's personal demo bucket
- strict query-length checks
- strict suggestion-limit caps
- whitelist-only param forwarding
- deterministic `429` + `Retry-After`
- structured logging for throttle hits

Do **not** add CAPTCHA or a challenge step in `P1C.01`.

If real traffic later shows the limiter is insufficient, evaluate a dedicated challenge mechanism as a follow-up.

## Consequences

### Positive

- Keeps the first-run demo flow fast and low-friction.
- Preserves isolation for legitimate visitors without trusting spoofable forwarding headers.
- Provides an immediate abuse-control baseline without introducing third-party challenge UX.
- Keeps the implementation app-local and ticket-scoped.
- Fails closed instead of trusting spoofable forwarding headers for client identity.

### Negative

- Anonymous demo-session cookies are still not a strong abuse identity and can be rotated by a determined client.
- The secondary shared limiter is still coarse for all demo traffic on an instance until a trusted client-IP primitive is wired.
- The two-stage limiter is intentionally fail-closed and coordinated in the app layer, which adds a little more state-handling complexity.
- The limiter is per-instance, not globally distributed.
- Determined abuse may still require a stronger edge or challenge-layer defense later.
- Logging and operational follow-up become important for tuning the limits.

## Alternatives Considered

### 1. Add CAPTCHA immediately

Rejected. It makes the demo conversion path materially worse before there is evidence the lighter control is insufficient.

### 2. No abuse controls in v1

Rejected. A public demo proxy without rate limiting is an avoidable mistake.

### 3. Build a globally distributed abuse-control layer now

Rejected. That is a larger infrastructure decision than `P1C.01` needs.
