# P1C.06 Playground Scalar Spike

Date: 2026-05-03

Scalar package tested: `@scalar/api-client-react@2.0.11`.

Verdict:

- Scalar is acceptable only as an isolated advanced workbench behind `ScalarAdvancedModal` / `ScalarClientAdapter`.
- Native Prontiq components remain the primary playground surface and execution path.
- Raw account API keys are not prefilled into Scalar in this release. Account execution uses Prontiq-owned fetch logic with memory-only key state.
- Demo execution uses the Prontiq-owned console proxy, not Scalar proxy execution.

Rationale:

- The React wrapper mounts a Vue app under `document.body` and keeps it alive across client-side navigation, so it is not treated as a normal design-system component.
- The package supports routing to a specific `{ path, method }` and OpenAPI URL loading, which is useful for advanced exploration.
- Credential persistence and visual/CSS side effects require browser regression checks on every Scalar version upgrade before widening its role.

Upgrade gate:

- Re-run raw-key storage checks across localStorage, sessionStorage, IndexedDB, cookies, URL/history, rendered DOM, request history, generated snippets, and clipboard before passing real account credentials to Scalar.
- Re-run visual checks after opening Scalar, closing it, navigating to Keys/Billing/Usage, and opening normal console dialogs, popovers, sheets, and toasts.
