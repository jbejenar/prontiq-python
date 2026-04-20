# ADR-005: The landing-page demo uses a landing-side proxy

## Status

Accepted

## Context

`P1C.01` requires a live autocomplete demo on `prontiq.dev`. The demo must feel real, but the repo already treats API-key exposure in client-side code as unacceptable. The hero demo also needs to remain distinct from the public backend contract: this ticket is a frontend surface, not a backend-public-demo-endpoint ticket.

## Decision

Use a constrained proxy route in `apps/landing` for the hero demo:

- browser traffic goes to `GET /api/demo/address/autocomplete`
- the landing app forwards only whitelisted autocomplete query params
- the landing app uses a server-only `PRONTIQ_LANDING_DEMO_API_KEY`
- the browser never receives or stores that key

The landing hero consumes `@prontiq/web-component` in proxy mode by pointing it at the landing route, not at `api.prontiq.dev` with a client-side key.

## Consequences

### Positive

- Keeps privileged credentials out of client-side code.
- Preserves the ticket boundary: no new public backend demo endpoint is required.
- Lets the landing page apply its own abuse controls and deterministic fallback behavior.
- Reuses the same widget contract the docs/plugins can use later.

### Negative

- Introduces landing-side server runtime logic into an otherwise SSG-first app.
- Adds an additional route and env seam to the landing app.
- Creates a dependency on the widget supporting endpoint override, not just direct API-key mode.

## Alternatives Considered

### 1. Public unauthenticated backend demo endpoint

Rejected. It expands backend surface area and public-demo semantics in a ticket that should stay frontend-scoped.

### 2. Client-side constrained demo key

Rejected. It still puts a credential in the browser and conflicts with the repo’s explicit guidance against client-side API key exposure.

### 3. Static or simulated hero demo

Rejected. `P1C.01` explicitly needs a live demo, not a fake interaction.
