# Third-party fonts

Speculum bundles its fonts locally — no CDN, no network requests at runtime.
Vite copies the `woff2` files into `dist/` at build time via the imports in
`app/ui/src/main.tsx`.

| Package | Family | License | Used as |
| --- | --- | --- | --- |
| `@fontsource-variable/inter` | Inter Variable | SIL Open Font License 1.1 (OFL-1.1) | UI type (`font.ui` token) |
| `@fontsource/jetbrains-mono` (weights 400, 500) | JetBrains Mono | SIL Open Font License 1.1 (OFL-1.1) | Mono type (`font.mono` token, kbd chips, counts) |

License texts ship inside each package (`node_modules/@fontsource-variable/inter/LICENSE`,
`node_modules/@fontsource/jetbrains-mono/LICENSE`).

Fallback stacks (used only if the bundled files fail to load) are defined in
`tokens/tokens.json`:

- UI: `"Inter Variable", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`
- Mono: `"JetBrains Mono", Consolas, monospace`
