// V3 visual-overhaul check (part 3 of 3): camera drill transition,
// floating breadcrumb card, faint neighbour trays.
// Serve app/ui/dist, drive the mock with playwright-core.
import { chromium } from "../tools-shot/node_modules/playwright-core/index.mjs";

const BASE = process.env.V3_BASE || "http://localhost:4173/";
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

function luminanceOf(rgb) {
  const lin = (v) => {
    v = v / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

async function expectTheme(page, shotName, want) {
  const { theme, bg } = await page.evaluate(() => {
    const t = document.documentElement.dataset.theme || "";
    const el =
      document.querySelector('[data-testid="canvas"]') ||
      document.querySelector(".app-main") ||
      document.body;
    return { theme: t, bg: getComputedStyle(el).backgroundColor };
  });
  const rgb = parseRgb(bg);
  const lum = rgb ? luminanceOf(rgb) : NaN;
  ok(`${shotName} renders ${want} theme`, theme === want, `data-theme=${theme}`);
  ok(
    `${shotName} background is ${want}`,
    rgb != null && (want === "dark" ? lum < 0.2 : lum >= 0.2),
    `bg=${bg} lum=${Number.isNaN(lum) ? "?" : lum.toFixed(3)}`,
  );
}

/** Flow-coords border test (mirrors edgeGeometry.isOnBorder, tol 1.5px). */
function onBorder(r, x, y, tol) {
  const dx = Math.min(Math.abs(x - r.x), Math.abs(x - (r.x + r.w)));
  const dy = Math.min(Math.abs(y - r.y), Math.abs(y - (r.y + r.h)));
  const insideX = x > r.x + tol && x < r.x + r.w - tol;
  const insideY = y > r.y + tol && y < r.y + r.h - tol;
  if (insideX && insideY) return false;
  if (x < r.x - tol || x > r.x + r.w + tol) return false;
  if (y < r.y - tol || y > r.y + r.h + tol) return false;
  return Math.min(dx, dy) <= tol;
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
const area = (r) => (r ? r.width * r.height : 0);

/** Poll drillAnim phases for up to ms, returning every distinct value seen. */
async function collectPhases(ms) {
  const seen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await st().catch(() => null);
    const p = s?.drillAnim ?? "idle";
    if (seen[seen.length - 1] !== p) seen.push(p);
    if (p === "idle" && seen.length > 1) break;
    await page.waitForTimeout(10);
  }
  return seen;
}

async function waitIdle(timeout = 5000) {
  await page.waitForFunction(() => window.__speculum.getState().drillAnim === "idle", {
    timeout,
  });
  await page.waitForFunction(() => window.__speculum.getState().animating === false, {
    timeout,
  });
}

// 1. fresh + sample (dark) ----------------------------------------------------
await page.goto(BASE + "?mock=fresh&theme=dark", { waitUntil: "networkidle" });
await page.getByTestId("empty-open-sample").waitFor({ timeout: 15000 });
await page.getByTestId("empty-open-sample").click();
await page.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
await page.waitForTimeout(800);

// Breadcrumb card on the top level -------------------------------------------
{
  const r = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
    const card = document.querySelector('[data-testid="breadcrumb-card"]').getBoundingClientRect();
    const bar = document.querySelector(".canvas-toolbar").getBoundingClientRect();
    return {
      dx: card.x - canvas.x,
      dy: card.y - canvas.y,
      h: card.height,
      overlap:
        card.x < bar.x + bar.width &&
        bar.x < card.x + card.width &&
        card.y < bar.y + bar.height &&
        bar.y < card.y + card.height,
    };
  });
  ok("breadcrumb card right of the left bar (bar + 12px inset)", Math.abs(r.dx - 56) <= 14, `dx=${r.dx.toFixed(1)}`);
  ok("breadcrumb card top inset 12px", Math.abs(r.dy - 12) <= 10, `dy=${r.dy.toFixed(1)}`);
  ok("breadcrumb card 40px tall", Math.abs(r.h - 40) <= 3, `h=${r.h.toFixed(1)}`);
  ok("breadcrumb card does not overlap the zoom group", !r.overlap);
  const backDisabled = await page.getByTestId("nav-back").isDisabled();
  const fwdDisabled = await page.getByTestId("nav-forward").isDisabled();
  ok("nav-back disabled with no history", backDisabled);
  ok("nav-forward disabled with no history", fwdDisabled);
  const icons = await page.locator('[data-testid="breadcrumb-card"] svg').count();
  ok("crumbs carry kind icons", icons >= 1, `icons=${icons}`);
  ok("last crumb marked current", (await page.locator(".crumb-card__crumb--current").count()) >= 1);
}

