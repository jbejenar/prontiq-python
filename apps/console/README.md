# console

Minimal Next.js scaffold for the future `console.prontiq.dev` authenticated app.

`P1C.00` establishes:

- workspace wiring
- route-group shape for `(dashboard)` and `(auth)`
- token CSS import
- minimal public env validation
- local SDK import seam through `@prontiq/sdk`

Tailwind, shadcn/ui, Clerk wiring, and the real console shell land in later P1C tickets.

`pnpm --filter console dev`, `build`, and `typecheck` are self-sufficient from a
fresh checkout: they build `@prontiq/sdk` and `@prontiq/tokens` before starting
the app-local command, and `dev` also watches those workspace dependencies for
changes during local development.

Local build/typecheck/dev default `NEXT_PUBLIC_API_URL` to
`https://api.prontiq.dev` when the variable is unset. Set the env explicitly to
point the scaffold at a different API host.
