# console

Next.js 15 app for `console.prontiq.dev`.

`P1C.07` establishes:

- Tailwind CSS v3.4
- app-local shadcn/ui primitives
- dark mode via `next-themes`
- responsive dashboard shell
- app-local Vitest + Testing Library
- env-gated Clerk auth boundary
- continued SDK seam through `@prontiq/sdk`

This ticket does **not** implement live account data, TanStack Query, or the
key / usage / billing product surfaces. Those remain later console tickets. The
forward-looking billing surface for this app is Lago-backed; any remaining
Stripe-hosted account flows are legacy migration context only.

`pnpm --filter console dev`, `build`, `typecheck`, and `test` are
self-sufficient from a fresh checkout: they build `@prontiq/sdk` and
`@prontiq/tokens` before running the app-local command, and `dev` also watches
those workspace dependencies for changes during local development.

Local build/typecheck/dev/test default `NEXT_PUBLIC_API_URL` to
`https://api.prontiq.dev` when the variable is unset.

Real Clerk auth behavior is enabled only when both of these are set:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

When those envs are absent, the app only stays keyless through the repo’s
helper-managed local/CI path (`PRONTIQ_ALLOW_KEYLESS_CLERK=1`). Outside that
path, missing keys are treated as a configuration error and fail closed.

When only one Clerk key is present, the app treats that as a configuration
error instead of silently disabling protection. The `/sign-in` route renders an
explicit misconfiguration state, and protected dashboard routes fail closed.
