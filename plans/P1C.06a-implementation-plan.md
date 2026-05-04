# P1C.06a — Playground Command Palette And Shortcuts

## Intent

Add a route-local command palette and keyboard shortcut foundation to the existing P1C.06 playground without changing request execution, demo proxy behavior, key handling, Scalar boundaries, or backend contracts.

## Current State

- `/playground` already renders a native Prontiq two-pane UI from the public OpenAPI spec.
- `PlaygroundPanel` owns selected operation, mode, and memory-held key state.
- `PlaygroundExecutionPanel` owns request config, curl generation, request execution, and response state.
- `PlaygroundDarkPanel` renders the curl/snippet tabs, Run button, response metadata/body, and footer.
- The operation rail already shows a decorative `⌘K` hint that is not wired.

## Constraints

- Keep command palette and shortcuts scoped to `/playground`.
- Do not create a console-wide command system, global shortcut manager, or shared `Command` primitive.
- Do not persist raw keys, request params, request bodies, snippets, or command state.
- Do not change the demo proxy, account request execution, public OpenAPI spec, Scalar adapter, backend usage controls, or `packages/ui`.
- Telemetry must remain payload-free and allowlisted.

## Approach

- Add `cmdk` for the route-local command palette and `react-hotkeys-hook` for scoped keyboard handling.
- Mount `PlaygroundCommandPalette` once at the playground root.
- Let `PlaygroundExecutionPanel` register a small execution-control surface upward: run, copy curl, reset, focus language tabs, and availability flags.
- Keep actual execution in `PlaygroundExecutionPanel`; palette Run invokes the same handler as the visible Run button.
- Add `usePlaygroundHotkeys(rootRef)` so shortcuts only fire from inside the playground root and respect text-entry/IME boundaries.

## Phases

### Phase 1 — Dependencies and palette shell

- Add `cmdk` and `react-hotkeys-hook` to `apps/console`.
- Add `PlaygroundCommandPalette` with Operations and Actions groups.
- Keep recent requests out of scope until P1C.06c.

### Phase 2 — Route-local controls and shortcuts

- Add execution-control registration from `PlaygroundExecutionPanel` to `PlaygroundPanel`.
- Wire palette actions to the existing visible UI behavior.
- Wire shortcuts:
  - `Cmd/Ctrl+K` opens palette from playground chrome.
  - `Cmd/Ctrl+Enter` runs from playground chrome and request inputs.
  - `/` focuses the operation filter from playground chrome.

### Phase 3 — Docs and tests

- Update `apps/console/README.md` and `apps/console/HINTS.md`.
- Add component/hook tests for palette search/action behavior and shortcut scoping.

## Documentation Updates

- `apps/console/README.md`: add P1C.06a summary and centralized playground keyboard shortcuts.
- `apps/console/HINTS.md`: add route-local command palette and telemetry boundaries.
- No new DEC, API docs, runbook, migration notes, OpenAPI updates, or shared UI docs are required.

## Test Strategy

- Palette component tests:
  - operations search by OpenAPI-derived metadata;
  - operation selection calls the supplied operation handler;
  - action selection calls the supplied action handler;
  - disabled actions are not activatable.
- Hotkey tests:
  - `Cmd/Ctrl+Enter` fires from playground request inputs;
  - composition events do not run;
  - `Cmd/Ctrl+K` opens from playground chrome but not text-entry fields;
  - `/` focuses the filter from playground chrome but not text-entry fields.
- Regression suite:
  - `pnpm --filter console typecheck`
  - `pnpm --filter console test`
  - `pnpm --filter console lint`
  - `pnpm --filter console build`

## Risk & Rollback

- Risk: shortcuts leak outside playground. Mitigation: root-ref containment checks and tests.
- Risk: palette action path diverges from visible controls. Mitigation: palette calls the same registered run/copy/reset handlers.
- Risk: raw-key telemetry expansion. Mitigation: separate allowlisted interaction telemetry shape.

Rollback is a normal git revert of the ticket. No data, config, backend, or infrastructure changes are introduced.

## Open Questions

None blocking.

## Estimate

0.5–1 day.
