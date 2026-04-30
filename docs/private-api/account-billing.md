# Account Billing API

Superseded by ADR-035 on 2026-04-27.

The former AWS private account billing routes are retired:

- `GET /v1/account/billing`
- `POST /v1/account/billing/plan-change`
- `POST /v1/account/billing/portal-session`

Active AWS private account routes are setup recovery and key management:
`POST /v1/account/setup`, `GET /v1/account/status`, and
`/v1/account/keys*`. They return or operate on the active Clerk `orgId`
commercial identity. They are documented separately in
`docs/private-api/account-keys.md`.

Console billing is implemented as a Vercel server-side BFF:

- verify Clerk auth server-side
- read the active Clerk `org_id`
- call Lago with a server-held Lago API key
- never expose Lago or Stripe credentials to the browser

Current BFF routes live inside `apps/console`, not the AWS private API:

- `GET /api/billing/summary`
- `POST /api/billing/checkout`
- `POST /api/billing/plan-change`
- `POST /api/billing/invoices/payment-url`

These routes are intentionally not part of `packages/api/openapi.private.json`.
`POST /api/billing/plan-change` uses the retained
`prontiq-billing-actions*` DynamoDB ledger from the Vercel BFF; it does not
revive the retired AWS account billing API.
