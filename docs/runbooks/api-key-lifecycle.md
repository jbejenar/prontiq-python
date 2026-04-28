# API Key Lifecycle Runbook

## Scope

Operating the P1C.03 key-management surface:

- `GET /v1/account/status`
- `GET /v1/account/keys`
- `POST /v1/account/keys/create`
- `POST /v1/account/keys/rotate`
- `POST /v1/account/keys/revoke`

## Required Clerk Token Claims

- `org_id` is required for every account route.
- `org_role` is required for admin gates and `canManageKeys`.
- `fva` is required for rotate/revoke step-up.

Missing `fva` on rotate/revoke is an operator configuration error and returns
`500 STEP_UP_MISCONFIGURED`. Stale `fva[1]` returns Clerk-native
`403 reverification-error` so the console can invoke `useReverification()`.

## Create

Create is admin-only. It writes the key row, increments
`ORG#{orgId}.activeKeyCount`, flips `hasFirstKey=true`, and writes a CREATE
audit row in one transaction.

If users report `KEY_LIMIT_EXCEEDED`, inspect the org envelope:

```bash
aws dynamodb get-item \
  --table-name <keys-table> \
  --key '{"apiKeyHash":{"S":"ORG#<orgId>"}}'
```

`activeKeyCount` should equal the number of active key rows returned by the
`orgId-index` sentinel query.

## Rotate

Rotate preserves `keyId` and original `createdAt`. It deletes the old hash row,
writes the new hash row, writes a REDIRECT row in `prontiq-usage`, migrates
current usage counters to the new hash, and writes ROTATE audit.

Expected REDIRECT fields:

- `apiKeyHash = <oldHash>`
- `scope = REDIRECT`
- `newHash = <newHash>`
- `authValidUntil = now + 5 minutes`
- `ttl = now + 90 days`

Old raw keys should work only during `authValidUntil`. After that they must
return `401 INVALID_API_KEY`.

## Revoke

Revoke sets the live key row `active=false`, sets `revokedAt`, decrements
`activeKeyCount`, and writes REVOKE audit. It does not delete REDIRECT rows.
REVOKE-after-ROTATE is safe because the old raw key re-resolves to the new hash
and then fails the active check.

## Active Key Count Reconciliation

If `activeKeyCount` appears wrong:

1. Query `orgId-index` with sentinel filter
   `attribute_exists(keyPrefix) AND attribute_exists(active)`.
2. Count rows where `active=true`.
3. Compare with `ORG#{orgId}.activeKeyCount`.
4. If different, fix with an audited one-off operator update and record the
   before/after values in the incident notes.

Do not decrement below zero. A failed revoke envelope update with
`activeKeyCount <= 0` indicates counter drift and should be treated as an
operator-visible data integrity issue.

## Known Limitation

HTTP-level retries from a client after a lost create response are not
idempotent. The service is idempotent across retry attempts inside one Lambda
invocation, but a brand-new HTTP request can create a second key. The console
should not automatically retry create after a network error without user action.
