// V1 visual-overhaul check (part 1 of 3): graphite tray + inset boxes +
// tight packing. Serve app/ui/dist, drive the mock with playwright-core.
import { chromium } from "../tools-shot/node_modules/playwright-core/index.mjs";

const BASE = process.env.V1_BASE || "http://localhost:4173/";
const errors = [];
const failed = [];
function ok(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed.push(name);
}

function parseRgb(s) {
  const m = String(s).match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?/,
  );
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

function compositeOver(fg, bg) {
  const a = fg[3];
  return [
    a * fg[0] + (1 - a) * bg[0],
    a * fg[1] + (1 - a) * bg[1],
    a * fg[2] + (1 - a) * bg[2],
  ];
}

function luminanceOf(rgb) {
  const lin = (v) => {
    v = v / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});

const st = () => page.evaluate(() => window.__speculum.getState());
const setZoom = (z) => page.evaluate((zz) => window.__speculum.setZoom(zz), z);

async function openDiagram(theme, diagram) {
  await page.goto(`${BASE}?theme=${theme}&diagram=${diagram}`, {
    waitUntil: "networkidle",
  });
  await page.locator('[data-testid^="box-"]').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(900);
}

// Fresh session, then open the made-up sample once (persists in storage).
await page.goto(BASE + "?mock=fresh&theme=dark", { waitUntil: "networkidle" });
await page.getByTestId("empty-open-sample").waitFor({ timeout: 15000 });
await page.getByTestId("empty-open-sample").click();
await page.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
await page.waitForTimeout(800);

/** Tray + inset assertions for the current scoped level. */
async function assertTray(label, theme) {
  const colors = await page.evaluate(() => {
    const canvas =
      document.querySelector('[data-testid="canvas"]') || document.body;
    const frame = document.querySelector('[data-testid="scope-frame"]');
    const box = document.querySelector('[data-testid^="box-"]');
    if (!frame || !box) return null;
    const cs = getComputedStyle(frame);
    return {
      canvasBg: getComputedStyle(canvas).backgroundColor,
      frameBg: cs.backgroundColor,
      frameBorderStyle: cs.borderTopStyle,
      frameBorderWidth: cs.borderTopWidth,
      frameRadius: cs.borderTopLeftRadius,
      boxBg: getComputedStyle(box).backgroundColor,
      labelSize: getComputedStyle(frame.querySelector(".scope-frame__label")).fontSize,
      subText: frame.querySelector(".scope-frame__sub")?.textContent ?? null,
    };
  });
  ok(`${label}: scope frame rendered`, colors != null, JSON.stringify(colors?.frameBg));
  if (colors == null) return;
  const canvas = parseRgb(colors.canvasBg);
  let frame = parseRgb(colors.frameBg);
  let box = parseRgb(colors.boxBg);
  ok(`${label}: colors parse`, canvas != null && frame != null && box != null);
  if (canvas == null || frame == null || box == null) return;
  if (frame[3] < 1) frame = [...compositeOver(frame, canvas), 1];
  if (box[3] < 1) box = [...compositeOver(box, frame), 1];
  ok(`${label}: frame background is not transparent`, parseRgb(colors.frameBg)[3] > 0);
  // Tray reads 2-8% off the canvas (average channel delta / 255).
  const diff =
    (Math.abs(frame[0] - canvas[0]) + Math.abs(frame[1] - canvas[1]) + Math.abs(frame[2] - canvas[2])) /
    3 /
    255;
  const frameLighter = luminanceOf(frame) > luminanceOf(canvas);
  const dirOk = theme === "dark" ? frameLighter : !frameLighter;
  ok(
    `${label}: frame ${theme === "dark" ? "lighter" : "darker (light mirror)"} than canvas, diff 2-8%`,
    dirOk && diff >= 0.02 && diff <= 0.08,
    `diff=${(diff * 100).toFixed(1)}%`,
  );
  ok(`${label}: frame border solid`, colors.frameBorderStyle === "solid", colors.frameBorderStyle);
  ok(`${label}: frame border is 1px`, colors.frameBorderWidth === "1px", colors.frameBorderWidth);
  ok(`${label}: frame radius is 12px`, colors.frameRadius === "12px", colors.frameRadius);
  // Inset boxes: dark -> darker than frame and canvas; light (white boxes
  // on grey, the spec 4.1 mirror) -> lighter than both.
  const boxLum = luminanceOf(box);
  const insetOk =
    theme === "dark"
      ? boxLum < luminanceOf(frame) && boxLum < luminanceOf(canvas)
      : boxLum > luminanceOf(frame) && boxLum > luminanceOf(canvas);
  ok(
    `${label}: box fill ${theme === "dark" ? "darker" : "lighter (light mirror)"} than frame + canvas`,
    insetOk,
    `box=${colors.boxBg}`,
  );
  ok(`${label}: frame title is 16px`, colors.labelSize === "16px", colors.labelSize);
  ok(
    `${label}: frame sub line "<Kind> | <caption>"`,
    colors.subText != null && /\|/.test(colors.subText),
    colors.subText ?? "(none)",
  );
  // Parent port hidden until hover/connect.
  const portOpacity = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="parent-port"]');
    return p ? getComputedStyle(p).opacity : null;
  });
  ok(`${label}: parent port hidden at rest`, portOpacity === "0", `opacity=${portOpacity}`);
}

