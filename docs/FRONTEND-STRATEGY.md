# Prontiq Frontend Engineering Strategy

> Canonical frontend architecture for `prontiq.dev`, `console.prontiq.dev`, docs theming, transactional email styling, and the `<prontiq-address>` widget.

**Version:** 2.4
**Ratified:** 20 April 2026
**Status:** Canonical

## Summary

Prontiq's frontend architecture is a two-app Next.js 15 setup on Vercel:

- `apps/landing` serves `prontiq.dev`
- `apps/console` serves `console.prontiq.dev`

Both apps share:

- design tokens from `packages/tokens`
- the existing Speakeasy SDK published from `sdks/typescript` as `@prontiq/sdk`
- shared schemas and content contracts from `@prontiq/shared`

The console is client-rendered below the auth boundary and calls `api.prontiq.dev` directly with Clerk-issued JWTs. The landing site is SSG-first with repo-owned content config today (`apps/landing/content/site.json`) behind the existing shared content contract.

This document replaces the old `packages/web` / `prontiq.dev/account` / `app.prontiq.dev` planning model. Those assumptions are no longer forward-looking architecture.

## Strategic Decisions

### Framework

Use Next.js 15 + React 19 across both apps.

Reasons:

- one framework and one mental model for a solo builder
- stronger agentic throughput than a split React/Vue setup
- best ecosystem fit for Clerk, shadcn/ui, TanStack Query, and dashboard-heavy UX

Rendering model:

- `prontiq.dev`: SSG + ISR / on-demand revalidation
- `console.prontiq.dev`: client-rendered below the auth boundary

### Hosting

Host both apps on Vercel.

- landing benefits from edge-served static output
- console is effectively a SPA after boot, so browser-to-AWS Sydney calls dominate latency
- backend remains on SST + AWS in `ap-southeast-2`

### UI primitives

Use shadcn/ui components copied into each app as source.

- no shared UI package initially
- no hidden component abstraction the agent cannot inspect
- full customization in-repo

Radix remains the accessibility primitive layer underneath the scaffolded source files.

### Styling

Use Tailwind CSS v3.4 plus CSS custom properties.

Tailwind v4 is not the default because the planned token-package emit relies on a JS preset shape and current shadcn ecosystem defaults still center on v3.

### Tokens

`packages/tokens` is the single source of truth for color, type, spacing, motion, radius, and shadows.

It emits:

- `tokens.css`
- `tailwind-preset.js`
- `mint-theme.json`
- `ses-vars.json`

### Brand canonicalisation

The shipped `prontiq.dev` palette and typography are canonical:

- accent: `#00e5a0` on dark, `#009366` on light
- display/numeric: Instrument Serif
- body/code: JetBrains Mono

The old `docs/BRAND.md` values are historical only.

### Contract boundary

OpenAPI remains the API contract. Frontend code consumes `@prontiq/sdk` from `sdks/typescript`; it does not hand-type API response shapes.

### Content sourcing

Landing content goes through a `ContentSource` interface in `@prontiq/shared`.

- now: repo-backed JSON/config through the shared content schema
- later: Payload-backed if editorial workflow demands it

### Identity model

Use Clerk Organizations, not user-only identity.

This matches the live backend contract today:

- org-scoped keys
- org-scoped org-envelope and legacy Stripe customer linkage
- org-scoped usage and audit

Target state after `P1B.14`:

- org-scoped commercial customers keyed by shared `customerId`
- shared customer mapping across Clerk, Prontiq, Lago, and Stripe

Until `P1B.14` ships, frontend work should not assume the shared `customerId`
contract already exists in runtime.

### Agentic optimization

This repo is optimized for agentic development:

- strict TypeScript
- collocated tests
- HINTS.md per significant directory
- minimal custom framework surface
- strong conventions over bespoke patterns

## Target Repo Shape

```text
apps/
  landing/        Next.js 15 app for prontiq.dev
  console/        Next.js 15 app for console.prontiq.dev

packages/
  tokens/         shared design tokens + emitted artifacts
  shared/         content contracts, shared Zod schemas, constants
  api/            Hono API on Lambda
  control-plane/  provisioning, billing, email, audit helpers
  ingestion/      indexing workflows
  webhooks/       Clerk / Stripe webhook handlers
  docs/           Mintlify content
  plugins/        Shopify / WooCommerce / web component

sdks/
  typescript/     Speakeasy-generated @prontiq/sdk
```

Notes:

- keep `sdks/typescript`; do not invent a new `packages/sdk`
- update workspace wiring to include `apps/*`
- `packages/tokens` is now scaffolded in-repo

## Console Architecture

`docs/prototypes/console-dashboard-v1.html` is the canonical internal visual reference for `apps/console`.
It locks the typography, shell layout, KPI treatment, and core component tone for the console build. It is
not production source code; implementation should extract tokens, components, and layout patterns from it
rather than porting the HTML directly.

