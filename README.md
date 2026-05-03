# Prontiq Platform

> Australian address validation powered by G-NAF.

Prontiq is starting with developer-friendly Australian address validation. The broader open data platform roadmap is tracked in [`ROADMAP.md`](ROADMAP.md).

## Current Product

| Product                        | Endpoint        | Data Source | Status                       |
| ------------------------------ | --------------- | ----------- | ---------------------------- |
| **Address Validation** (G-NAF) | `/v1/address/*` | data.gov.au | Live — 15M docs, 6 endpoints |

Live at `https://api.prontiq.dev`. Docs at `https://docs.prontiq.dev`. TypeScript SDK auto-generated to `sdks/typescript/` (npm publish pending). The ratified frontend architecture is a two-app model. `prontiq.dev` now has a live landing page with a proxy-backed autocomplete demo, config-owned Free/PAYG pricing cards, and a Clerk sign-up modal; `console.prontiq.dev` carries the env-gated authenticated app shell. Runtime billing is Lago-centered; Stripe remains only the payment rail configured inside Lago. See `ARCHITECTURE.MD` for the canonical target state.

SES suppression handling is live, but full transactional-email production
readiness is tracked by `P1B.08a`: custom MAIL FROM on `bounce.prontiq.dev` and
DMARC relaxed SPF alignment are configured; SES production-access approval and
one normal-recipient send verification remain.

### Server-to-server surface

| Endpoint                 | Purpose                                                                                                                                                                                                                           | Auth                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `POST /webhooks/clerk`   | Clerk `organizationMembership.created` → ORG envelope provisioning. Bootstraps the Lago Free subscription with the Clerk org id as the commercial identity. See `docs/runbooks/clerk-webhook.md`.                                    | Svix signature (no API key)                         |
| `POST /webhooks/lago`    | Lago subscription/invoice events → local enforcement-state reconciliation for the active commercial runtime. See `docs/runbooks/lago-webhook-reconciliation.md`.                                                                  | Lago HMAC signature (no API key)                    |
| `POST /v1/account/setup` | Dashboard recovery for org provisioning when the Clerk webhook missed delivery. Idempotent — runs the same `provisionOrg` code path as the webhook. Private console contract documented in `docs/private-api/account-billing.md`. | Clerk session token (`Authorization: Bearer <jwt>`) |

Future products are roadmap items, not active docs/API surfaces yet.

## Quick Start

```bash
git clone --recurse-submodules https://github.com/jbejenar/prontiq-platform.git
cd prontiq-platform
pnpm install
pnpm build
```

The frontend apps default `NEXT_PUBLIC_API_URL` to `https://api.prontiq.dev`
for local build, typecheck, dev, and test, so the root commands above work from
a fresh checkout without extra shell setup. `apps/console` enables real Clerk
auth only when both `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`
are present. Keyless fallback is allowed only through the repo’s local/CI
frontend helper path; missing Clerk keys in any other runtime are treated as a
configuration error and fail closed.

`apps/landing` follows the same helper-managed keyless pattern for local/CI, but
its real runtime needs only `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` for the modal
sign-up path. `NEXT_PUBLIC_ACCOUNT_URL` is an optional public override for the
console/account origin used by landing redirects and the footer Console link;
when unset, production keeps `https://console.prontiq.dev`, Vercel previews map
the landing preview host to the corresponding console preview host, and
localhost maps `:3000` to `:3001`. The landing demo proxy additionally expects
server-only `PRONTIQ_LANDING_DEMO_API_KEY`. Stripe pricing-table envs are
removed; landing pricing is first-party copy and account billing is Lago-backed.

### Local Development

```bash
# Start SST dev mode (live Lambda)
pnpm dev

# Or work on individual packages
pnpm --filter @prontiq/api typecheck
```

### Deploy

```bash
pnpm deploy:dev     # sst deploy --stage dev (automatic from main in CI)
pnpm deploy:prod    # sst deploy --stage prod (manual dispatch in CI)
```

