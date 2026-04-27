# Account Billing API

Superseded by ADR-035 on 2026-04-27.

The former AWS private account billing routes are retired:

- `GET /v1/account/billing`
- `POST /v1/account/billing/plan-change`
- `POST /v1/account/billing/portal-session`

The only active AWS private account route is `POST /v1/account/setup`, which
returns the active Clerk `orgId` commercial identity.

Future console billing should be implemented as a Vercel server-side BFF:

- verify Clerk auth server-side
- read the active Clerk `org_id`
- call Lago with a server-held Lago API key
- never expose Lago or Stripe credentials to the browser
