# Console App Rules

- This app is the future `console.prontiq.dev` surface.
- `P1C.00` is scaffold-only: no Tailwind, no Clerk wiring, no TanStack Query, no shell implementation.
- Use `docs/prototypes/console-dashboard-v1.html` as a visual reference later, not as source code to port.
- Keep the SDK seam local in `lib/sdk.ts`; full auth/token wiring comes later.
