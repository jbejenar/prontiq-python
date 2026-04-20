# Console App Rules

- This app is the future `console.prontiq.dev` surface.
- `P1C.07` provides the Tailwind/shadcn/theme shell base and the env-gated Clerk boundary.
- Fully missing Clerk keys are only a valid disabled mode when the helper-managed local/CI opt-in is present.
- One-key-only Clerk config is a fail-closed misconfiguration, not a valid disabled mode.
- Use `docs/prototypes/console-dashboard-v1.html` as a visual reference, not as source code to port.
- Keep the SDK seam local in `lib/sdk.ts`; TanStack Query and real data wiring still come later.
- Clerk UI must stay behind the dedicated client wrappers so keyless local/CI builds do not instantiate Clerk primitives.
