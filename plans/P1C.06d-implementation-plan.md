# P1C.06d — Multi-Language Playground Snippets

## Intent

Replace the placeholder non-curl playground tabs with real, production-shaped
request snippets generated from the same OpenAPI-derived operation state as the
native execution panel.

## Current State

- `/playground` already renders language tabs in `PlaygroundDarkPanel`.
- `curl` is functional through `buildCurlCommand`; `node.js`, `python`, `java`,
  `go`, and `ruby` render static placeholder comments.
- Request execution, demo/account mode, history, command palette actions, and
  key handling are Prontiq-owned and must not change.
- Prism grammars for bash, JavaScript, Python, Java, Go, and Ruby are imported
  by the dark panel.

## Constraints

- Curl remains sourced only from `buildCurlCommand`.
- Snippets use `${NEXT_PUBLIC_API_URL}` / `baseUrl`, never the console demo
  proxy URL.
- Snippets use `{{YOUR_API_KEY}}` by default and must not render or persist a
  held raw account key.
- Snippet generation is client-local and does not emit telemetry with params,
  bodies, snippets, keys, or response payloads.
- Language-tab and snippet-copy telemetry is allowlisted to event name,
  language, mode, and source only.
- The history drawer stays the only request-history browsing surface; do not add
  recent-request browsing back to the palette.

## Approach

Add a small playground-local snippet library that builds a minimal HAR request
from the selected operation/config and lazy-loads `@httptoolkit/httpsnippet`
only when a non-curl tab is selected. The dark panel owns async loading/error
states for snippets and keeps request snippets visible beside the response.

Node uses the package's JavaScript `fetch` target because the package's
`node/fetch` target emits `node-fetch`; the product intent is native Fetch.
Java uses the `java/nethttp` target for Java 11+ native `HttpClient`.

## Phases

1. Snippet generation library
   - Files: `apps/console/features/playground/lib/snippets.ts`,
     `apps/console/global.d.ts`, `apps/console/package.json`,
     `pnpm-lock.yaml`.
   - Adds typed package boundary, HAR builder, lazy package load, and language
     target mapping.

2. Dark panel integration
   - Files:
     `apps/console/features/playground/components/PlaygroundDarkPanel.tsx`,
     `apps/console/features/playground/components/PlaygroundExecutionPanel.tsx`.
   - Replaces placeholders with generated snippets, preserves curl highlight,
     uses existing Prism theme, presents response and code side-by-side, copies
     the active snippet, and records allowlisted language/copy telemetry.

3. Tests and docs
   - Files:
     `apps/console/features/playground/lib/snippets.test.ts`,
     `apps/console/features/playground/components/PlaygroundDarkPanel.test.tsx`,
     `apps/console/README.md`, `apps/console/HINTS.md`,
     `docs/decisions/044-playground-snippet-generation.md`,
     `plans/P1C.06d-implementation-plan.md`.
   - Covers output shape, raw-key exclusion, dark-panel tab rendering, and
     vendor decision.

## Documentation Updates

- `ARCHITECTURE.MD`: no update needed; this is console-local UI behaviour.
- `DEC-044`: record the snippet-generation vendor decision and Node target
  trade-off.
- `HINTS.md`: add P1C.06d guardrails for lazy snippets and key safety.
- `apps/console/README.md`: document P1C.06d behaviour.
- API docs: no update needed; no API shape changes.
- Runbooks: no update needed; no operational workflow changes.
- Changelog: no standalone user changelog exists for console-local P1C work.

## Test Strategy

- Unit test HAR construction and generated snippets for all non-curl languages.
- Unit test raw-key exclusion from generated snippets.
- Component test non-curl tab rendering and visible-snippet copy.
- Existing playground execution, history, palette, and key-safety tests must
  continue to pass.
- Run console typecheck/build to verify the lazy dependency can be bundled.

## Risk & Rollback

- Risk: the CommonJS snippet package pulls browser-incompatible modules into the
  client bundle. Mitigation: lazy import plus build verification. Rollback:
  remove dependency and return tabs to placeholders.
- Risk: generated snippets include an unexpected auth shape. Mitigation:
  placeholder-key tests for every language. Rollback: disable non-curl tabs.
- Risk: generated output changes on package upgrade. Mitigation: pin version and
  require rerunning snippet tests before upgrades.

## Open Questions

- None.

## Estimate

- Phase 1: 0.5 day.
- Phase 2: 0.5 day.
- Phase 3: 0.5 day.

## File Checklist

| Phase | File | Change | Docs |
|---|---|---|---|
| 1 | `apps/console/package.json` | Add `@httptoolkit/httpsnippet` dependency | No |
| 1 | `pnpm-lock.yaml` | Lock dependency tree | No |
| 1 | `apps/console/global.d.ts` | Declare package shape | No |
| 1 | `apps/console/features/playground/lib/snippets.ts` | Add snippet generator | No |
| 2 | `apps/console/features/playground/components/PlaygroundDarkPanel.tsx` | Render generated snippets | No |
| 2 | `apps/console/features/playground/components/PlaygroundExecutionPanel.tsx` | Pass generation callback | No |
| 3 | `apps/console/features/playground/lib/snippets.test.ts` | Add generation tests | No |
| 3 | `apps/console/features/playground/components/PlaygroundDarkPanel.test.tsx` | Add tab/copy tests | No |
| 3 | `apps/console/README.md` | Document P1C.06d | Yes |
| 3 | `apps/console/HINTS.md` | Add guardrails | Yes |
| 3 | `docs/decisions/044-playground-snippet-generation.md` | Vendor decision | Yes |
| 3 | `plans/P1C.06d-implementation-plan.md` | Commit plan | Yes |

Summary: P1C.06d: 3 phases, 4 doc updates, 0 open questions.
