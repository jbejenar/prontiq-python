# ADR-043: Console Playground Native Shell With Scalar Adapter

## Status

Accepted

## Context

P1C.06 adds a console API playground driven by the committed public OpenAPI
spec. The playground must support demo execution without exposing a demo key,
account execution with a raw key held only in memory, production-shaped curl
copy, usage controls, and future public API growth without rewriting the
console each time.

Scalar provides a useful spec-driven API client, but its React wrapper mounts a
long-lived Vue app under `document.body`. That makes it a vendor workbench, not
a normal Prontiq design-system component. Letting Scalar own the page would
make key persistence, styling, modal behaviour, and future UX changes harder to
control.

## Decision

Build `/playground` as a Prontiq-owned console page. Prontiq owns the shell,
mode semantics, memory-only key handling, demo proxy, curl generation,
telemetry boundaries, usage controls, endpoint cards, execution panel, response
viewer, and visual system.

Scalar is allowed only behind `ScalarAdvancedModal` / `ScalarClientAdapter` as
an isolated advanced workbench. Raw account API keys are not prefilled into
Scalar in P1C.06; account execution uses the Prontiq-owned direct fetch panel.

Demo execution uses a same-origin server route with Clerk session validation,
origin checking, public OpenAPI path/method validation, server-held demo API
key, and a fail-closed backend-policy confirmation gate. Demo usage, quota,
rate limiting, billing events, and abuse controls are enforced by the backend
API-key policy attached to the demo key/org. The console is only a controlled
caller.

## Consequences

- The playground remains shippable and useful if Scalar is deferred, visually
  unacceptable, or unsafe for raw-key prefill.
- Future public API operations can appear from the OpenAPI spec without
  hard-coded endpoint components.
- Raw-key handling stays under Prontiq control and follows the console key
  lifecycle rules.
- Demo execution remains unavailable/reference-only until the demo key/org has a
  confirmed safe backend quota/rate policy.
- Scalar upgrades require explicit storage and visual regression checks before
  widening its role.

## Alternatives Considered

- Scalar-owned page: rejected because the page would inherit vendor layout,
  persistence, modal, and CSS behaviour that are too broad for a console surface
  handling API keys.
- Fully custom playground without Scalar: rejected for v1 because Scalar remains
  valuable as an advanced spec-driven workbench once isolated.
- Landing demo proxy reuse: rejected because console demo execution has Clerk
  session, OpenAPI dispatch, and telemetry requirements that differ from the
  anonymous landing autocomplete demo.
- Console-side rate limiting as abuse control: rejected because backend API-key
  enforcement is the platform source of truth for usage, quota, rate limits,
  billing events, and abuse controls. UX-level timeout/cancellation/in-flight
  protection is allowed, but not treated as a security boundary.

---

_Date: 2026-05-03_
_Decision makers: Prontiq engineering_
