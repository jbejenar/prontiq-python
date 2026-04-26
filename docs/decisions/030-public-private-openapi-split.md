# DEC-030: Split Public and Private OpenAPI Specs

## Status

Accepted.

## Question

Should Clerk-authenticated account/console routes live in the same OpenAPI spec
as the public data API?

## Decision

Maintain two committed OpenAPI specs:

- `packages/docs/openapi.json` is the public data API spec consumed by Mintlify
  public API reference and Speakeasy SDK generation.
- `packages/api/openapi.private.json` is the private account/console API spec
  used by internal frontend and operator work.

## Considered and Rejected

- One combined spec: rejected because it publishes private account routes into
  public docs and SDKs.
- Hidden tags in one spec: rejected because SDK/doc tooling can still drift or
  expose the wrong surface when filters change.
- Handwritten private docs only: rejected because private route schemas would
  drift from the actual `@hono/zod-openapi` contract.

## Consequences

- `packages/api/src/openapi.ts` must mount public customer routes only.
- `packages/api/src/openapi-private.ts` owns private account route generation.
- CI verifies both committed specs are fresh.
- Speakeasy continues to watch only `packages/docs/openapi.json`.