### Auth boundary

`apps/console` uses:

- `clerkMiddleware()` in `middleware.ts`
- root `<ClerkProvider>` in `app/layout.tsx`
- a client dashboard layout for the authenticated subtree

### Data access

Use a module-scope SDK singleton plus a render-time token wirer:

- SDK configured once with `env.NEXT_PUBLIC_API_URL`
- Clerk `getToken()` supplied through a mutable token provider
- TanStack Query hooks import the SDK directly

No server-rendered dashboard data fetching is the default. Console mutations and queries go browser -> `api.prontiq.dev`.

### Pages

The initial console scope is:

- overview
- keys
- usage
- billing
- playground
- danger zone / account deletion

The older idea of a single Clerk `<UserProfile />` wrapper page is superseded by a proper authenticated app shell.
The prototype is authoritative for the shell, typography, KPI style, and panel language. Richer analytics
panels shown there are illustrative and may be deferred ticket-by-ticket.

## Landing Architecture

`apps/landing` is the marketing site and content surface:

- SSG-first
- repo-backed config at first
- dynamic OG images later
- SEO and docs-to-signup conversion matter here, not in the console

The landing hero is now a live product demo. `apps/landing` embeds `@prontiq/web-component` and points it at a constrained landing-side proxy route so browser traffic never carries a privileged API key.

The legacy Stripe Pricing Table path is not the target commercial UX. The
forward-looking frontend contract is Lago-backed commercial UX:

- Prontiq-rendered plan and usage surfaces on landing and in console billing views
- platform-owned billing proxy/orchestration against Lago-backed commercial state
- Prontiq-managed explanations of credits, usage, free-tier limits, and PAYG behavior

The Pricing Table path is now treated as a superseded interim implementation,
and any remaining Stripe-hosted customer-management surface should be treated as
legacy migration context rather than canonical frontend architecture.

## Design Token Contract

`packages/tokens/src/tokens.ts` is the scaffolded authoring source.

It should emit:

- app-consumable CSS variables
- Tailwind preset for both apps
- Mintlify theme payload for docs sync
- SES variables for transactional email templates

The goal is a bounded-blast-radius brand change: one token edit updates apps, docs, and emails together.

## Testing and Quality

Frontend testing stack:

- TypeScript strict mode
- ESLint
- `node:test` for backend/infrastructure and utility packages
- Vitest + Testing Library for frontend app unit/component tests
- Playwright for critical end-to-end flows

`P1C.07` wires app-level Vitest + Testing Library in both frontend apps.

Critical initial E2E flows:

1. signup -> first key -> first API call
2. upgrade flow
3. key rotation
4. card decline and recovery
5. theme persistence

Lighthouse CI should gate landing-page performance. Vercel Analytics and Sentry cover production visibility.

## Commercial Readiness

The console is not just UI polish. It owns required product capabilities:

- API key lifecycle
- billing self-service
- usage visibility
- self-service account deletion

Operational and legal requirements that must be reflected in future tickets:

- privacy policy
- terms
- support email
- incident/status surface
- cookie-consent posture before non-essential tracking expands

## Migration Contract

This ratification makes the following canonical:

- landing host: `prontiq.dev`
- authenticated app host: `console.prontiq.dev`
- docs host: `docs.prontiq.dev`
- SDK source: `sdks/typescript`
- future frontend apps live under `apps/*`

This ratification retires the following as forward-looking architecture:

- `packages/web`
- `app.prontiq.dev`
- `prontiq.dev/account` as the main dashboard model
- `packages/shared/src/brand.ts` as the planned brand source

Historical references may remain in old session logs or completed-ticket evidence, but they are no longer the target implementation.

## Immediate Follow-on Work

The base tickets are now implemented:

1. `P1C.00 — Frontend Foundations`
2. `P1C.07 — shadcn/ui + Tailwind v3.4 setup`

The next frontend tickets should be:

1. `P1C.02 — Account Dashboard`
2. `P1C.03 — API Key Management`
3. `P1C.05 — Billing`

Status: implemented. The next frontend ticket is `P1C.02`.

## Cross References

- Architecture: `ARCHITECTURE.MD`
- Execution plan: `ROADMAP.md`
- Shared content contract: `packages/shared/src/content.ts`
- SDK source: `sdks/typescript`
- Brand source: `packages/tokens/src/tokens.ts`

## Changelog

### v2.3

Ratified as canonical on 19 April 2026 after replacing the old single-app dashboard model with the two-app `landing` + `console` architecture and normalizing the strategy to repo reality:

- `console.prontiq.dev` is canonical
- `sdks/typescript` remains the SDK source
- Tailwind is pinned to the v3.4 path
- repo tooling assumptions align to Node 24 and `pnpm@10.33.0`
