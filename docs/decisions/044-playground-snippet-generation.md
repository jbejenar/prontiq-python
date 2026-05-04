# ADR-044: Playground Multi-Language Snippet Generation

## Status

Accepted

## Context

P1C.06d turns the playground's language tabs from placeholders into runnable
examples for the currently configured public API request. Snippets must stay
production-shaped, use `{{YOUR_API_KEY}}` by default, avoid raw-key leakage, and
update from the same OpenAPI-derived operation/config state as the curl preview.

The feature needs request snippets, not full SDK generation. It also needs to
stay client-local: no extra backend route or snippet-generation service should
be added for playground v1.

## Decision

Use `@httptoolkit/httpsnippet@3.0.2` behind a playground-local lazy import for
non-curl language tabs. The existing Prontiq `buildCurlCommand` remains the
source of truth for curl. Non-curl tabs build a minimal HAR request from the
selected operation, current params/body, `NEXT_PUBLIC_API_URL`, and placeholder
`X-Api-Key: {{YOUR_API_KEY}}`, then convert it to:

- `node.js`: JavaScript `fetch` output, to preserve the Node 18+ native Fetch
  intent instead of emitting the package's `node-fetch` variant.
- `python`: `requests`.
- `java`: native Java 11+ `HttpClient`.
- `go`: native `net/http`.
- `ruby`: native `net/http`.

The package is loaded only on first non-curl activation and cached for the tab
session. Snippet generation does not emit telemetry payloads, persist request
configuration, or include raw account keys.

## Consequences

- The initial curl-only playground path does not pay the snippet package load
  cost.
- Copied examples remain honest: production API URL, placeholder API key, and
  no console demo proxy URL.
- The Node tab follows product intent over the package's literal `node/fetch`
  target because that target imports `node-fetch`.
- Future package upgrades require rerunning snippet output, raw-key, and browser
  bundling tests because the package is CommonJS and broad in supported targets.

## Alternatives Considered

- Full SDK generators such as OpenAPI Generator or Swagger Codegen: rejected
  because they generate multi-file client packages and introduce toolchain
  complexity unrelated to single request snippets.
- Hand-written generators for all non-curl languages: rejected for this ticket
  because it would increase maintenance surface and duplicate a solved request
  formatting problem.
- Server-side snippet generation: rejected because snippets are derived from
  client-held playground state and do not need a new backend surface.
- The package's `node/fetch` target: rejected because it emits a `node-fetch`
  import, which conflicts with the planned Node 18+ native Fetch example.

---

_Date: 2026-05-04_
_Decision makers: Prontiq engineering_
