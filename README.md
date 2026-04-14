# Prontiq Platform

> Australian address validation powered by G-NAF.

Prontiq is starting with developer-friendly Australian address validation. The broader open data platform roadmap is tracked in [`ROADMAP.md`](ROADMAP.md).

## Current Product

| Product                        | Endpoint        | Data Source | Status                     |
| ------------------------------ | --------------- | ----------- | -------------------------- |
| **Address Validation** (G-NAF) | `/v1/address/*` | data.gov.au | Live — 15M docs, 6 endpoints |

Live at `https://api.prontiq.dev`. Docs at `https://docs.prontiq.dev`. TypeScript SDK auto-generated to `sdks/typescript/` (npm publish pending).

Future products are roadmap items, not active docs/API surfaces yet.

## Quick Start

```bash
git clone --recurse-submodules https://github.com/jbejenar/prontiq-platform.git
cd prontiq-platform
pnpm install
pnpm build
```

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
    → auth / billing / docs
```

See [`ARCHITECTURE.MD`](ARCHITECTURE.MD) for the full design (1,451 lines).

## Monorepo Structure

```
packages/
  shared/          @prontiq/shared      Types, constants, Zod schemas
  api/             @prontiq/api         Hono API on Lambda (ARM64)
  ingestion/       @prontiq/ingestion   Step Functions + Lambda indexing
  webhooks/        @prontiq/webhooks    Clerk, Stripe, Unkey handlers (future — P1B)
  docs/            @prontiq/docs        Mintlify documentation
  plugins/
    shopify/                            Checkout UI Extension
    woocommerce/                        WP plugin
    web-component/                      <prontiq-address> widget
```

## Stack

| Layer          | Tool                                                   |
| -------------- | ------------------------------------------------------ |
| Infrastructure | SST v4 + Pulumi                                        |
| API            | Hono + @hono/zod-openapi on Lambda (ARM64, Node.js 20) |
| Search         | OpenSearch 2.19 (managed)                              |
| API Keys       | DynamoDB (hot-path verification; Unkey webhook sync planned — P1B) |
| Auth (portal)  | Clerk (planned — P1B)                                  |
| Billing        | Stripe (planned — P1B)                                 |
| Dashboard      | Removed — to be rebuilt per Architecture v2.1 §7 (P1C) |
| Docs           | Mintlify at `docs.prontiq.dev` (live)                  |
| SDKs           | Speakeasy generates `@prontiq/sdk` (TypeScript) — npm publish pending NPM_TOKEN |
| CI/CD          | GitHub Actions + OIDC (no stored credentials)          |

## Roadmap Progress

See [`ROADMAP.md`](ROADMAP.md) for the full 72-ticket plan.

| Phase   | Epic                      | Tickets | Done      |
| ------- | ------------------------- | ------- | --------- |
| **P0**  | Infrastructure Foundation | 6       | 6/6       |
| **P1A** | API Core (Address)        | 13      | 9/13      |
| **P1B** | Auth & Billing            | 9       | 0/9       |
| **P1C** | Dashboard                 | 7       | 0/7       |
| **P1D** | Docs & SDK                | 5       | 2/5       |
| **P1E** | Ingestion                 | 6       | 4/6       |
| **P1F** | Distribution              | 2       | 1/2       |
| **P2**  | ABN/ASIC Verification     | 8       | 0/8       |
| **P3**  | LEI + Full Dashboard      | 7       | 0/7       |
| **P4**  | Shopify + WooCommerce     | 5       | 0/5       |
| **P5**  | CVE/NVD + Patents         | 4       | 0/4       |
|         |                           | **72**  | **22/72** |

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

Use **Prontiq** in prose and **prontiq** for the logo wordmark, domains, packages, and code identifiers. See [`docs/BRAND.md`](docs/BRAND.md).

## Licence

Proprietary — Prontiq Pty Ltd. All rights reserved.