// 2. drill-in: camera zoom, growth frames, tray-where-box-was ------------------
const r0 = await page.getByTestId("box-obj-storefront").boundingBox();
ok("drill target present", r0 != null);
const phasesP = collectPhases(2500);
await page.getByTestId("drill-obj-storefront").click();
// Mid-transition screenshot (~120ms: camera zooming or swap morph).
await page.waitForTimeout(120);
await page.screenshot({ path: "screenshots/v3-drill-mid-dark.png" });
await expectTheme(page, "v3-drill-mid-dark.png", "dark");
// Growth: sample the target box while the old view is still up.
let grown = false;
let lastArea = area(r0);
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(25);
  const bb = await page.getByTestId("box-obj-storefront").boundingBox().catch(() => null);
  if (bb == null) break; // view swapped; fall through to the frame check
  lastArea = area(bb);
  if (lastArea > area(r0) * 1.05) {
    grown = true;
    break;
  }
}
if (!grown) {
  // Swap was faster than the poll: the tray must arrive grown instead.
  await page.locator('[data-testid="scope-frame"]').first().waitFor({ timeout: 5000 });
  const fr = await page.locator('[data-testid="scope-frame"]').boundingBox();
  grown = fr != null && area(fr) > area(r0);
  ok("tray arrives where the box was (grown)", grown, `box=${area(r0).toFixed(0)} frame=${fr ? area(fr).toFixed(0) : "?"}`);
} else {
  ok("target box grows mid-transition", grown, `${area(r0).toFixed(0)} -> ${lastArea.toFixed(0)}`);
}
// Tray lands centred where the zoomed box was (camera centred on it).
await page.locator('[data-testid="scope-frame"]').first().waitFor({ timeout: 5000 });
{
  const c = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
    const fr = document.querySelector('[data-testid="scope-frame"]').getBoundingClientRect();
    return {
      dx: Math.abs(fr.x + fr.width / 2 - (canvas.x + canvas.width / 2)),
      dy: Math.abs(fr.y + fr.height / 2 - (canvas.y + canvas.height / 2)),
    };
  });
  // Settle eases toward fit (centred); allow slack for the animation tail.
  ok("tray settles near the canvas centre", c.dx <= 220 && c.dy <= 220, `dx=${c.dx.toFixed(0)} dy=${c.dy.toFixed(0)}`);
}
const phases = await phasesP;
ok(
  "drill-in runs camera phases to idle",
  phases[phases.length - 1] === "idle" &&
    phases.some((p) => p === "in-swap" || p === "in-settle") &&
    (phases.includes("in-zoom") || phases.includes("in-swap")),
  phases.join(" > "),
);
await waitIdle();
{
  const s = await st();
  ok("drilled into Storefront", s.scope === "obj-storefront", `scope=${s.scope}`);
}

