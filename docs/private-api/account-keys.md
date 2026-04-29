# Account Key Management API

This is the private Clerk-authenticated console API. It belongs only in
`packages/api/openapi.private.json`; it must not appear in the public Mintlify /
Speakeasy OpenAPI spec.

## Auth Model

- `Authorization: Bearer <clerk_jwt>` is required for every route.
- The Clerk session must have an active organization so `org_id` is present.
- `org_role` controls management rights. Reads are member-allowed; mutations are
  admin-only via `CLERK_ADMIN_ROLES`.
- Rotate and revoke also require recent second-factor reverification through the
  Clerk `fva` claim.

## Routes

### `GET /v1/account/status`

Member-allowed state endpoint for the console.

Missing envelope response:

```json
{
  "orgId": "org_...",
  "orgRole": "org:admin",
  "canManageKeys": true,
  "provisioned": false
}
```

Provisioned response:

```json
{
  "orgId": "org_...",
  "orgRole": "org:admin",
  "canManageKeys": true,
  "provisioned": true,
  "hasFirstKey": false,
  "activeKeyCount": 0,
  "tier": "free",
  "maxKeys": 2
}
```

### `GET /v1/account/keys`

Member-allowed list endpoint. Returns active key metadata only.

```json
{
  "keys": [
    {
      "keyId": "key_01HX...",
      "keyPrefix": "pq_live_ab12",
      "label": "Production",
      "createdAt": "2026-04-29T00:00:00.000Z",
      "lastUsedAt": null,
      "active": true,
      "products": ["address"]
    }
  ]
}
```

Never returns `raw` or `apiKeyHash`.

### `GET /v1/account/audit`

Member-allowed audit endpoint. Returns the latest API-key lifecycle events
(`CREATE`, `ROTATE`, `REVOKE`) for the active organization, newest first.

```json
{
  "events": [
    {
      "action": "CREATE",
      "actorId": "user_...",
      "timestamp": "2026-04-29T00:00:00.000Z",
      "metadata": { "keyId": "key_01HX...", "label": "Production" },
      "ip": "203.0.113.10",
      "userAgent": "Mozilla/5.0 ..."
    }
  ]
}
```

The console displays actor, timestamp, action, and IP. `metadata` is allowlisted
for public fields such as `keyId` and `label`; internal fields such as
`apiKeyHash` and `oldApiKeyHash` are never returned. Hashes remain in DynamoDB
audit rows for operator correlation only.

### `POST /v1/account/keys/create`

Admin-only. Optional body:

```json
{ "label": "Production" }
```

Success:

```json
{
  "keyId": "key_01HX...",
  "raw": "pq_live_...",
  "keyPrefix": "pq_live_ab12",
  "createdAt": "2026-04-29T00:00:00.000Z",
  "label": "Production"
}
```

The raw key is returned once and is never persisted.

Common failures:

- `403 INSUFFICIENT_ROLE`
- `403 KEY_LIMIT_EXCEEDED`
- `404 ORG_NOT_PROVISIONED`

### `POST /v1/account/keys/rotate`

Admin-only plus step-up. Body:

```json
{ "keyId": "key_01HX..." }
```

Success:

```json
{
  "keyId": "key_01HX...",
  "raw": "pq_live_...",
  "keyPrefix": "pq_live_cd34",
  "createdAt": "2026-04-29T00:00:00.000Z",
  "rotatedAt": "2026-04-29T00:05:00.000Z"
}
```

The old raw key remains valid for the REDIRECT auth grace window, currently five
minutes, then returns `401 INVALID_API_KEY`.

Common failures:

- `403 INSUFFICIENT_ROLE`
- `403 { "clerk_error": { "type": "forbidden", "reason": "reverification-error", "metadata": { "reverification": { "level": "second_factor", "afterMinutes": 10 } } } }`
- `404 KEY_NOT_FOUND`
- `500 STEP_UP_MISCONFIGURED`

### `POST /v1/account/keys/revoke`

Admin-only plus step-up. Body:

```json
{ "keyId": "key_01HX..." }
```

Success:

```json
{
  "keyId": "key_01HX...",
  "revokedAt": "2026-04-29T00:10:00.000Z"
}
```

Common failures:

- `403 INSUFFICIENT_ROLE`
- `403 { "clerk_error": { "type": "forbidden", "reason": "reverification-error", "metadata": { "reverification": { "level": "second_factor", "afterMinutes": 10 } } } }`
- `404 KEY_NOT_FOUND`
- `409 KEY_ALREADY_REVOKED`
- `500 STEP_UP_MISCONFIGURED`

## Security Notes

- Raw keys are never logged, persisted, or returned by list/status endpoints.
- `keyId` is the stable UI/API identifier; `keyPrefix` is display-only.
- `apiKeyHash` stays server-side.
- The public data API remains API-key-authenticated and does not accept Clerk
  JWTs.
