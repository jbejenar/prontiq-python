# landing

Next.js 15 app for `prontiq.dev`.

`P1C.01` is now live on top of the `P1C.07` base:

- proxy-backed live autocomplete demo via `@prontiq/web-component`
- free-tier pricing card from `content/site.json`
- paid-plan section currently in transition away from Stripe Pricing Tables
- Clerk modal CTA wrappers
- Tailwind CSS v3.4 + app-local shadcn/ui + dark mode
- app-local Vitest + Testing Library
- continued content wiring through `@prontiq/shared/content`

Site-owned marketing/config content lives in `apps/landing/content/site.json`.
That file owns hero/demo/pricing/footer framing copy and the Prontiq Free card.
Paid-plan copy remains Stripe-owned, but the forward-looking purchase path is
Prontiq-rendered plan cards plus backend-created Stripe Checkout Sessions. The
existing Pricing Table integration is a superseded interim implementation.

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
  landing keeps `https://console.prontiq.dev`, while preview/local stay on their
  current origin instead of jumping to production.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `PRONTIQ_ALLOW_KEYLESS_CLERK=1` only through the helper-managed local/CI path
- `PRONTIQ_LANDING_DEMO_API_KEY` for the server-side demo proxy
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

Legacy / superseded interim envs:

- `NEXT_PUBLIC_STRIPE_PRICING_TABLE_ID`
