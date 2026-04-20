# Landing App Rules

- This app is the future `prontiq.dev` surface.
- `P1C.01` is now live: hero demo, pricing section, and sign-up CTA are implemented.
- Keep content wired through `@prontiq/shared/content`.
- Do not copy dashboard layout patterns into the landing app.
- Free-tier and pricing framing copy live in `apps/landing/content/site.json`, not in JSX.
- Paid-plan prices remain Stripe-owned via `<stripe-pricing-table>`.
- The hero demo must stay delegated to `@prontiq/web-component`; do not recreate autocomplete logic in React.
- The live demo must go through the landing-side proxy. Do not expose an API key in client code.
- Do not add fake telemetry counters, fake latency, or decorative globe animation.
