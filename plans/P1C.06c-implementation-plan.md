# P1C.06c — Request History Implementation Plan

## Intent

Add tab-session request history to the redesigned console playground so users can inspect and reload recently fired requests without introducing persistence, new infrastructure, or changes to request execution semantics.

## Current State

`/playground` already has a Prontiq-owned two-pane UI, route-local command palette, keyboard shortcuts, curl preview craft, demo/account modes, memory-held API keys, and a server-side demo proxy. The current playground can run requests and display a response, but it does not retain successful request configurations in the tab session.

Relevant code:

- `apps/console/features/playground/components/PlaygroundPanel.tsx`: owns route-level mode, selected operation, key scope, command palette, and hotkeys.
- `apps/console/features/playground/components/PlaygroundExecutionPanel.tsx`: owns request config, run lifecycle, curl generation, response state, and telemetry.
- `apps/console/features/playground/components/PlaygroundDarkPanel.tsx`: owns the dark code/response panel UI.
- `apps/console/features/playground/components/PlaygroundCommandPalette.tsx`: owns route-local operation/action discovery.
- `apps/console/features/playground/types.ts`: shared playground contracts.
- `apps/console/README.md` and `apps/console/HINTS.md`: playground behaviour and agent guardrails.

## Constraints

- History is memory-only. Do not use localStorage, sessionStorage, IndexedDB, cookies, URL state, persisted React Query cache, server state, or new infrastructure.
- Append only after an HTTP response with a status code is received from the server.
- Exclude local validation failures, missing-key errors, demo-unavailable states, aborts, timeouts, and network errors.
- History must restore operation, mode, params, and body but must not re-fire the request.
- History clears on org switch/sign-out scope changes, manual clear, and page reload.
- Telemetry is allowlisted only: event name, mode, source, operation id, and action id. No params, bodies, query strings, snippets, keys, or response payloads.
- Key-shaped parameter values may be displayed only in redacted form. The underlying memory state remains raw until cleared with the rest of history.
- No changes to demo proxy, backend usage controls, OpenAPI spec, billing, Scalar, or `packages/ui`.

## Approach

Use a small `useReducer` slice owned by `PlaygroundPanel`, plus pure helper functions under `features/playground/lib/history.ts`. `PlaygroundExecutionPanel` appends entries only in the successful HTTP-response path. `PlaygroundDarkPanel` renders a non-persistent in-page history drawer. `PlaygroundCommandPalette` only exposes an `Open request history` action; it does not browse recent requests.

No dependency is needed. A reducer is sufficient and avoids a new global store.

## Phases

### Phase 1 — Contracts And Reducer

- Files: `apps/console/features/playground/types.ts`, `apps/console/features/playground/lib/history.ts`.
- Add `PlaygroundHistoryEntry`.
- Add `APPEND` and `CLEAR` reducer actions only.
- Cap entries at 50 with FIFO eviction by prepending the new entry and dropping the oldest.
- Add display-only key-shaped value redaction and relative-time helpers.
- No migrations.
- No feature flags.
- Rollback: remove the type/helper and callers.

### Phase 2 — Capture And Restore

- Files: `PlaygroundPanel.tsx`, `PlaygroundExecutionPanel.tsx`.
- Own reducer state at the playground root.
- Append only after an HTTP response object is returned.
- Restore selected operation, mode, params, and body from a history entry without firing a request.
- Clear history on `scopeVersion` change.
- No request execution, proxy, or telemetry payload contract changes.
- Rollback: remove props and reducer wiring.

### Phase 3 — Drawer And Palette UI

- Files: `PlaygroundDarkPanel.tsx`, `PlaygroundCommandPalette.tsx`.
- Add history trigger in response metadata strip.
- Add 280px in-panel history drawer with newest-first entries, empty state, clear action, close action, and entry select.
- Add an Open request history action to the command palette. Do not add a Recent requests group; the drawer is the only history browsing surface.
- Disable page-level hotkeys while the history drawer is open.
- Rollback: remove drawer/palette rendering while keeping reducer safe to delete.

### Phase 4 — Tests And Docs

