# ADR-036: Opaque API Key IDs

## Status

Accepted on 2026-04-29 for P1C.03.

## Context

The platform stores API keys by SHA-256 hash and returns raw key material only
once. Console users still need a stable identifier for list, rotate, revoke, and
audit operations. Neither the raw key, the hash, nor the display prefix is safe
or correct as that identifier.

## Decision

Every API key row has a stable opaque `keyId` with this shape:

```text
key_<ulid>
```

`keyId` is generated when the key is created and is preserved across rotation.
Rotate deletes the old hash row and writes the new hash row with the same
`keyId`. Revoke targets the key by `keyId` inside the caller's Clerk org.

## Considered and Rejected

- Use `keyPrefix`: rejected because it is display-only, may collide, and leaks
  part of the credential.
- Use `apiKeyHash`: rejected because exposing a secret-derived hash to the
  browser unnecessarily expands the attack surface and makes logs/audit harder
  to reason about.
- Use raw key: rejected because raw key material is returned once only and is
  never stored.
- Generate a new id on rotation: rejected because audit history, UI rows, and
  customer mental model should treat rotation as credential replacement for the
  same key identity.

## Consequences

- Existing key rows required a one-off backfill before P1C.03 create/list
  deployed.
- Service methods locate keys by `keyId` within the caller's `orgId`, not by a
  global unauthenticated id lookup.
- Very large enterprise key counts may later need a `keyId` GSI; current lookup
  is an org-scoped query plus filter and is acceptable for the planned limits.
