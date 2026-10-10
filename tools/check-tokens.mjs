#!/usr/bin/env node
// Contrast + freshness checks for design tokens (no dependencies).
//   node tools/check-tokens.mjs
// Prints a table; exits non-zero on any failure.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const tokensPath = join(root, "tokens", "tokens.json");
const tokens = JSON.parse(readFileSync(tokensPath, "utf8"));

// ---- color utils -----------------------------------------------------------
function parseColor(s) {
  s = s.trim();
  let m = s.match(/^#([0-9a-fA-F]{6})$/);
  if (m) {
    const h = m[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  m = s.match(/^#([0-9a-fA-F]{3})$/);
  if (m) {
    const h = m[1];
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
      a: 1,
    };
  }
  m = s.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*([\d.]+)\s*)?\)$/,
  );
  if (m) {
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] === undefined ? 1 : Number(m[4]),
    };
  }
  throw new Error(`cannot parse color: ${s}`);
}
function compositeOver(fg, bg) {
  // fg may have alpha; bg is opaque {r,g,b}
  const a = fg.a;
  return {
    r: a * fg.r + (1 - a) * bg.r,
    g: a * fg.g + (1 - a) * bg.g,
    b: a * fg.b + (1 - a) * bg.b,
  };
}
function toOpaque(colorStr, bgStr) {
  const c = parseColor(colorStr);
  if (c.a >= 1) return { r: c.r, g: c.g, b: c.b };
  return compositeOver(c, parseColor(bgStr));
}
function lin(v) {
  v = v / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance(rgb) {
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}
function ratio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// ---- checks ----------------------------------------------------------------
const rows = []; // {check, fg, bg, ratio, min, pass}
function addCheck(name, fgStr, bgStr, min, opts = {}) {
  // opts.over: composite fg over this color first (for translucent tag bgs)
  let fg = parseColor(fgStr);
  const bg = parseColor(bgStr);
  if (fg.a < 1) {
    const over = opts.over ? parseColor(opts.over) : bg;
    fg = compositeOver(fg, over);
    if (opts.over) {
      // then that composite sits on bg
      fg = compositeOver({ ...fg, a: 1 }, bg);
    }
  }
  const r = ratio(fg, bg);
  rows.push({
    check: name,
    fg: fgStr,
    bg: opts.over ? `${fgStr} over ${opts.over} on ${bgStr}` : bgStr,
    ratio: r,
    min,
    pass: r >= min - 1e-9,
  });
}

for (const theme of ["dark", "light"]) {
  const c = tokens.color[theme];
  for (const surface of ["bg.chrome", "bg.canvas", "bg.raised"]) {
    addCheck(`${theme} text.primary on ${surface}`, c["text.primary"], c[surface], 4.5);
    addCheck(`${theme} text.secondary on ${surface}`, c["text.secondary"], c[surface], 4.5);
    addCheck(`${theme} text.tertiary on ${surface}`, c["text.tertiary"], c[surface], 3.0);
  }
  addCheck(`${theme} accent.on on accent.primary`, c["accent.on"], c["accent.primary"], 4.5);
  for (const [name, t] of Object.entries(tokens.tags)) {
    const entry = t[theme];
    if (theme === "dark") {
      addCheck(`tag ${name} (${theme}) fg on bg`, entry.fg, c["bg.raised"], 4.5, {
        over: c["bg.raised"],
      });
      // NOTE: addCheck composites fg-with-alpha over `over`, then onto bg.
      // For tags we actually need bg-with-alpha composited over raised:
      // recompute directly for accuracy:
      const last = rows[rows.length - 1];
      const bgOpaque = toOpaque(entry.bg, c["bg.raised"]);
      last.ratio = ratio(parseColor(entry.fg), bgOpaque);
      last.bg = `${entry.fg} on ${entry.bg} over ${c["bg.raised"]}`;
      last.pass = last.ratio >= 4.5 - 1e-9;
    } else {
      addCheck(`tag ${name} (${theme}) fg on bg`, entry.fg, entry.bg, 4.5);
    }
  }
}

// ---- report ----------------------------------------------------------------
const w = (s, n) => String(s).padEnd(n);
console.log(
  w("check", 46) + w("ratio", 8) + w("min", 6) + "result",
);
console.log("-".repeat(72));
let fail = 0;
for (const r of rows) {
  const mark = r.pass ? "PASS" : "FAIL";
  if (!r.pass) fail++;
  console.log(
    w(r.check, 46) + w(r.ratio.toFixed(2), 8) + w(r.min.toFixed(1), 6) + mark,
  );
  if (!r.pass) console.log(`      fg=${r.fg}  bg=${r.bg}`);
}
console.log("-".repeat(72));
console.log(`${rows.length - fail}/${rows.length} contrast checks passed`);

// ---- freshness: generated files up to date? --------------------------------
try {
  execFileSync(process.execPath, [join(here, "gen-tokens.mjs"), "--check"], {
    stdio: "inherit",
  });
} catch {
  console.error("generated token files are stale (gen-tokens --check failed)");
  fail++;
}

if (fail > 0) {
  console.error(`check-tokens: ${fail} failure(s)`);
  process.exit(1);
}
console.log("check-tokens: OK");
