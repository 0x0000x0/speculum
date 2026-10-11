#!/usr/bin/env node
// Generates theme assets from tokens/tokens.json (no dependencies).
//   node tools/gen-tokens.mjs           -> write files
//   node tools/gen-tokens.mjs --check   -> exit 1 if generated files are stale
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const tokensPath = join(root, "tokens", "tokens.json");
const cssPath = join(root, "app", "ui", "src", "theme", "tokens.css");
const rsPath = join(root, "crates", "speculum-render", "src", "tokens.rs");

const tokens = JSON.parse(readFileSync(tokensPath, "utf8"));

// ---- helpers ---------------------------------------------------------------
function cssColorVarName(role) {
  // "bg.chrome" -> "--sp-color-bg-chrome"
  return "--sp-color-" + role.replace(/\./g, "-");
}
function rsColorConstName(role) {
  // "bg.chrome" -> "BG_CHROME"
  return role.replace(/\./g, "_").replace(/-/g, "_").toUpperCase();
}
function spaceVarName(key) {
  return "--sp-space-" + key.replace(/^space\./, "").replace(/\./g, "_");
}
function rsSpaceConstName(key) {
  return "SPACE_" + key.replace(/^space\./, "").replace(/\./g, "_").toUpperCase();
}
function quoteFontStack(arr) {
  return arr
    .map((f) => (/^[A-Za-z][A-Za-z0-9-]*$/.test(f) ? f : `"${f}"`))
    .join(", ");
}

// ---- CSS -------------------------------------------------------------------
function themeColorBlock(theme) {
  const lines = [];
  const colors = tokens.color[theme];
  for (const [role, value] of Object.entries(colors)) {
    lines.push(`  ${cssColorVarName(role)}: ${value};`);
  }
  for (const [level, value] of Object.entries(tokens.shadow[theme])) {
    lines.push(`  --sp-shadow-${level}: ${value};`);
  }
  for (const [name, t] of Object.entries(tokens.tags)) {
    const entry = t[theme];
    lines.push(`  --sp-tag-${name}-bg: ${entry.bg};`);
    lines.push(`  --sp-tag-${name}-fg: ${entry.fg};`);
    lines.push(`  --sp-tag-${name}-border: ${entry.border ?? "transparent"};`);
  }
  return lines.join("\n");
}

