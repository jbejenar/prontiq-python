# Observability Package Rules

- This package owns Honeycomb trace export and shared backend tracing helpers.
- Keep secrets out of code and out of emitted span attributes.
- Default to allow-listed attributes only; drop anything unknown.
- Do not couple this package to `@prontiq/shared`.
- Keep local/CI behavior safe when `HONEYCOMB_API_KEY` is unset.