- Files: tests next to touched components/libs, `apps/console/README.md`, `apps/console/HINTS.md`, this plan.
- Add reducer, UI, restore, network-failure exclusion, and hotkey-boundary coverage.
- Document memory-only history and telemetry constraints.
- Rollback: revert test/docs changes with feature revert.

## Documentation Updates

- `apps/console/README.md`: add P1C.06c summary, memory-only constraints, entry inclusion/exclusion rules, reload behaviour, clear behaviour, and telemetry boundary.
- `apps/console/HINTS.md`: add agent guardrails for memory-only history and HTTP-response-only append semantics.
- `plans/P1C.06c-implementation-plan.md`: create this execution plan.
- `ARCHITECTURE.MD`: no update. This is console-local UI state with no architecture contract change.
- DEC: no new decision record. This is an implementation extension of DEC-043 and does not introduce a new vendor or non-obvious architectural trade-off.
- API / contract docs: no update. No endpoint or public OpenAPI change.
- Runbooks: no update. No operational process or alert changes.
- Migration notes: no update. No schema/config migration.
- Changelog: no user-facing public API change; console README is sufficient.

## Test Strategy

- Unit: reducer prepends, FIFO-evicts at 50, clears, redacts display values, and formats relative time.
- Component: dark-panel drawer empty state, clear action, select action, and existing response/curl states.
- Component: execution panel appends only after HTTP responses, excludes network failures, and restores pending history config without firing.
- Component: command palette opens the request-history drawer through its action list only.
- Hook: route-level shortcuts do not run while history drawer is open.
- Regression: existing playground key-safety, curl-honesty, hotkey, and route tests continue to pass.
- Manual verification: fire demo/account request, open drawer, reload entry, confirm no browser storage, reload page and confirm history clears.

## Risk & Rollback

- Risk: history accidentally becomes persistent. Mitigation: no storage APIs, reducer-only state, tests/docs guardrail. Rollback by reverting P1C.06c files.
- Risk: non-response failures pollute history. Mitigation: append only in the `try` branch after a `PlaygroundResponse`. Rollback by removing append call.
- Risk: history stores sensitive values in visible UI. Mitigation: display-only key-shaped redaction and telemetry allowlist. Underlying memory clears with history; no persistence.

No shipped data is irreversible because the feature is client memory only.

## Open Questions

- None for implementation.

## Estimate

- Phase 1: 0.5 day.
- Phase 2: 0.5 day.
- Phase 3: 0.5 day.
- Phase 4: 0.5 day.

## File Checklist

| Phase | File | Change | Doc update |
| --- | --- | --- | --- |
| 1 | `apps/console/features/playground/types.ts` | Add history and telemetry contracts | No |
| 1 | `apps/console/features/playground/lib/history.ts` | Add reducer and display helpers | No |
| 1 | `apps/console/features/playground/lib/history.test.ts` | Reducer/redaction/time tests | No |
| 2 | `apps/console/features/playground/components/PlaygroundPanel.tsx` | Root memory state, clear/reload wiring, telemetry | No |
| 2 | `apps/console/features/playground/components/PlaygroundExecutionPanel.tsx` | Append/restore history entries | No |
| 2 | `apps/console/features/playground/components/PlaygroundExecutionPanel.test.tsx` | Append/exclusion/restore tests | No |
| 3 | `apps/console/features/playground/components/PlaygroundDarkPanel.tsx` | History drawer and trigger | No |
| 3 | `apps/console/features/playground/components/PlaygroundDarkPanel.test.tsx` | Drawer tests | No |
| 3 | `apps/console/features/playground/components/PlaygroundCommandPalette.tsx` | Open-history action only; no recent-request group | No |
| 3 | `apps/console/features/playground/components/PlaygroundCommandPalette.test.tsx` | Action-list coverage | No |
| 3 | `apps/console/features/playground/hooks/usePlaygroundHotkeys.test.tsx` | Drawer-open shortcut boundary test | No |
| 4 | `apps/console/README.md` | Document P1C.06c behavior | Yes |
| 4 | `apps/console/HINTS.md` | Add agent guardrail | Yes |
| 4 | `plans/P1C.06c-implementation-plan.md` | Commit implementation plan | Yes |

Summary: P1C.06c: 4 phases, 3 doc updates, 0 open questions.