/** Tight-packing assertions from the debug rects + frame rect. */
async function assertPacking(label) {
  const s = await st();
  const rects = s.rects;
  const ids = Object.keys(rects);
  ok(`${label}: boxes are 120x120`, ids.length > 0 && ids.every((id) => rects[id].w === 120 && rects[id].h === 120));
  // 60px column gaps (step 180), 60-or-120 row steps.
  const xs = [...new Set(ids.map((id) => rects[id].x))].sort((a, b) => a - b);
  const xOk = xs.slice(1).every((x, i) => Math.abs(x - xs[i] - 180) < 0.01);
  ok(`${label}: 60px column gaps (step 180)`, xOk, `xs=${xs.join(",")}`);
  const ys = [...new Set(ids.map((id) => rects[id].y))].sort((a, b) => a - b);
  const yOk = ys.slice(1).every((x, i) => {
    const step = x - ys[i] - 120;
    return Math.abs(step - 60) < 0.01 || Math.abs(step - 120) < 0.01;
  });
  ok(`${label}: 60px gaps (120 under labelled rows)`, yOk, `ys=${ys.join(",")}`);
  // Frame padding 30/30/30/72 (±2).
  const f = s.frameRect;
  const minX = Math.min(...ids.map((id) => rects[id].x));
  const minY = Math.min(...ids.map((id) => rects[id].y));
  const maxX = Math.max(...ids.map((id) => rects[id].x + rects[id].w));
  const maxY = Math.max(...ids.map((id) => rects[id].y + rects[id].h));
  const pads = f
    ? {
        left: minX - f.x,
        top: minY - f.y,
        right: f.x + f.w - maxX,
        bottom: f.y + f.h - maxY,
      }
    : null;
  ok(`${label}: frame rect present`, f != null, JSON.stringify(f));
  if (pads) {
    ok(
      `${label}: frame padding 30/30/30/72 (±2)`,
      Math.abs(pads.left - 30) <= 2 &&
        Math.abs(pads.right - 30) <= 2 &&
        Math.abs(pads.bottom - 30) <= 2 &&
        Math.abs(pads.top - 72) <= 2,
      JSON.stringify(pads),
    );
  }
  // No overlaps.
  let overlap = null;
  for (let i = 0; i < ids.length && !overlap; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = rects[ids[i]];
      const b = rects[ids[j]];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        overlap = `${ids[i]}<>${ids[j]}`;
        break;
      }
    }
  }
  ok(`${label}: no box overlaps`, overlap == null, overlap ?? `${ids.length} boxes`);
  // Level opens at >= 90% zoom.
  const z = s.viewport?.zoom ?? s.zoom ?? 1;
  ok(`${label}: opens at >= 90% zoom`, z >= 0.9, `zoom=${z}`);
}

/** No edge label pill covers a box (100% zoom). */
async function assertNoLabelOverlap(label) {
  await setZoom(1);
  await page.waitForTimeout(500);
  const res = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-testid^="box-"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const labels = [...document.querySelectorAll('[data-testid="spec-edge-label"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, t: el.textContent ?? "" };
    });
    const hit = (a, b, inset) =>
      a.x + inset < b.x + b.w - inset && b.x + inset < a.x + a.w - inset &&
      a.y + inset < b.y + b.h - inset && b.y + inset < a.y + a.h - inset;
    return {
      n: labels.length,
      badBox: labels.filter((l) => boxes.some((b) => hit(l, b, 1))).map((l) => l.t),
    };
  });
  ok(`${label}: labels render at 100%`, res.n >= 1, `labels=${res.n}`);
  ok(`${label}: no label covers a box`, res.badBox.length === 0, res.badBox.slice(0, 3).join(" | "));
}

// Storefront Apps, dark -------------------------------------------------------
await openDiagram("dark", "dg-storefront");
await assertTray("apps-dark", "dark");
await assertPacking("apps-dark");
await assertNoLabelOverlap("apps-dark");
await page.screenshot({ path: "screenshots/v1-apps-dark.png" });

// Storefront Apps, light ------------------------------------------------------
await openDiagram("light", "dg-storefront");
await assertTray("apps-light", "light");
await assertPacking("apps-light");
await assertNoLabelOverlap("apps-light");
await page.screenshot({ path: "screenshots/v1-apps-light.png" });

// Landscape, dark (wide 220x110 variant, same 60px-gap packing) ---------------
await openDiagram("dark", "dg-landscape");
{
  const s = await st();
  const rects = s.rects;
  const ids = Object.keys(rects);
  ok(
    "landscape: boxes are 220x110",
    ids.length > 0 && ids.every((id) => rects[id].w === 220 && rects[id].h === 110),
  );
  const xs = [...new Set(ids.map((id) => rects[id].x))].sort((a, b) => a - b);
  ok("landscape: 60px column gaps (step 280)", xs.slice(1).every((x, i) => Math.abs(x - xs[i] - 280) < 0.01), `xs=${xs.join(",")}`);
  ok("landscape: no scope frame", s.scope == null && s.frameRect == null);
  const z = s.viewport?.zoom ?? 1;
  ok("landscape: opens at >= 90% zoom", z >= 0.9, `zoom=${z}`);
}
await assertNoLabelOverlap("landscape-dark");
await page.screenshot({ path: "screenshots/v1-landscape-dark.png" });

// One deeper level (drill Web App -> auto-packed 120 squares), dark -----------
await openDiagram("dark", "dg-storefront");
await page.getByTestId("box-obj-webapp").hover();
await page.getByTestId("drill-obj-webapp").click();
await page.getByTestId("box-obj-cart").waitFor({ timeout: 15000 });
await page.waitForTimeout(900);
await assertTray("deep-dark", "dark");
await assertPacking("deep-dark");
await assertNoLabelOverlap("deep-dark");
await page.screenshot({ path: "screenshots/v1-deep-dark.png" });

ok("no console/page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close();
if (failed.length > 0) {
  console.log("FAILED: " + failed.join(", "));
  process.exit(1);
}
console.log("v1-check: ALL PASS");
