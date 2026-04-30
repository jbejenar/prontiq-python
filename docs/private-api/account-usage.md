# Account Usage API

Private Clerk-authenticated console API. This endpoint belongs only in
`packages/api/openapi.private.json`; it must not appear in the public Mintlify /
Speakeasy OpenAPI spec.

## `GET /v1/account/usage`

Member-readable endpoint for the active Clerk organization.

Query:

```http
GET /v1/account/usage?granularity=daily
```

`granularity` may be `daily`, `weekly`, or `monthly`. Monthly is the current
billing period in v1.

Current totals come from `prontiq-usage` rows for the active org billing period.
When a key still carries a stale Lago period during reconciliation drift, its
prior-period counter is intentionally excluded from the current-period cards.
When a key has no Lago-period projection yet, any calendar fallback counter for
that key is also excluded from the current-period cards and drift is surfaced.
Chart series primarily come from `prontiq-usage-daily`, which is projected
asynchronously from billing events. The cards are authoritative for the active
period. If projected rows are missing or only partially caught up, the API
returns a single `Current period` aggregate point from the authoritative counter
total instead of an empty or under-reporting chart.

PAYG / uncapped plans return `null` for `quotaCredits`, `remainingCredits`, and
`overageCredits`.

`scopeConsistency = mixed_key_periods` means one or more key records are still
on a different period, or are missing their Lago-period projection, usually
during Lago period reconciliation drift. Current totals still use only the
active org period.
