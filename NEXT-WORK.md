# NEXT-WORK.md — Active Sprint

> Last updated: 2026-04-27 for P1B.22. This file is agent-facing current
> context. Historical P1B.14-P1B.21 customer-id notes were removed because the
> active architecture now uses Clerk org identity.

## Current Phase

P1B.22: Clerk organization commercial identity pivot.

## Active Commercial Contract

- Clerk `orgId` is the active Prontiq commercial customer identity.
- Lago customer `external_id = orgId`.
- Lago subscription `external_id = lago_sub_${orgId}`.
- Stripe remains only the payment rail configured inside Lago.
- The platform keeps hot-path API key auth, credit enforcement, usage counters,
  SQS event production, and webhook reconciliation.
- The platform does not provide active account billing read/mutation APIs.
- Future console billing reads/actions should use a Vercel server-side BFF that
  calls Lago with server-held Lago credentials and Clerk session/org context.

## Live Endpoints

Public data API:

```text
GET /v1/address/autocomplete
GET /v1/address/validate
GET /v1/address/enrich
GET /v1/address/reverse
GET /v1/address/lookup/postcode
GET /v1/address/lookup/suburb
```

Private/control-plane:

```text
POST /webhooks/clerk
POST /webhooks/lago
POST /v1/account/setup
```

Retired AWS routes:

```text
GET  /v1/account/billing
POST /v1/account/billing/plan-change
POST /v1/account/billing/portal-session
```

## Current Tickets

- P1B.22 implements the identity pivot, `BillingUsageEventV2`, Lago smoke
  helper update, commercial identity repair command, account setup-only private
  API surface, and documentation alignment.
- P1C console work should assume billing data comes from Lago through a future
  Vercel BFF, while API keys stay in the platform backend.

## Operator Commands

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm exec node scripts/generate-openapi.mjs
node --test scripts/openapi-boundary.test.mjs
```

Commercial identity repair:

```bash
KEYS_TABLE_NAME=<keys-table> \
pnpm --filter @prontiq/control-plane repair:commercial-identity
```

Apply repair only after reviewing the dry run:

```bash
KEYS_TABLE_NAME=<keys-table> \
LAGO_API_URL=<lago-url> \
LAGO_API_KEY=<lago-api-key> \
LAGO_PAYMENT_PROVIDER_CODE=<stripe-provider-code> \
pnpm --filter @prontiq/control-plane repair:commercial-identity -- --apply
```

Lago live smoke:

```bash
KEYS_TABLE_NAME=<keys-table> \
BILLING_EVENTS_QUEUE_URL=<source-queue-url> \
SMOKE_API_KEY_HASH=<api-key-hash> \
REQUEST_COUNT_AFTER_INCREMENT=1 \
SEND_TO_SQS=true \
STAGE=<dev|prod> \
pnpm --filter @prontiq/control-plane lago:smoke:event
```

## Do Not

- Do not reintroduce generated `pq_cust_*` as the active customer identity.
- Do not make Stripe customer ids or Lago ids the source of truth.
- Do not call Lago from API request handlers.
- Do not add `/v1/account/billing*` to the AWS private API.
- Do not put console billing surfaces in the public OpenAPI spec.
