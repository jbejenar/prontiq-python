# NEXT-WORK.md — Active Sprint

> Last updated: 2026-04-30 for P1C.05 billing page implementation.

## Current Phase

P1C.05: Billing Page. Active branch implements the console `/billing` surface
with a Vercel server-side BFF that reads Lago plans, subscription state, usage
estimates, invoices, and payment links using server-held Lago credentials.
Lago remains plan/billing truth; Prontiq remains usage enforcement and chart
truth.

## Active Commercial Contract

- Clerk `orgId` is the active Prontiq commercial customer identity.
- Lago customer `external_id = orgId`.
- Lago subscription `external_id = lago_sub_${orgId}`.
- Stripe remains only the payment rail configured inside Lago.
- Lago effective charges and entitlements are the source for plan limits; the
  platform stores only a DynamoDB enforcement projection.
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
POST /v1/account/setup            (admin-gated)
GET  /v1/account/status           (member-allowed; P1C.03 PR 2.5)
POST /v1/account/keys/create      (admin-gated; P1C.03 PR 1)
GET  /v1/account/keys             (member-allowed; P1C.03 PR 1)
GET  /v1/account/audit            (member-allowed; P1C.03 PR 5)
GET  /v1/account/usage            (member-allowed; P1C.04)
POST /v1/account/keys/rotate      (admin + reverification; P1C.03 PR 2)
POST /v1/account/keys/revoke      (admin + reverification; P1C.03 PR 2)
```

Console Vercel BFF:

```text
GET  /api/billing/summary
POST /api/billing/checkout
POST /api/billing/invoices/payment-url
```

Retired AWS routes:

```text
GET  /v1/account/billing
POST /v1/account/billing/plan-change
POST /v1/account/billing/portal-session
```

## Current Tickets

- **P1C.03** — complete. Keys page covers missing-org recovery, first-key
  creation, key listing, create/rotate/revoke, Clerk step-up, reveal-once raw
  handling, audit trail, and key-limit indicator.
- **P1C.02** — complete. Overview page is read-only, masked-key safe, and
  routes mutation flows to dedicated pages.
- **P1C.04** — complete. Usage charts use `GET /v1/account/usage`, current
  counters, `prontiq-usage-daily`, Recharts trend views, and CSV export.
- **P1C.05** (active) — billing page. Console BFF reads Lago directly from
  Vercel server-side code. It does not reintroduce AWS billing routes and does
  not mutate subscriptions.
- P1B.23 (pre-go-live cleanup) is gated on P1C.03 + P1C.05.
- **P1C.05a** (follow-up) — replay-safe subscription plan changes after an
  idempotency store and Lago mutation contract are chosen.

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
