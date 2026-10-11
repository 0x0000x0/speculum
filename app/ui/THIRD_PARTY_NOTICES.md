# Third-party notices (app/ui runtime dependencies)

This file credits the third-party packages shipped with the Speculum UI.
The canvas keeps the React Flow attribution badge visible
(`attributionPosition="bottom-right"`, themed via token vars); this file
keeps the credit as well.

## @xyflow/react (MIT, xyflow GmbH)

- Package: `@xyflow/react` — React Flow, the node-graph canvas library.
- License: MIT. Copyright (c) 2018-2026 xyflow GmbH.
- Used for: pan/zoom canvas, box nodes, edges, selection, viewport.

## Other runtime dependencies

- `react` + `react-dom` (MIT, Meta Platforms, Inc. and contributors) — UI framework.
- `@tauri-apps/api` (MIT OR Apache-2.0, Tauri Programme) — bridge to the Rust backend.
- `@fontsource-variable/inter` (OFL-1.0, Rasmus Andersson) — Inter Variable font files.
- `@fontsource/jetbrains-mono` (OFL-1.0, JetBrains) — JetBrains Mono font files.

Build/dev-only tooling (`typescript`, `vite`, `@vitejs/plugin-react`,
`@tauri-apps/cli`, `@types/*`) is not shipped to end users; see each
package's published license (all MIT or Apache-2.0).