// 3. breadcrumb card on L1: back/forward + crumb clicks ------------------------
await page.screenshot({ path: "screenshots/v3-breadcrumb-dark.png" });
await expectTheme(page, "v3-breadcrumb-dark.png", "dark");
{
  ok("nav-back enabled after drill", await page.getByTestId("nav-back").isEnabled());
  await page.getByTestId("nav-back").click();
  await page.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
  await waitIdle();
  let s = await st();
  ok("nav-back returns to landscape", s.scope == null, `scope=${s.scope}`);
  ok("nav-forward enabled after back", await page.getByTestId("nav-forward").isEnabled());
  await page.getByTestId("nav-forward").click();
  await page.getByTestId("box-obj-webapp").waitFor({ timeout: 15000 });
  await waitIdle();
  s = await st();
  ok("nav-forward returns to storefront", s.scope === "obj-storefront", `scope=${s.scope}`);
  // Crumb click navigates up.
  await page.getByTestId("crumb-dg-landscape").click();
  await page.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
  await waitIdle();
  s = await st();
  ok("crumb click navigates to landscape", s.scope == null, `scope=${s.scope}`);
  // Drill again for the context-tray section.
  await page.getByTestId("drill-obj-storefront").click();
  await page.getByTestId("box-obj-webapp").waitFor({ timeout: 15000 });
  await waitIdle();
}

// 4. context trays on Storefront Apps ------------------------------------------
{
  const s = await st();
  ok("contextTrays in view", s.contextTrays.length >= 1, JSON.stringify(s.contextTrays.map((t) => t.objectId)));
  const tray = s.contextTrays[0];
  ok("tray has a deterministic side", tray.side === "left" || tray.side === "right", tray.side);
  ok("tray holds involved children", tray.children.length >= 1, JSON.stringify(tray.children));
  ok(
    "tray JSON shape {objectId,name,kind,caption,side,children[]}",
    ["objectId", "name", "kind", "caption", "side", "children"].every((k) => k in tray) &&
      ["objectId", "name", "kind"].every((k) => k in tray.children[0]),
  );
  const trayEl = page.getByTestId(`ctx-tray-${tray.objectId}`);
  ok("faint tray rendered", (await trayEl.count()) === 1);
  const childEl = page.getByTestId(`ctx-child-${tray.children[0].objectId}`);
  await childEl.waitFor({ timeout: 8000 });
  const sub = await trayEl.locator(".ctx-tray__sub").textContent();
  ok("tray label has mono Kind | caption", /System|App|Store|Actor|Component|Group/.test(sub ?? ""), sub ?? "");
  const radius = await trayEl.evaluate((el) => getComputedStyle(el).borderRadius);
  ok("tray radius 12px", radius.startsWith("12px"), radius);
  // Dimmed at rest...
  const restOpacity = await childEl.evaluate((el) => {
    const node = el.closest(".react-flow__node");
    return node ? Number(getComputedStyle(node).opacity) : NaN;
  });
  ok("tray children dimmed (~0.25)", Math.abs(restOpacity - 0.25) <= 0.08, `opacity=${restOpacity}`);
  // ...full strength on hover (park the mouse elsewhere first so the
  // hover crosses the node boundary).
  await page.mouse.move(700, 850);
  await page.waitForTimeout(200);
  await childEl.hover();
  let hotOpacity = 0;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    hotOpacity = await childEl.evaluate((el) => {
      const node = el.closest(".react-flow__node");
      return node ? Number(getComputedStyle(node).opacity) : NaN;
    });
    if (hotOpacity >= 0.95) break;
  }
  ok("tray child brightens on hover", hotOpacity >= 0.95, `opacity=${hotOpacity}`);
  // Links attach to tray children (endpoints on borders).
  const ctxEdges = await page.evaluate(() => {
    const s2 = window.__speculum.getState();
    return [...document.querySelectorAll('g[data-testid^="spec-ctxe-"]')].map((g) => ({
      testId: g.dataset.testid,
      from: g.dataset.from,
      to: g.dataset.to,
      x1: Number(g.dataset.x1),
      y1: Number(g.dataset.y1),
      x2: Number(g.dataset.x2),
      y2: Number(g.dataset.y2),
      rects: s2.rects,
      ctxRects: s2.ctxRects,
    }));
  });
  ok("context links rendered to tray children", ctxEdges.length >= 1, `ctxEdges=${ctxEdges.length}`);
  let bad = 0;
  for (const e of ctxEdges) {
    const fr = e.from === "__frame__" ? null : (e.rects[e.from] ?? e.ctxRects[e.from] ?? null);
    const tr = e.to === "__frame__" ? null : (e.rects[e.to] ?? e.ctxRects[e.to] ?? null);
    if (fr == null || !onBorder(fr, e.x1, e.y1, 1.5)) bad += 1;
    if (tr == null || !onBorder(tr, e.x2, e.y2, 1.5)) bad += 1;
  }
  ok("context link endpoints on borders", bad === 0, `bad=${bad}`);
  await page.screenshot({ path: "screenshots/v3-context-trays-dark.png" });
  await expectTheme(page, "v3-context-trays-dark.png", "dark");
  // Clicking a tray child navigates to its diagram with the transition.
  const childId = tray.children[0].objectId;
  const navPhasesP = collectPhases(2500);
  await childEl.click();
  const navPhases = await navPhasesP;
  await page.waitForTimeout(300);
  const s2 = await st();
  ok("tray child click navigates to its diagram", s2.diagramId !== "dg-storefront", `diagram=${s2.diagramId}`);
  ok(
    "child navigation runs the transition",
    navPhases.some((p) => p !== "idle"),
    navPhases.join(" > "),
  );
  await waitIdle();
}

