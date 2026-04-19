# Prontiq Platform

> Australian address validation powered by G-NAF.

Prontiq is starting with developer-friendly Australian address validation. The broader open data platform roadmap is tracked in [`ROADMAP.md`](ROADMAP.md).

## Current Product

| Product                        | Endpoint        | Data Source | Status                     |
| ------------------------------ | --------------- | ----------- | -------------------------- |
| **Address Validation** (G-NAF) | `/v1/address/*` | data.gov.au | Live — 15M docs, 6 endpoints |

Live at `https://api.prontiq.dev`. Docs at `https://docs.prontiq.dev`. TypeScript SDK auto-generated to `sdks/typescript/` (npm publish pending). The ratified frontend architecture is a two-app model, and `P1C.00` now scaffolds both `prontiq.dev` (`apps/landing`) and `console.prontiq.dev` (`apps/console`) in-repo.

### Server-to-server surface

| Endpoint | Purpose | Auth |
|---|---|---|
| `POST /webhooks/clerk` | Clerk `organizationMembership.created` → ORG envelope provisioning (Stripe customer + DDB record + audit row + best-effort welcome email). See `docs/runbooks/clerk-webhook.md`. | Svix signature (no API key) |
| `POST /v1/account/setup` | Dashboard recovery for org provisioning when the Clerk webhook missed delivery. Idempotent — runs the same `provisionOrg` code path as the webhook. See [`api-reference/account-setup`](https://docs.prontiq.dev/api-reference/account-setup). | Clerk session token (`Authorization: Bearer <jwt>`) |

Future products are roadmap items, not active docs/API surfaces yet.

## Quick Start

```bash
git clone --recurse-submodules https://github.com/jbejenar/prontiq-platform.git
cd prontiq-platform
pnpm install
pnpm build
```

The scaffolded frontend apps default `NEXT_PUBLIC_API_URL` to
`https://api.prontiq.dev` for local build/typecheck/dev, so the root commands
above work from a fresh checkout without extra shell setup. Override the env
explicitly if you need the apps pointed at a different API host.

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
  webhooks/        @prontiq/webhooks        Clerk webhook + Stripe billing webhook
  docs/            @prontiq/docs            Mintlify documentation
  tokens/          @prontiq/tokens          Scaffolded design-token contract package (P1C.00)
  plugins/
    shopify/                                Checkout UI Extension
    woocommerce/                            WP plugin
    web-component/                          <prontiq-address> widget
apps/
  landing/                                  Scaffolded Next.js app for prontiq.dev (P1C.00)
  console/                                  Scaffolded Next.js app for console.prontiq.dev (P1C.00)
```

## Stack

| Layer          | Tool                                                   |
| -------------- | ------------------------------------------------------ |
| Infrastructure | SST v4 + Pulumi                                        |
| API            | Hono + @hono/zod-openapi on Lambda (ARM64, Node.js 24) |
| Search         | OpenSearch 2.19 (managed)                              |
| API Keys       | DynamoDB-native (`pq_live_` + SHA-256 hash-based lookup; live in prod) |
| Auth (portal)  | Clerk — webhook live in prod (`POST /webhooks/clerk`) AND JWT-authenticated `POST /v1/account/setup` recovery endpoint live in prod (P1B.05 complete) |
| Billing        | Stripe customer creation, subscription webhook, hourly billing cron, and month-close all live; SES quota/billing mail verified against simulator recipients |
| Frontend       | Scaffolded `apps/landing` + `apps/console`; shell/components remain in later P1C tickets |
| Docs           | Mintlify at `docs.prontiq.dev` (live)                  |
| SDKs           | Speakeasy generates `@prontiq/sdk` (TypeScript) — npm publish pending NPM_TOKEN |
| CI/CD          | GitHub Actions + OIDC (no stored credentials)          |

## Roadmap Progress

See [`ROADMAP.md`](ROADMAP.md) for the full 77-ticket plan.

| Phase   | Epic                      | Tickets | Done      |
| ------- | ------------------------- | ------- | --------- |
| **P0**  | Infrastructure Foundation | 6       | 6/6       |
| **P1A** | API Core (Address)        | 13      | 10/13     |
| **P1B** | Auth & Billing            | 13      | 11/13     |
| **P1C** | Frontend Surfaces         | 8       | 1/8       |
| **P1D** | Docs & SDK                | 5       | 2/5       |
| **P1E** | Ingestion                 | 6       | 4/6       |
| **P1F** | Distribution              | 2       | 2/2       |
| **P2**  | ABN/ASIC Verification     | 8       | 0/8       |
| **P3**  | LEI + Full Dashboard      | 7       | 0/7       |
| **P4**  | Shopify + WooCommerce     | 5       | 0/5       |
| **P5**  | CVE/NVD + Patents         | 4       | 0/4       |
|         |                           | **77**  | **36/77** |

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
