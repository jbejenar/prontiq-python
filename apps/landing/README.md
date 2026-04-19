# landing

Minimal Next.js scaffold for the future `prontiq.dev` surface.

`P1C.00` establishes:

- workspace wiring
- app-router scaffold
- token CSS import
- minimal public env validation
- landing content seam via `@prontiq/shared/content`

Tailwind, MDX, and real page implementation land in later P1C tickets.

`pnpm --filter landing dev`, `build`, and `typecheck` are self-sufficient from a
fresh checkout: they build `@prontiq/shared` and `@prontiq/tokens` before
starting the app-local command, and `dev` also watches those workspace
dependencies for changes during local development.

Local build/typecheck/dev default `NEXT_PUBLIC_API_URL` to
`https://api.prontiq.dev` when the variable is unset. Set the env explicitly to
point the scaffold at a different API host.
