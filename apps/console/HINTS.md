# Console App Rules

- This app is the future `console.prontiq.dev` surface.
- Billing and plan-management work in this app should align to the Lago-centered
  commercial architecture; any retained Stripe-hosted behavior is legacy
  migration context only.
- P1B.22 makes Clerk `orgId` the active Prontiq/Lago customer identity and
  keeps Stripe as Lago's payment rail only. Do not render Stripe or Lago
  provider IDs as canonical account state.
- Billing UI work must not call Lago or Stripe from the browser. Billing reads
  and payment links use the Vercel server-side BFF under `app/api/billing/*`;
  plan changes use the private account API with Clerk JWT auth.
- Billing plans must be rendered from Lago responses. Do not hard-code Free,
  PAYG, packs, prices, quotas, or local `PLANS` values in the console.
- Billing plan visibility is controlled by Lago metadata:
  `prontiq_console_visible=true` includes a plan;
  `prontiq_test=true` and `prontiq_internal=true` exclude a plan;
  `prontiq_environment=dev|prod|all` scopes a plan to an environment.
- P1C.05 payment setup and invoice payment links do not mutate subscriptions.
- P1C.05a plan changes use `POST /v1/account/billing/plan-change`, Clerk
  first-factor step-up, per-click `Idempotency-Key`, and
  `prontiq-billing-actions*` action/lock rows. Do not call Lago from the
  browser and do not optimistic-write local enforcement state from Vercel.
  Terminal billing-action rows are immutable; `provider_in_flight` and
  `outcome_unknown` rows require operator Lago inspection and must not be
  auto-replayed into another provider mutation. If the account API returns
  `BILLING_TRANSITION_IN_PROGRESS`, the UI must surface the existing transition
  state and must not retry with a fresh idempotency key.
- Billing plan-change step-up requires fresh first-factor verification.
  Password-only admins must be able to complete plan changes; do not require
  second-factor freshness here unless product policy changes to mandatory MFA.
- P1C.03 key-management UI starts from `GET /v1/account/status` to choose
  missing-org recovery, first-key CTA, or key-list state. Do not infer that by
  probing mutation endpoints.
- P1C.06 playground UI is native-first and spec-driven. Keep visible UI in
  Prontiq components; Scalar imports must remain confined to
  `ScalarAdvancedModal` / `ScalarClientAdapter`.
- P1C.06a playground command palette work must stay route-local. Do not create
  a global command system, global shortcut manager, or shared `Command`
  primitive unless another feature independently needs it. The palette contains
  operations and actions only; do not add request-history browsing to it.
- P1C.06b curl-preview craft must keep `buildCurlCommand` as the only source
  of truth for generated curl. Do not add duplicate curl builders, diff
  libraries, or shortcut listeners.
- P1C.06c request history is memory-only and route-local. Do not persist it to
  localStorage, sessionStorage, IndexedDB, cookies, URL state, React Query
  persisted cache, or server state. Append only responses with an HTTP status;
  local validation failures, missing-key errors, demo-unavailable states,
  aborts, timeouts, and network errors are excluded. The dark-panel drawer is
  the only history browsing surface; the palette may only open the drawer.
- Playground keyboard shortcuts are documented centrally in `README.md`. Keep
  new shortcuts there instead of scattering them through feature notes.
- Playground command-palette telemetry is allowlisted only: event name, mode,
  source, operation id, and action id. Do not add params, bodies, query strings,
  snippets, raw keys, or response payloads.
- Playground demo mode must use the console server proxy with Clerk session,
  same-origin, public OpenAPI path/method validation, and a server-held demo
  key. Demo usage, quota, rate limiting, billing events, and abuse controls
  belong to the backend API-key policy attached to the demo key/org.
- Do not add Redis, Upstash, Vercel KV, or other new infrastructure for
  playground v1. Console-side throttling may only be UX-level debounce,
  cancellation, timeout, or in-flight duplicate-submit protection.
- Playground account mode may hold a raw key only in memory. Do not persist raw
  keys or request payloads to URLs, browser storage, cookies, analytics, logs,
  React Query persisted cache, or Scalar state.
- Playground curl copy is Prontiq-owned. Demo curl must be production-shaped
  with `{{YOUR_API_KEY}}`, never the console proxy URL.
- P1C.02 overview UI is read-only. It may call `GET /v1/account/status` and
  `GET /v1/account/keys`, but setup recovery and key create/rotate/revoke
  actions must stay on `/keys`.
- Usage UI must call the private `GET /v1/account/usage` API. Do not call Lago
  or Stripe from the browser. Cards use authoritative platform counters; charts
  use API-returned series, including the API's `Before chart tracking` baseline
  while missing or partial SQS projection catches up.
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