// 5. breadcrumb card, light theme ------------------------------------------------
await page.goto(BASE + "?theme=light", { waitUntil: "networkidle" });
await page.locator('[data-testid^="box-"]').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: "screenshots/v3-breadcrumb-light.png" });
await expectTheme(page, "v3-breadcrumb-light.png", "light");
{
  const n = await page.locator('[data-testid="breadcrumb-card"]').count();
  ok("breadcrumb card present in light theme", n === 1);
}

// 6. at most 4 connection handles per box ---------------------------------------
{
  const n = await page.evaluate(() =>
    document.querySelectorAll('[data-testid^="conn-dot-"]').length,
  );
  const boxes = await page.evaluate(
    () => document.querySelectorAll('[data-testid^="box-"]').length,
  );
  ok("at most 4 handles per box", n <= boxes * 4, `dots=${n} boxes=${boxes}`);
  const size = await page.evaluate(() => {
    const el = document.querySelector('[data-testid^="conn-dot-"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  ok("handles are small (8px)", size != null && Math.abs(size.w - 8) <= 1.5, JSON.stringify(size));
}

// 7. reduced motion: short fade, no camera ---------------------------------------
await page.goto(BASE + "?theme=dark", { waitUntil: "networkidle" });
await page.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
await page.emulateMedia({ reducedMotion: "reduce" });
{
  const t0 = Date.now();
  const rp = collectPhases(2000);
  await page.getByTestId("drill-obj-storefront").click();
  await page.waitForTimeout(60);
  const zooming = await page.locator(".flow-canvas--zooming").count();
  ok("reduced-motion: no camera zoom", zooming === 0, `zooming=${zooming}`);
  const overlayCount = await page.locator(".drill-overlay").count();
  ok("reduced-motion: no scale overlay", overlayCount === 0, `overlays=${overlayCount}`);
  const rphases = await rp;
  ok("reduced-motion: fade phase", rphases.includes("fade"), rphases.join(" > "));
  await waitIdle();
  const dur = Date.now() - t0;
  ok("reduced-motion: fade is short (~120ms+settle)", dur < 900, `dur=${dur}ms`);
}

// 8. drill-up reverse (full motion again) ----------------------------------------
await page.emulateMedia({ reducedMotion: "no-preference" });
{
  const up = collectPhases(2500);
  await page.keyboard.press("Backspace");
  await page.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
  const upPhases = await up;
  ok(
    "drill-up runs the reverse to idle",
    upPhases[upPhases.length - 1] === "idle" &&
      upPhases.some((p) => p === "up-zoom" || p === "up-swap" || p === "up-settle"),
    upPhases.join(" > "),
  );
  await waitIdle();
  const s = await st();
  ok("drill-up returns to landscape", s.scope == null, `scope=${s.scope}`);
}

ok("no console/page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close();
if (failed.length > 0) {
  console.log("FAILED: " + failed.join(", "));
  process.exit(1);
}
console.log("v3-check: ALL PASS");
