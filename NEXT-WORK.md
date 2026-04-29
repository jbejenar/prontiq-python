# NEXT-WORK.md — Active Sprint

> Last updated: 2026-04-29 for P1C.03 PR 3. P1B.22 (Clerk org commercial
> identity) shipped in commit 5e6afe2. P1C.03 PRs 0 (backfill), 1 (create +
> list), 2 (rotate + revoke + step-up), and 2.5 (status endpoint + docs) are
> deployed to dev and prod. PR 3 implements the console list/create/recovery UI.

## Current Phase

P1C.03 PR 3: Console keys page for missing-org recovery, first-key creation,
key listing, and reveal-once raw key handling. Next implementation slice is PR
4: rotate/revoke UI with Clerk step-up.

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
POST /v1/account/setup            (admin-gated)
GET  /v1/account/status           (member-allowed; P1C.03 PR 2.5)
POST /v1/account/keys/create      (admin-gated; P1C.03 PR 1)
GET  /v1/account/keys             (member-allowed; P1C.03 PR 1)
POST /v1/account/keys/rotate      (admin + reverification; P1C.03 PR 2)
POST /v1/account/keys/revoke      (admin + reverification; P1C.03 PR 2)
```

Retired AWS routes:

```text
GET  /v1/account/billing
POST /v1/account/billing/plan-change
POST /v1/account/billing/portal-session
```

## Current Tickets

- **P1C.03 PR 3** — console keys page: missing-org → setup → first-key →
  list state machine, reveal-once raw modal. Uses @tanstack/react-query and
  sonner. Console fetches direct from client with Clerk `getToken()` against
  `NEXT_PUBLIC_API_URL`.
- **P1C.03 PR 4** (in review) — rotate / revoke UI with step-up
  modal via `useReverification()`. Operator gate: prod Clerk dashboard
  must emit `fva` claim.
- **P1C.03 PR 5** (last) — audit panel + key-limit indicator. Adds
  `GET /v1/account/audit`.
- P1B.23 (pre-go-live cleanup) is gated on P1C.03 + P1C.05.
- All console billing surfaces remain out of scope for the platform
  backend; future Vercel BFF reads Lago directly.

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