function buildCss() {
  const independent = [];
  for (const [key, px] of Object.entries(tokens.spacing)) {
    independent.push(`  ${spaceVarName(key)}: ${px}px;`);
  }
  const L = tokens.layout;
  independent.push(`  --sp-layout-toolbar-height: ${L.toolbarHeight}px;`);
  independent.push(`  --sp-layout-side-panel-width: ${L.sidePanelWidth}px;`);
  independent.push(`  --sp-layout-side-panel-min: ${L.sidePanelMin}px;`);
  independent.push(`  --sp-layout-side-panel-max: ${L.sidePanelMax}px;`);
  independent.push(`  --sp-layout-status-bar-height: ${L.statusBarHeight}px;`);
  independent.push(`  --sp-layout-canvas-padding: ${L.canvasPadding}px;`);
  if (L.boxS !== undefined) independent.push(`  --sp-box-s: ${L.boxS}px;`);
  if (L.boxWideW !== undefined) independent.push(`  --sp-box-wide-w: ${L.boxWideW}px;`);
  if (L.boxWideH !== undefined) independent.push(`  --sp-box-wide-h: ${L.boxWideH}px;`);
  if (L.cell !== undefined) independent.push(`  --sp-cell: ${L.cell}px;`);
  if (L.gap !== undefined) independent.push(`  --sp-gap: ${L.gap}px;`);
  if (L.gapLabelRow !== undefined) independent.push(`  --sp-gap-label-row: ${L.gapLabelRow}px;`);
  if (L.framePad !== undefined) {
    independent.push(`  --sp-frame-pad: ${L.framePad}px;`);
    independent.push(`  --sp-layout-frame-pad: ${L.framePad}px;`);
  }
  if (L.frameHeader !== undefined) {
    independent.push(`  --sp-frame-header: ${L.frameHeader}px;`);
    independent.push(`  --sp-layout-frame-header: ${L.frameHeader}px;`);
  }
  if (L.ctxChildS !== undefined) independent.push(`  --sp-ctx-child: ${L.ctxChildS}px;`);
  if (L.ctxGap !== undefined) independent.push(`  --sp-ctx-gap: ${L.ctxGap}px;`);
  if (L.ctxPad !== undefined) independent.push(`  --sp-ctx-pad: ${L.ctxPad}px;`);
  if (L.ctxHeader !== undefined) independent.push(`  --sp-ctx-header: ${L.ctxHeader}px;`);
  if (L.ctxTrayGap !== undefined) independent.push(`  --sp-ctx-tray-gap: ${L.ctxTrayGap}px;`);
  if (L.leftBarWidth !== undefined) independent.push(`  --sp-layout-left-bar-width: ${L.leftBarWidth}px;`);
  if (L.toolHit !== undefined) independent.push(`  --sp-layout-tool-hit: ${L.toolHit}px;`);
  if (L.toolGlyph !== undefined) independent.push(`  --sp-layout-tool-glyph: ${L.toolGlyph}px;`);
  for (const [name, t] of Object.entries(tokens.type)) {
    independent.push(`  --sp-type-${name}-size: ${t.size}px;`);
    independent.push(`  --sp-type-${name}-weight: ${t.weight};`);
    independent.push(`  --sp-type-${name}-line: ${t.lineHeight};`);
  }
  independent.push(`  --sp-font-ui: ${quoteFontStack(tokens.font.ui)};`);
  independent.push(`  --sp-font-mono: ${quoteFontStack(tokens.font.mono)};`);
  for (const [name, px] of Object.entries(tokens.radius)) {
    independent.push(`  --sp-radius-${name}: ${px}px;`);
  }
  independent.push(`  --sp-motion-fast: ${tokens.motion.fast};`);
  independent.push(`  --sp-motion-base: ${tokens.motion.base};`);
  independent.push(`  --sp-motion-drill: ${tokens.motion.drill};`);
  if (tokens.motion.tooltipDelay) {
    independent.push(`  --sp-motion-tooltip-delay: ${tokens.motion.tooltipDelay};`);
  }
  independent.push(`  --sp-motion-ease: ${tokens.motion.ease};`);
  independent.push(`  --sp-dim-unrelated: ${tokens.color.dim.unrelatedOpacity};`);
  if (tokens.edge) {
    const E = tokens.edge;
    const px = (v) => (typeof v === "number" ? `${v}px` : v);
    if (E.stroke !== undefined) independent.push(`  --sp-edge-stroke: ${px(E.stroke)};`);
    if (E.strokeHi !== undefined) independent.push(`  --sp-edge-stroke-hi: ${px(E.strokeHi)};`);
    if (E.cornerRadius !== undefined) independent.push(`  --sp-edge-corner: ${px(E.cornerRadius)};`);
    if (E.labelMaxWidth !== undefined) independent.push(`  --sp-edge-label-max: ${px(E.labelMaxWidth)};`);
    if (E.portSize !== undefined) independent.push(`  --sp-edge-port: ${px(E.portSize)};`);
    if (E.framePadding !== undefined) independent.push(`  --sp-edge-frame-pad: ${px(E.framePadding)};`);
    if (E.arrowMin !== undefined) independent.push(`  --sp-edge-arrow-min: ${px(E.arrowMin)};`);
    if (E.fanStep !== undefined) independent.push(`  --sp-edge-fan-step: ${px(E.fanStep)};`);
  }

  return (
    `/* GENERATED — do not edit by hand. Source: tokens/tokens.json.\n` +
    `   Regenerate with: pnpm tokens (runs tools/gen-tokens.mjs). */\n` +
    `:root[data-theme="dark"] {\n  color-scheme: dark;\n${themeColorBlock("dark")}\n}\n\n` +
    `:root[data-theme="light"] {\n  color-scheme: light;\n${themeColorBlock("light")}\n}\n\n` +
    `:root {\n${independent.join("\n")}\n}\n`
  );
}

