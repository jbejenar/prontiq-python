# Token Package Rules

- This package owns the frontend token contract for `apps/landing` and `apps/console`.
- The app-facing contract is the emitted `tokens.css` and `@prontiq/tokens/preset`.
- Emit shadcn-compatible semantic tokens plus compatibility `--color-*` aliases.
- Keep build output deterministic and local to `dist/`.
- Keep Mintlify and SES artifact emission aligned with the same token source.
