# Console App Rules

- This app is the future `console.prontiq.dev` surface.
- Forward-looking billing and plan-management work in this app should align to the Lago-target commercial architecture; any retained Stripe-hosted behavior is legacy migration context only.
- P1B.19 makes Lago the runtime billing source of truth and Stripe the payment
  rail only. Do not render Stripe customer/subscription IDs as canonical account
  state; `/v1/account/setup` returns platform `customerId` plus nullable
  `stripeCustomerId`.
- Billing UI work must consume `/v1/account/billing`,
  `/v1/account/billing/plan-change`, and
  `/v1/account/billing/portal-session`; do not direct-call Lago or Stripe from
  the browser. These routes are private console contracts documented by
  `packages/api/openapi.private.json`, not the public SDK.
- `P1C.07` provides the Tailwind/shadcn/theme shell base and the env-gated Clerk boundary.
- Fully missing Clerk keys are only a valid disabled mode when the helper-managed local/CI opt-in is present.
- One-key-only Clerk config is a fail-closed misconfiguration, not a valid disabled mode.
- Use `docs/prototypes/console-dashboard-v1.html` as a visual reference, not as source code to port.
- Keep the SDK seam local in `lib/sdk.ts`; TanStack Query and real data wiring still come later.
- Clerk UI must stay behind the dedicated client wrappers so keyless local/CI builds do not instantiate Clerk primitives.
