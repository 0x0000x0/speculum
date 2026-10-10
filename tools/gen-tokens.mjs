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
  independent.push(`  --sp-motion-ease: ${tokens.motion.ease};`);
  independent.push(`  --sp-dim-unrelated: ${tokens.color.dim.unrelatedOpacity};`);

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
