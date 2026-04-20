# @prontiq/tokens

Frontend token package for `apps/landing` and `apps/console`.

`@prontiq/tokens` owns the shared theming contract for the frontend apps. It emits:

- `tokens.css`
- `tailwind-preset.js`
- `mint-theme.json`
- `ses-vars.json`

The app-facing contract is:

- `@prontiq/tokens/tokens.css` for CSS variables
- `@prontiq/tokens/preset` for the Tailwind preset

The CSS output includes both shadcn-compatible semantic HSL variables and compatibility `--color-*` aliases for existing consumers.
