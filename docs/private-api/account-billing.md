# Private Account Billing API

The account billing routes are private console/admin API contracts. They are
documented in `packages/api/openapi.private.json`, not in the public Mintlify
OpenAPI spec and not in the Speakeasy-generated SDK.

## Routes

- `POST /v1/account/setup` recovers or initializes the active Clerk
  organization envelope.
- `GET /v1/account/billing` returns current local billing state for the active
  organization.
- `POST /v1/account/billing/plan-change` submits a replay-safe Free/PAYG plan
  change.
- `POST /v1/account/billing/portal-session` creates a Lago portal URL for
  invoice and payment-management actions.

All routes run in the `PqAccount` Lambda and require Clerk org-admin auth.
Mutating billing routes also require `Idempotency-Key`.

## Authentication

Send the user's Clerk session token as `Authorization: Bearer <jwt>`.

Required JWT claims:

| Claim      | Purpose                                      |
| ---------- | -------------------------------------------- |
| `sub`      | Clerk user id for primary-email resolution   |
| `org_id`   | Active Clerk organization id                 |
| `org_role` | Admin-role gate for all `/v1/account/*` APIs |

Operator prerequisite for both dev and prod Clerk tenants: the session-token JWT
template must include both fields:

```json
{
  "org_id": "{{org.id}}",
  "org_role": "{{org.role}}"
}
```

The frontend must call `setActive({ organization })` before invoking account
routes; otherwise Clerk omits active-org claims. Missing `org_id` returns
`400 NO_ACTIVE_ORG`. Missing `org_role` returns `400 NO_ROLE_CLAIM`.

Default admin roles are `org:admin` and `admin`; `CLERK_ADMIN_ROLES` can
override this for the `PqAccount` Lambda and Clerk webhook together.

## Account Setup

`POST /v1/account/setup` is the idempotent recovery path when the Clerk webhook
missed delivery. It runs the same `createProvisioningService().provisionOrg(...)`
path as `POST /webhooks/clerk`, so a delayed webhook plus a recovery call
collapse to one envelope, one Prontiq `customerId`, one Lago Free subscription
in forward mode, and one audit row. The migration-era `stripeCustomerId` field
is nullable because Stripe is the payment rail, not the customer source of
truth.

Response contract:

- `201 { "status": "created", "customerId": "pq_cust_...", "stripeCustomerId": null, "emailSent": true }`
  means a new envelope was committed and forward-mode Lago bootstrap completed.
  `emailSent: false` is non-fatal.
- `200 { "status": "already_exists", "customerId": "pq_cust_...", "stripeCustomerId": null }`
  means the envelope already existed and no duplicate side effects occurred.
  During explicit rollback, `stripeCustomerId` can be a `cus_...` value.
- `400 NO_ACTIVE_ORG` or `400 NO_ROLE_CLAIM` are Clerk session/template fixes.
- `401 INVALID_TOKEN` is a missing, expired, or invalid session token.
- `403 INSUFFICIENT_ROLE` means the caller is not an org admin.
- `409 CUSTOMER_MAPPING_MISSING` means a legacy org envelope exists without
  `customerId`; run the customer backfill/repair path before retrying.
- `503 RETRYABLE_FAILURE` can be retried with the same active org.
- `500 FATAL_FAILURE` requires operator investigation.

## Billing Mutations

`POST /v1/account/billing/plan-change` and
`POST /v1/account/billing/portal-session` require `Idempotency-Key`. Same-key
and same-body replays return stored results. Same-key and different-body
replays return `IDEMPOTENCY_CONFLICT`.

## Spec Boundary

- Public spec: `packages/docs/openapi.json`.
- Private spec: `packages/api/openapi.private.json`.
- Public SDK generation watches only the public spec.
- Account routes must not be mounted in `packages/api/src/openapi.ts`.

Use `pnpm generate:openapi` after changing public or private route contracts.
