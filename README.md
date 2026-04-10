# Prontiq Platform

> One API. One SDK. One invoice. Australian address validation, ABN verification, LEI lookup, and more.

A unified data API platform for Australian and global open data, commercialised with obsessive developer experience.

## Products

| Product                        | Endpoint        | Data Source          | Status  |
| ------------------------------ | --------------- | -------------------- | ------- |
| **Address Validation** (G-NAF) | `/v1/address/*` | data.gov.au          | Phase 1 |
| **ABN/ASIC Verification**      | `/v1/abn/*`     | ABR bulk extract     | Phase 2 |
| **LEI Lookup**                 | `/v1/lei/*`     | GLEIF Golden Copy    | Phase 3 |
| **CVE/NVD Intel**              | `/v1/cve/*`     | NVD JSON feeds       | Phase 5 |
| **Patent Search**              | `/v1/patents/*` | IP Australia + USPTO | Phase 5 |

## Quick Start

```bash
git clone --recurse-submodules https://github.com/jbejenar/prontiq-platform.git
cd prontiq-platform
pnpm install
pnpm build
```

### Local Development

```bash
# Start SST dev mode (live Lambda + Next.js)
pnpm dev

# Or work on individual packages
pnpm --filter @prontiq/api typecheck
pnpm --filter @prontiq/dashboard dev
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
    → auth / billing / docs / SDKs
```

See [`ARCHITECTURE.MD`](ARCHITECTURE.MD) for the full design (1,451 lines).

## Monorepo Structure

```
packages/
  shared/          @prontiq/shared      Types, constants, Zod schemas
  api/             @prontiq/api         Hono API on Lambda (ARM64)
  dashboard/       @prontiq/dashboard   Next.js 15 developer portal
  ingestion/       @prontiq/ingestion   Step Functions + Lambda indexing
  webhooks/        @prontiq/webhooks    Clerk, Stripe, Unkey handlers
  docs/            @prontiq/docs        Mintlify documentation
  plugins/
    shopify/                            Checkout UI Extension
    woocommerce/                        WP plugin
    web-component/                      <prontiq-address> widget
```

## Stack

| Layer          | Tool                                                   |
| -------------- | ------------------------------------------------------ |
| Infrastructure | SST v3 + Pulumi                                        |
| API            | Hono + @hono/zod-openapi on Lambda (ARM64, Node.js 20) |
| Search         | OpenSearch 2.13 (managed)                              |
| Auth (portal)  | Clerk                                                  |
| API Keys       | Unkey + DynamoDB (hot-path verification)               |
| Billing        | Stripe (metered, per-product)                          |
| Dashboard      | Next.js 15 + Clerk + shadcn/ui                         |
| Docs           | Mintlify (from OpenAPI spec)                           |
| SDKs           | Speakeasy (from OpenAPI spec)                          |
| CI/CD          | GitHub Actions + OIDC (no stored credentials)          |

## Roadmap Progress

See [`ROADMAP.md`](ROADMAP.md) for the full 69-ticket plan (3,641 lines).

| Phase   | Epic                      | Tickets | Done     |
| ------- | ------------------------- | ------- | -------- |
| **P0**  | Infrastructure Foundation | 6       | 5/6      |
| **P1A** | API Core (Address)        | 10      | 1/10     |
| **P1B** | Auth & Billing            | 9       | 0/9      |
| **P1C** | Dashboard                 | 7       | 0/7      |
| **P1D** | Docs & SDK                | 5       | 0/5      |
| **P1E** | Ingestion                 | 6       | 0/6      |
| **P1F** | Distribution              | 2       | 0/2      |
| **P2**  | ABN/ASIC Verification     | 8       | 0/8      |
| **P3**  | LEI + Full Dashboard      | 7       | 0/7      |
| **P4**  | Shopify + WooCommerce     | 5       | 0/5      |
| **P5**  | CVE/NVD + Patents         | 4       | 0/4      |
|         |                           | **69**  | **6/69** |

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

| Repo                                                             | Purpose                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------- |
| [`flat-white`](https://github.com/jbejenar/flat-white)           | G-NAF address pipeline (data source for address product)    |
| [`prontiq-ariscan`](https://github.com/jbejenar/prontiq-ariscan) | AI readiness scanner (open-source, integrates with CVE API) |

## Licence

Proprietary — Prontiq Pty Ltd. All rights reserved.
