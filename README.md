# Prontiq Platform

> Australian address validation powered by G-NAF.

Prontiq is starting with developer-friendly Australian address validation. The broader open data platform roadmap is tracked in [`ROADMAP.md`](ROADMAP.md).

## Current Product

| Product                        | Endpoint        | Data Source | Status                     |
| ------------------------------ | --------------- | ----------- | -------------------------- |
| **Address Validation** (G-NAF) | `/v1/address/*` | data.gov.au | Live — 15M docs, 6 endpoints |

Live at `https://api.prontiq.dev`. Docs at `https://docs.prontiq.dev`. TypeScript SDK auto-generated to `sdks/typescript/` (npm publish pending). The ratified frontend architecture is a two-app model, and `P1C.07` now establishes the shared Tailwind/shadcn/theme base for both `prontiq.dev` (`apps/landing`) and `console.prontiq.dev` (`apps/console`) in-repo.

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

The frontend apps default `NEXT_PUBLIC_API_URL` to `https://api.prontiq.dev`
for local build, typecheck, dev, and test, so the root commands above work from
a fresh checkout without extra shell setup. `apps/console` enables real Clerk
auth only when both `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`
are present. Keyless fallback is allowed only through the repo’s local/CI
frontend helper path; missing Clerk keys in any other runtime are treated as a
configuration error and fail closed.

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
  webhooks/        @prontiq/webhooks        Clerk webhook + Stripe billing webhook
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

| Layer          | Tool                                                   |
| -------------- | ------------------------------------------------------ |
| Infrastructure | SST v4 + Pulumi                                        |
| API            | Hono + @hono/zod-openapi on Lambda (ARM64, Node.js 24) |
| Search         | OpenSearch 2.19 (managed)                              |
| API Keys       | DynamoDB-native (`pq_live_` + SHA-256 hash-based lookup; live in prod) |
| Auth (portal)  | Clerk — webhook live in prod (`POST /webhooks/clerk`) AND JWT-authenticated `POST /v1/account/setup` recovery endpoint live in prod (P1B.05 complete) |
| Billing        | Stripe customer creation, subscription webhook, hourly billing cron, and month-close all live; SES quota/billing mail verified against simulator recipients |
| Frontend       | `apps/landing` + `apps/console` with Tailwind v3.4, app-local shadcn/ui, dark mode, frontend Vitest, and env-gated Clerk boundary in console |
| Docs           | Mintlify at `docs.prontiq.dev` (live)                  |
| SDKs           | Speakeasy generates `@prontiq/sdk` (TypeScript) — npm publish pending NPM_TOKEN |
| Observability  | CloudWatch + SNS email + Honeycomb backend traces (`HONEYCOMB_API_KEY` gated) + retained API X-Ray |
| CI/CD          | GitHub Actions + OIDC (no stored credentials)          |

## Roadmap Progress

See [`ROADMAP.md`](ROADMAP.md) for the full 78-ticket plan.

| Phase   | Epic                      | Tickets | Done      |
| ------- | ------------------------- | ------- | --------- |
| **P0**  | Infrastructure Foundation | 6       | 6/6       |
| **P1A** | API Core (Address)        | 13      | 10/13     |
| **P1B** | Auth & Billing            | 13      | 11/13     |
| **P1C** | Frontend Surfaces         | 8       | 2/8       |
| **P1D** | Docs & SDK                | 5       | 2/5       |
| **P1E** | Ingestion                 | 6       | 4/6       |
| **P1F** | Distribution              | 3       | 3/3       |
| **P2**  | ABN/ASIC Verification     | 8       | 0/8       |
| **P3**  | LEI + Full Dashboard      | 7       | 0/7       |
| **P4**  | Shopify + WooCommerce     | 5       | 0/5       |
| **P5**  | CVE/NVD + Patents         | 4       | 0/4       |
|         |                           | **78**  | **38/78** |

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
