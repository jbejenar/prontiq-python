# P1C.06b Implementation Plan

## Intent

Refine the existing Prontiq-owned playground curl preview so parameter changes feel immediate and understandable, without changing request execution, key handling, demo proxy behavior, Scalar boundaries, or curl honesty rules.

## Current State

`/playground` already renders a native dark panel with language tabs, a generated curl preview, a Run button, response metadata, response body, and footer status. `P1C.06a` added route-local shortcuts and the `Cmd/Ctrl+Enter` run handler. The current dark panel calls Prism directly on render and shows the run shortcut as static text beside the Run button.

## Constraints

- `buildCurlCommand` remains the only source of truth for curl text.
- No new dependencies, diff libraries, shortcut listeners, storage, proxy changes, or Scalar execution changes.
- Demo/account execution, raw-key memory rules, telemetry boundaries, and curl placeholder behavior are unchanged.
- The implementation stays inside `apps/console` playground components and docs.

## Approach

Keep the existing panel contract and improve only the rendering craft:

- Memoize highlighted code rendering so parent state changes do not force unnecessary Prism work.
- Track the previous curl string and compute the changed byte range with a prefix/suffix diff.
- Wrap the changed range in a short-lived highlighted span using CSS keyframes.
- Move the `Cmd/Ctrl+Enter` affordance into the Run button as a platform-neutral chip; the actual listener remains owned by `P1C.06a`.
- Keep visible shortcut labels centralized so the dark panel, command palette, operation rail, and README stay aligned.
- Expose the command-palette shortcut as a clickable dark-panel footer affordance so it is discoverable outside the operation filter.

## Phases

1. Dark panel rendering update
   - Files: `apps/console/features/playground/components/PlaygroundDarkPanel.tsx`
   - Contracts: no prop or behavior contract changes.
   - Rollout: component-only, immediately revertible.

2. Tests and docs
   - Files: `PlaygroundDarkPanel.test.tsx`, `apps/console/README.md`, `apps/console/HINTS.md`
   - Contracts: document source-of-truth and shortcut ownership.
   - Rollout: no migration.

## Documentation Updates

- `apps/console/README.md`: add `P1C.06b` note and keep shortcuts centralized.
- `apps/console/HINTS.md`: add implementation guardrail for curl source-of-truth and no duplicate listeners.
- `ARCHITECTURE.MD`: not needed; no architectural contract changes.
- DEC: not needed; no vendor or non-obvious architectural decision.
- API docs/runbooks/changelog: not needed; no API, operational, or user-facing contract change beyond visible UI polish.

## Test Strategy

- Unit/component tests verify the run shortcut chip renders inside the Run button.
- Unit/component tests verify changed curl content is highlighted when the command changes.
- Existing dark panel tests continue to verify curl visibility, demo-unavailable state, and response metadata.
- Full console `typecheck`, `test`, `lint`, and `build` must pass.

## Risk & Rollback

- Prism segment highlighting could render odd token boundaries for the highlighted segment. Rollback is a single component revert; request behavior is unaffected.
- The change highlight could persist if timers are mishandled. Tests cover update behavior; the timeout is component-local and cleaned up.
- The shortcut chip could duplicate visual affordances. The listener remains single-owned by `P1C.06a`; rollback removes only the chip.

## Open Questions

None.

## Estimate

- Phase 1: 0.5 day.
- Phase 2: 0.25 day.

## File Checklist

| Phase | File | Change | Doc update |
| --- | --- | --- | --- |
| 1 | `apps/console/features/playground/components/PlaygroundDarkPanel.tsx` | Memoized code block, changed-range highlight, inline run shortcut chip | No |
| 1 | `apps/console/features/playground/components/PlaygroundCommandPalette.tsx` | Use centralized run shortcut label | No |
| 1 | `apps/console/features/playground/components/EndpointGroupList.tsx` | Use centralized command-palette shortcut label | No |
| 1 | `apps/console/features/playground/lib/shortcut-labels.ts` | Centralized visible shortcut labels | No |
| 2 | `apps/console/features/playground/components/PlaygroundDarkPanel.test.tsx` | Component coverage for chip and changed-range highlight | No |
| 2 | `apps/console/features/playground/components/PlaygroundCommandPalette.test.tsx` | Coverage for centralized run shortcut label | No |
| 2 | `apps/console/features/playground/components/EndpointGroupList.test.tsx` | Coverage for centralized command-palette shortcut label | No |
| 2 | `apps/console/README.md` | Document `P1C.06b` behavior | Yes |
| 2 | `apps/console/HINTS.md` | Add curl preview implementation guardrail | Yes |

Summary: P1C.06b: 2 phases, 2 doc updates, 0 open questions.
