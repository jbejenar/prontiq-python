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
- P1C.03 key-management UI starts from `GET /v1/account/status` to choose
  missing-org recovery, first-key CTA, or key-list state. Do not infer that by
  probing mutation endpoints.
- P1C.02 overview UI is read-only. It may call `GET /v1/account/status` and
  `GET /v1/account/keys`, but setup recovery and key create/rotate/revoke
  actions must stay on `/keys`.
- Usage UI must call the private `GET /v1/account/usage` API. Do not call Lago
  or Stripe from the browser. Cards use authoritative platform counters; charts
  may lag the SQS projection and should label that clearly.
- Key-management queries must be scoped by active Clerk `orgId`; if no
  organization is active, show an organization-selection state instead of
  calling the account API.
- Use the shared account query-key helpers from `lib/account-query-keys.ts` for
  status/key/audit queries so overview and keys pages share cache identity.
- `app/providers.tsx` owns the QueryClient and Sonner toaster for console
  client data flows.
- Raw API keys are transient UI state only. Never put `pq_live_*` values in
  localStorage, sessionStorage, URLs, React Query persisted cache, logs, or
  analytics payloads.
- Overview must never render or copy existing raw API keys. Quickstart snippets
  use `<YOUR_API_KEY>` placeholders and link users to `/keys`.
- Key raw values are never recoverable from the console after the reveal-once
  create/rotate dialog closes. Members may view masked key metadata only; org
  admins create, rotate, and revoke keys.
- Rotate/revoke UI must use Clerk `useReverification()` and must not loop on
  `STEP_UP_MISCONFIGURED`; that error means the Clerk token lacks `fva`.
- `P1C.07` provides the Tailwind/shadcn/theme shell base and the env-gated Clerk boundary.
- Fully missing Clerk keys are only a valid disabled mode when the helper-managed local/CI opt-in is present.
- One-key-only Clerk config is a fail-closed misconfiguration, not a valid disabled mode.
- Use `docs/prototypes/console-dashboard-v1.html` as a visual reference, not as source code to port.
- Keep public data API SDK usage behind `lib/sdk.ts`; private account API calls
  use `lib/account-api.ts` with Clerk session tokens.
- Leave `NEXT_PUBLIC_CLERK_JWT_TEMPLATE` unset unless the Clerk tenant uses a
  named JWT template. When set, `lib/account-api.ts` passes it to
  `getToken({ template })`; otherwise it uses the default session token.
- Clerk UI must stay behind the dedicated client wrappers so keyless local/CI builds do not instantiate Clerk primitives.
