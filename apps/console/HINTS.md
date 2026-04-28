# Console App Rules

- This app is the future `console.prontiq.dev` surface.
- Billing and plan-management work in this app should align to the Lago-centered
  commercial architecture; any retained Stripe-hosted behavior is legacy
  migration context only.
- P1B.22 makes Clerk `orgId` the active Prontiq/Lago customer identity and
  keeps Stripe as Lago's payment rail only. Do not render Stripe or Lago
  provider IDs as canonical account state.
- Billing UI work must not call Lago or Stripe from the browser. Future billing
  surfaces should use a Vercel server-side BFF that verifies Clerk auth, reads
  the active `org_id`, and calls Lago with a server-held Lago API key.
- P1C.03 key-management UI should start from `GET /v1/account/status` to choose
  missing-org recovery, first-key CTA, or key-list state. Do not infer that by
  probing mutation endpoints.
- Raw API keys are transient UI state only. Never put `pq_live_*` values in
  localStorage, sessionStorage, URLs, React Query persisted cache, logs, or
  analytics payloads.
- Rotate/revoke UI must use Clerk `useReverification()` and must not loop on
  `STEP_UP_MISCONFIGURED`; that error means the Clerk token lacks `fva`.
- `P1C.07` provides the Tailwind/shadcn/theme shell base and the env-gated Clerk boundary.
- Fully missing Clerk keys are only a valid disabled mode when the helper-managed local/CI opt-in is present.
- One-key-only Clerk config is a fail-closed misconfiguration, not a valid disabled mode.
- Use `docs/prototypes/console-dashboard-v1.html` as a visual reference, not as source code to port.
- Keep the SDK seam local in `lib/sdk.ts`; TanStack Query and real data wiring still come later.
- Clerk UI must stay behind the dedicated client wrappers so keyless local/CI builds do not instantiate Clerk primitives.