// ---- Rust ------------------------------------------------------------------
function rsThemeBlock(theme) {
  const out = [];
  for (const [role, value] of Object.entries(tokens.color[theme])) {
    out.push(`    pub const ${rsColorConstName(role)}: &str = "${value}";`);
  }
  for (const [level, value] of Object.entries(tokens.shadow[theme])) {
    out.push(`    pub const SHADOW_${level.toUpperCase()}: &str = "${value}";`);
  }
  return out.join("\n");
}
function rsTagsBlock(theme) {
  const out = [];
  for (const [name, t] of Object.entries(tokens.tags)) {
    const entry = t[theme];
    const mod = name.toUpperCase();
    out.push(`        pub mod ${name} {`);
    out.push(`            pub const BG: &str = "${entry.bg}";`);
    out.push(`            pub const FG: &str = "${entry.fg}";`);
    out.push(
      `            pub const BORDER: &str = "${entry.border ?? "transparent"}";`,
    );
    out.push(`        }`);
    void mod;
  }
  return out.join("\n");
}

function buildRs() {
  const layoutConsts = tokens.layout
    ? Object.entries(tokens.layout)
        .map(
          ([k, v]) =>
            `    pub const ${k.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}: u32 = ${v};`,
        )
        .join("\n")
    : "";
  const spacing = Object.entries(tokens.spacing)
    .map(([k, v]) => `    pub const ${rsSpaceConstName(k)}: u32 = ${v};`)
    .join("\n");
  const radii = Object.entries(tokens.radius)
    .map(([k, v]) => `    pub const ${k.toUpperCase()}: u32 = ${v};`)
    .join("\n");
  const fontSizes = Object.entries(tokens.type)
    .map(
      ([k, v]) =>
        `    pub const ${k.replace(/-/g, "_").toUpperCase()}: u32 = ${v.size};`,
    )
    .join("\n");
  const fontWeights = Object.entries(tokens.type)
    .map(
      ([k, v]) =>
        `    pub const ${k.replace(/-/g, "_").toUpperCase()}_WEIGHT: u32 = ${v.weight};`,
    )
    .join("\n");

  return (
    `//! GENERATED — do not edit by hand. Source: tokens/tokens.json.\n` +
    `//! Regenerate with: node tools/gen-tokens.mjs.\n\n` +
    `/// Design tokens for the \`dark\` theme (CSS hex / rgba strings).\n` +
    `pub mod dark {\n${rsThemeBlock("dark")}\n\n` +
    `    /// Tag palette for the \`dark\` theme.\n` +
    `    pub mod tags {\n${rsTagsBlock("dark")}\n    }\n}\n\n` +
    `/// Design tokens for the \`light\` theme (CSS hex / rgba strings).\n` +
    `pub mod light {\n${rsThemeBlock("light")}\n\n` +
    `    /// Tag palette for the \`light\` theme.\n` +
    `    pub mod tags {\n${rsTagsBlock("light")}\n    }\n}\n\n` +
    `/// Layout constants in logical pixels (packing + frame geometry).\n` +
    `pub mod layout {\n${layoutConsts}\n}\n\n` +
    `/// Spacing scale in logical pixels.\n` +
    `pub mod spacing {\n${spacing}\n}\n\n` +
    `/// Corner radii in logical pixels (\`PILL\` is effectively fully rounded).\n` +
    `pub mod radii {\n${radii}\n}\n\n` +
    `/// Type sizes in logical pixels.\n` +
    `pub mod font_size {\n${fontSizes}\n}\n\n` +
    `/// Type weights (CSS numeric weights).\n` +
    `pub mod font_weight {\n${fontWeights}\n}\n`
  );
}

// ---- main ------------------------------------------------------------------
const check = process.argv.includes("--check");
const css = buildCss();
const rs = buildRs();

if (check) {
  let stale = false;
  for (const [path, fresh] of [
    [cssPath, css],
    [rsPath, rs],
  ]) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== fresh) {
      console.error(`stale: ${path} (run: node tools/gen-tokens.mjs)`);
      stale = true;
    }
  }
  if (stale) process.exit(1);
  console.log("tokens fresh: tokens.css, tokens.rs");
} else {
  writeFileSync(cssPath, css);
  writeFileSync(rsPath, rs);
  console.log(`wrote ${cssPath}`);
  console.log(`wrote ${rsPath}`);
}
