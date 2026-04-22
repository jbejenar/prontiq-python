# landing

Next.js 15 app for `prontiq.dev`.

`P1C.01` is now live on top of the `P1C.07` base:

- proxy-backed live autocomplete demo via `@prontiq/web-component`
- free-tier pricing card from `content/site.json`
- paid-plan section currently in migration away from the legacy Stripe Pricing Table path
- Clerk modal CTA wrappers
- Tailwind CSS v3.4 + app-local shadcn/ui + dark mode
- app-local Vitest + Testing Library
- continued content wiring through `@prontiq/shared/content`

Site-owned marketing/config content lives in `apps/landing/content/site.json`.
That file owns hero/demo/pricing/footer framing copy and the Prontiq Free card.
Paid-plan copy should follow the Lago-target commercial architecture described in
`ARCHITECTURE.MD`. The existing Pricing Table integration is a superseded
interim implementation retained only as migration context.

`pnpm --filter landing dev`, `build`, `typecheck`, and `test` are
self-sufficient from a fresh checkout: they build `@prontiq/shared` and
`@prontiq/tokens` and `@prontiq/web-component` before running the app-local
command, and `dev` also watches those workspace dependencies for changes during
local development.

Local build/typecheck/dev/test default `NEXT_PUBLIC_API_URL` to
`https://api.prontiq.dev` when the variable is unset. Set the env explicitly to
point the app at a different API host.

Landing envs:

- `NEXT_PUBLIC_ACCOUNT_URL` optional override for the console/account origin used
  by landing CTA redirects and the footer Console link. When unset, production
  landing keeps `https://console.prontiq.dev`, Vercel previews map the landing
  preview host to the corresponding console preview host, and localhost maps
  `:3000` to `:3001`.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `PRONTIQ_ALLOW_KEYLESS_CLERK=1` only through the helper-managed local/CI path
- `PRONTIQ_LANDING_DEMO_API_KEY` for the server-side demo proxy
- `PRONTIQ_LANDING_UNLOCK_TOKEN` optional root-page-only soft gate token. When
  set, `/` stays black until visited once as `/?unlock=<token>`, which sets a
  7-day cookie. API routes remain unchanged.

Legacy / superseded interim envs:

- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_STRIPE_PRICING_TABLE_ID`

These two envs belong to the retired Stripe Pricing Table fallback and should
not be treated as the forward-looking landing billing contract.