Deployed-stage observability now also expects `HONEYCOMB_API_KEY` in the GitHub
Environment secrets for `dev` and `prod`. CI `check` and `integration-test`
remain keyless and run with telemetry disabled. To disable Honeycomb export in
`dev` or `prod` without breaking deploy validation, set GitHub Environment
variable `HONEYCOMB_ENABLED=false` and redeploy the stage.

## Architecture

```
Free open dataset → independent pipeline → S3 (NDJSON + manifest.json)
    → event-driven indexing → OpenSearch → commercial API
    → auth / billing / docs / frontend apps
```

See [`ARCHITECTURE.MD`](ARCHITECTURE.MD) for the full design.

## Monorepo Structure

```
packages/
  shared/          @prontiq/shared          Types, constants, Zod schemas (dep-light)
  control-plane/   @prontiq/control-plane   provisionOrg service + writeAudit helpers (consumed by webhooks + api)
  api/             @prontiq/api             Hono API on Lambda (ARM64)
  ingestion/       @prontiq/ingestion       Step Functions + Lambda indexing
  webhooks/        @prontiq/webhooks        Clerk webhook + Lago webhook
  docs/            @prontiq/docs            Mintlify documentation
  tokens/          @prontiq/tokens          Semantic design-token contract package
  plugins/
    shopify/                                Checkout UI Extension
    woocommerce/                            WP plugin
    web-component/                          <prontiq-address> widget
apps/
  landing/                                  Next.js app for prontiq.dev with Tailwind/shadcn shell base
  console/                                  Next.js app for console.prontiq.dev with env-gated Clerk shell base
```

## Stack

| Layer          | Tool                                                                                                                                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infrastructure | SST v4 + Pulumi                                                                                                                                                                                                                                                                                             |
| API            | Hono + @hono/zod-openapi on Lambda (ARM64, Node.js 24)                                                                                                                                                                                                                                                      |
| Search         | OpenSearch 2.19 (managed)                                                                                                                                                                                                                                                                                   |
| API Keys       | DynamoDB-native (`pq_live_` + SHA-256 hash-based lookup; live in prod)                                                                                                                                                                                                                                      |
| Auth (portal)  | Clerk — webhook live in prod (`POST /webhooks/clerk`) AND JWT-authenticated `POST /v1/account/setup` recovery endpoint live in prod (P1B.05 complete)                                                                                                                                                       |
| Billing        | Lago as commercial system of record with Stripe reduced to payment processing inside Lago; Clerk `orgId` is the active commercial identity; SQS billing-event buffer, Lago forwarder, Lago webhook reconciliation, console billing BFF reads/payment links, and replay-safe private account API plan changes are implemented. |
| Frontend       | `apps/landing` live with proxy-backed demo + config-owned free tier + Clerk modal; `apps/console` has the env-gated Clerk shell with shipped overview, keys, usage, and billing surfaces.                                                                                                                   |
| Docs           | Mintlify at `docs.prontiq.dev` (live)                                                                                                                                                                                                                                                                       |
| SDKs           | Speakeasy generates `@prontiq/sdk` (TypeScript) — npm publish pending NPM_TOKEN                                                                                                                                                                                                                             |
| Observability  | CloudWatch + SNS email + Honeycomb backend traces (`HONEYCOMB_API_KEY` gated) + retained API X-Ray                                                                                                                                                                                                          |
| CI/CD          | GitHub Actions + OIDC (no stored credentials)                                                                                                                                                                                                                                                               |

## Roadmap Progress

See [`ROADMAP.md`](ROADMAP.md) for the current execution plan.

