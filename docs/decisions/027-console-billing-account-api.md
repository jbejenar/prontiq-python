# DEC-027: Console Billing Uses the Prontiq Account API

## Status

Superseded by [ADR-035](035-clerk-org-commercial-identity.md) for active runtime.

This ADR is retained as historical P1B.18-P1B.21 migration context only. Active
AWS private account API is setup-only; future console billing reads/actions use
a Vercel BFF calling Lago with server-held credentials.

## Question

Should the console call Lago/Stripe directly for billing screens, or should it
call Prontiq-owned account APIs?

## Decision

The console calls Prontiq-owned `/v1/account/billing*` routes. Those routes are
Clerk-org-admin authenticated and proxy the allowed Lago billing operations.

## Considered and Rejected

- Direct Lago calls from the browser: rejected because it exposes provider
  coupling and credential boundaries to the frontend.
- Direct Stripe-hosted UX as the target contract: rejected because Stripe is the
  payment rail only in the Lago architecture.
- Backend proxy through the existing address API Lambda: rejected because it
  would put control-plane dependencies in the hot-path bundle.

## Consequences

- `PqAccount` owns account billing routes.
- The private OpenAPI spec describes Prontiq account APIs as the stable console
  contract; public docs and SDKs do not expose these Clerk-authenticated routes.
- `P1C.05` must render these APIs rather than direct Lago/Stripe behavior.
