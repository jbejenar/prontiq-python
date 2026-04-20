# landing

Next.js 15 app for `prontiq.dev`.

`P1C.07` establishes:

- Tailwind CSS v3.4
- app-local shadcn/ui primitives
- dark mode via `next-themes`
- a token-aware landing shell
- app-local Vitest + Testing Library
- continued content wiring through `@prontiq/shared/content`

This ticket does **not** implement the live autocomplete demo, pricing table, or
sign-up CTA. Those remain later landing tickets.

`pnpm --filter landing dev`, `build`, `typecheck`, and `test` are
self-sufficient from a fresh checkout: they build `@prontiq/shared` and
`@prontiq/tokens` before running the app-local command, and `dev` also watches
those workspace dependencies for changes during local development.

Local build/typecheck/dev/test default `NEXT_PUBLIC_API_URL` to
`https://api.prontiq.dev` when the variable is unset. Set the env explicitly to
point the app at a different API host.