| Phase   | Epic                      | Tickets | Done      |
| ------- | ------------------------- | ------- | --------- |
| **P0**  | Infrastructure Foundation | 6       | 6/6       |
| **P1A** | API Core (Address)        | 13      | 12/13     |
| **P1B** | Auth & Billing            | 25      | 23/25     |
| **P1C** | Frontend Surfaces         | 11      | 9/11      |
| **P1D** | Docs & SDK                | 5       | 2/5       |
| **P1E** | Ingestion                 | 6       | 4/6       |
| **P1F** | Distribution              | 4       | 3/4       |
| **P2**  | ABN/ASIC Verification     | 9       | 0/9       |
| **P3**  | LEI + Full Dashboard      | 7       | 0/7       |
| **P4**  | Shopify + WooCommerce     | 5       | 0/5       |
| **P5**  | CVE/NVD + Patents         | 4       | 0/4       |
|         |                           | **95**  | **59/95** |

`P1B` includes completed legacy Stripe-path work. The counts treat `complete`,
`completed`, `done`, and `implemented` statuses as shipped; superseded planning
tickets remain counted in total tickets but not in the done column. The Lago
migration sequence is `P1B.14`–`P1B.23` plus `P1B.18a`, now complete through
pre-go-live fixture/pricing cleanup, and is called out separately in the Phase
1B section of [`ROADMAP.md`](ROADMAP.md).

P1B.21 closed the Lago migration go-live gate on 2026-04-27. The retained prod
smoke key with prefix `pq_live_4a85` produced final accepted event
`bevt_f7833d581725b732d04d3eed3fd7c484`, then was disabled. The related
customer/subscription and ledger rows are retained as audit evidence only.

P1B.23 closed the pre-go-live fixture and pricing cleanup on 2026-05-03. Prod
PAYG is AUD with `prontiq_address_requests = A$0.0015`, dev/prod Lago
reconciliation is clean, stale smoke keys are disabled, and the one-off prod
smoke key `pq_live_0300` is disabled after accepted event
`bevt_2814283dfdf6821005f0d1c8ade4cdd3`.

P1B.18a closed on 2026-04-26: dev/prod usage-forwarding smoke has accepted
delivery-ledger evidence, valid HMAC Lago webhook smoke has completed
webhook-ledger rows in both stages, replaying the same webhook unique keys
returns `200 duplicate`, and calendar counter scope remained in place until
the P1B.19 cutover.

P1B.18 added Prontiq-owned account billing APIs under `/v1/account/billing`
during the migration, but P1B.22 retired those AWS routes from the active
runtime. Console billing reads and payment-link actions now use the Vercel
server-side BFF with server-held Lago credentials; replay-safe subscription
plan changes use the Clerk-authenticated private account API. Public
Mintlify/Speakeasy specs remain data API only.

P1B.19 retired the legacy Stripe-centric runtime, P1B.20 removed its active
deploy/config/frontend surfaces, and P1B.22 moved the active commercial
identity to Clerk `orgId`. New org provisioning bootstraps Lago Free
subscriptions directly with Lago customer `external_id = orgId`, and Stripe
exists only as Lago's payment rail.

## Commands

```bash
pnpm build            # Build all packages (Turborepo)
pnpm typecheck        # Type-check all packages
pnpm lint             # ESLint across all packages
pnpm test             # Run all tests
pnpm dev              # SST dev mode
pnpm format           # Prettier format all files
```

## Related Repos

| Repo                                                             | Purpose                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| [`flat-white`](https://github.com/jbejenar/flat-white)           | G-NAF address pipeline (data source for address product) |
| [`prontiq-ariscan`](https://github.com/jbejenar/prontiq-ariscan) | AI readiness scanner (open-source companion project)     |

## Brand

Use **Prontiq** in prose and **prontiq** for the logo wordmark, domains, packages, and code identifiers. See [`docs/FRONTEND-STRATEGY.md`](docs/FRONTEND-STRATEGY.md) for the canonical frontend/brand direction and [`docs/BRAND.md`](docs/BRAND.md) for archived historical guidance only.

## Licence

Proprietary — Prontiq Pty Ltd. All rights reserved.
