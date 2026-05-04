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

P1C.03 key-management UI uses the private account API directly with a Clerk
session token. `GET /v1/account/status` is the state-machine entry point:
missing org → setup CTA, provisioned without keys → first-key CTA, provisioned
with keys → key list. Raw `pq_live_*` keys are reveal-once transient state only.
Queries are keyed by active Clerk `orgId`; if no organization is active, the UI
asks the user to select one before calling the account API. The QueryClient and
Sonner toaster are mounted in `app/providers.tsx`; private account API helpers
live in `lib/account-api.ts`. Members can view masked key metadata only; org
admins create, rotate, and revoke keys, with rotate/revoke protected by Clerk
reverification.

P1C.02 overview UI is read-only. It uses the same Clerk session-token account
API path to render account/key posture, masked key metadata, and safe quickstart
snippets. It never performs setup or key mutations and never renders existing
raw API keys; all mutation and reveal-once flows remain on `/keys`.

P1C.04 usage UI calls `GET /v1/account/usage`. Cards show authoritative
Prontiq counter totals; charts use the async `prontiq-usage-daily` projection
fed by billing events, with an API-provided `Before chart tracking` baseline
when the projection is missing or partial. CSV export is client-side from the
returned series and includes each point's `kind`. Do not call Lago or Stripe
from browser code.

P1C.05 billing UI uses a Vercel server-side BFF under `app/api/billing/*`.
The browser calls same-origin BFF routes; those route handlers verify the Clerk
session and active org, then call Lago with server-held credentials. The page
shows the active Lago subscription, current billing usage estimate, dynamic
Lago plan cards, recent invoices, payment-method setup, and invoice payment
links. It does not call Lago or Stripe from browser code and does not use
`/v1/account/billing*`.

P1C.05a adds replay-safe plan changes through the private AWS account API, not
the Vercel BFF. The browser calls
`POST /v1/account/billing/plan-change` with its Clerk session token and an
`Idempotency-Key`; the account API enforces org-admin access, Clerk
first-factor step-up, the DynamoDB billing-action ledger, and the Lago
subscription mutation. Vercel does not hold DynamoDB credentials for plan
changes. Lago webhook reconciliation remains the only path that updates local
API enforcement after Lago accepts a subscription change. While a provider,
payment, or outcome fence is active, different idempotency keys are rejected as
`BILLING_TRANSITION_IN_PROGRESS`; the UI must not attempt a second plan change
until the existing transition is reconciled or repaired.

P1C.06 adds `/playground` as a Prontiq-owned, OpenAPI-driven console page.
Native console components own endpoint discovery, request inputs, demo/account
mode, memory-only raw-key handling, curl generation, response display, and
telemetry boundaries. Scalar is installed only as an isolated advanced workbench
behind `ScalarAdvancedModal` / `ScalarClientAdapter`; raw account keys are not
prefilled into Scalar. Demo mode executes through
`app/api/playground/demo`, which verifies a Clerk session, same-origin request,
public OpenAPI path/method, and server-held demo API key. Demo usage, quota,
rate limiting, billing events, and abuse controls are enforced by the backend
API-key policy attached to the demo key/org, not by the console. Account mode
calls `NEXT_PUBLIC_API_URL` directly from the browser with the memory-held
`X-Api-Key`.

P1C.06a adds the playground command palette and route-local keyboard shortcut
foundation. The palette is mounted only under `/playground`, searches the
public OpenAPI operation list, and triggers the same native Prontiq actions as
the visible UI. The palette is intentionally limited to operations and actions;
request history belongs only in the dark-panel drawer, with the palette exposing
only an `Open request history` action. Palette telemetry is allowlisted to event
name, mode, source, operation id, and action id only.

P1C.06b refines the Prontiq-owned curl preview without changing request
execution semantics. The dark panel keeps `buildCurlCommand` as the source of
truth, memoizes Prism rendering, briefly highlights changed curl bytes, and
shows the run shortcut as an inline chip inside the Run button. The dark-panel
footer exposes a clickable command-palette affordance and the run shortcut for
discoverability; the operation filter remains a filter-only control.

P1C.06c adds tab-session request history. History is memory-only, route-local,
and capped at 50 HTTP responses with FIFO eviction. Entries are appended only
after the server returns an HTTP status; local validation failures, missing-key
errors, demo-unavailable states, aborts, timeouts, and network failures are not
history entries. The dark-panel drawer is the only request-history browsing
surface and can reload an entry's operation, mode, params, and body without
re-firing the request. History clears on org switch/sign-out scope changes,
manual clear, and page reload. Display redacts Prontiq-shaped API keys in
parameter summaries, but telemetry remains allowlisted and never includes
params, bodies, query strings, snippets, keys, or response payloads.

Playground keyboard shortcuts:

- `Cmd/Ctrl+K`: open the playground command palette from playground chrome.
- `Cmd/Ctrl+Enter`: run the current playground request from playground chrome
  or request inputs.
- `/`: focus the operation filter from playground chrome.

Billing route handlers require these server env vars:

- `LAGO_API_URL`
- `LAGO_API_KEY`

Optional billing env:

- `PRONTIQ_BILLING_CATALOG_ENV=dev|prod|all`

Playground demo env:

- `PRONTIQ_CONSOLE_PLAYGROUND_DEMO_API_KEY`
- `PRONTIQ_CONSOLE_PLAYGROUND_DEMO_BACKEND_POLICY_CONFIRMED=1`

Demo execution fails closed unless the demo key is configured and the backend
quota/rate policy has been explicitly confirmed. Console-side request timeout
and in-flight duplicate-submit protection are UX controls only, not quota,
billing, or abuse-control boundaries.

Plan cards are rendered only from Lago plans with
`prontiq_console_visible=true`. Plans with `prontiq_test=true` or
`prontiq_internal=true` are hidden. If `prontiq_environment` is present, it must
match the current billing catalog environment or `all`.

`pnpm --filter console dev`, `build`, `typecheck`, and `test` are
self-sufficient from a fresh checkout: they build `@prontiq/sdk` and
`@prontiq/tokens` before running the app-local command, and `dev` also watches
those workspace dependencies for changes during local development.

Local build/typecheck/dev/test default `NEXT_PUBLIC_API_URL` to
`https://api.prontiq.dev` when the variable is unset.

Real Clerk auth behavior is enabled only when both of these are set:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

`NEXT_PUBLIC_CLERK_JWT_TEMPLATE` is optional. Leave it unset for the default
Clerk session token; set it only if the tenant moves account API calls to a
named JWT template.

When those envs are absent, the app only stays keyless through the repo’s
helper-managed local/CI path (`PRONTIQ_ALLOW_KEYLESS_CLERK=1`). Outside that
path, missing keys are treated as a configuration error and fail closed.

When only one Clerk key is present, the app treats that as a configuration
error instead of silently disabling protection. The `/sign-in` route renders an
explicit misconfiguration state, and protected dashboard routes fail closed.
