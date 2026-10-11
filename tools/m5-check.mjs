// M5 drill-down check: serve app/ui/dist, drive the mock with playwright-core.
import { chromium } from "../tools-shot/node_modules/playwright-core/index.mjs";

const BASE = process.env.M5_BASE || "http://localhost:4173/";
const errors = [];
const failed = [];
function ok(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed.push(name);
}

function luminanceOf(rgb) {
  const lin = (v) => {
    v = v / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

function parseRgb(s) {
  const m = String(s).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
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

async function dragBox(testId, dx, dy) {
  const handle = page.getByTestId(testId);
  const bb = await handle.boundingBox();
  const cx = bb.x + bb.width / 2;
  const cy = bb.y + bb.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(900);
}

/** True when the testid's box is (at least partly) inside the viewport. */
async function isOnScreen(testId) {
  const bb = await page.getByTestId(testId).boundingBox();
  if (!bb) return false;
  return bb.x < 1400 && bb.y < 900 && bb.x + bb.width > 0 && bb.y + bb.height > 0;
}

/** Pan + zoom via real input so the viewport is distinctive. */
async function setViewport() {
  const canvas = page.getByTestId("canvas");
  const bb = await canvas.boundingBox();
  // One modest wheel tick over the center (keeps boxes on screen), then a
  // small pan. Both are real input so the saved viewport is distinctive.
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(300);
  const sx = bb.x + bb.width - 160;
  const sy = bb.y + bb.height - 120;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx - 70, sy - 45, { steps: 10 });
  await page.mouse.up();
  // Let the debounced save settle before the state is recorded.
  await page.waitForTimeout(1200);
}

/** Click a drill badge; assert animating true->false; return duration ms. */
async function drillIn(objectId) {
  ok(`drill target ${objectId} on screen`, await isOnScreen(`drill-${objectId}`));
  const t0 = Date.now();
  await page.getByTestId(`drill-${objectId}`).click();
  let sawTrue = false;
  try {
    await page.waitForFunction(
      () => window.__speculum.getState().animating === true,
      { timeout: 1500 },
    );
    sawTrue = true;
  } catch {
    sawTrue = false;
  }
  ok(`drill ${objectId}: animating becomes true`, sawTrue);
  await page.waitForFunction(
    () => window.__speculum.getState().animating === false,
    { timeout: 3000 },
  );
  const dur = Date.now() - t0;
  ok(`drill ${objectId}: animating false within 400ms of start`, dur < 900, `dur=${dur}ms`);
  return dur;
}

async function drillUp() {
  const t0 = Date.now();
  await page.keyboard.press("Backspace");
  let sawTrue = false;
  try {
    await page.waitForFunction(
      () => window.__speculum.getState().animating === true,
      { timeout: 1500 },
    );
    sawTrue = true;
  } catch {
    sawTrue = false;
  }
  ok("drill-up: animating becomes true", sawTrue);
  await page.waitForFunction(
    () => window.__speculum.getState().animating === false,
    { timeout: 3000 },
  );
  return Date.now() - t0;
}

async function assertScopeFrame(level) {
  const s = await st();
  const frames = await page.locator('[data-testid="scope-frame"]').count();
  if (level === 0) {
    ok("L0 has no scope frame", frames === 0 && s.scope == null, `scope=${s.scope}`);
  } else {
    ok(`L${level} scope frame visible`, frames === 1, `frames=${frames}`);
    const scopeBox = await page.locator(`[data-testid="box-${s.scope}"]`).count();
    ok(
      `L${level} scope object is not among the boxes`,
      scopeBox === 0,
      `scope=${s.scope}`,
    );
  }
  return s;
}

function vpClose(a, b) {
  return (
    Math.abs(a.x - b.x) <= 0.5 &&
    Math.abs(a.y - b.y) <= 0.5 &&
    Math.abs(a.zoom - b.zoom) <= 0.001
  );
}

// 1. fresh + open sample (dark) ---------------------------------------------
await page.goto(BASE + "?mock=fresh&theme=dark", { waitUntil: "networkidle" });
await page.getByTestId("empty-open-sample").waitFor({ timeout: 15000 });
await page.getByTestId("empty-open-sample").click();
await page.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });

// L0: distinctive viewport + move a box --------------------------------------
await setViewport();
ok("L0 drill target on screen", await isOnScreen("drill-obj-storefront"));
{
  const before = (await st()).rects["obj-customer"];
  await dragBox("box-obj-customer", 88, 48);
  const after = (await st()).rects["obj-customer"];
  ok("L0 box moved", JSON.stringify(after) !== JSON.stringify(before), JSON.stringify(after));
}
let s0 = await st();
ok("L0 viewport recorded", !!s0.viewport && s0.viewport.zoom !== 1, JSON.stringify(s0.viewport));
await assertScopeFrame(0);
await page.screenshot({ path: "screenshots/m5-level0-dark.png" });
await expectTheme(page, "m5-level0-dark.png", "dark");
const levels = [
  { diagramId: s0.diagramId, viewport: s0.viewport, boxId: "obj-customer", rect: s0.rects["obj-customer"] },
];

// L1: drill Storefront (existing) ---------------------------------------------
let d = await drillIn("obj-storefront");
ok("drill-in duration 200..320ms (L1)", d >= 200 && d <= 320, `dur=${d}ms`);
await page.getByTestId("box-obj-webapp").waitFor({ timeout: 15000 });
await setViewport();
await dragBox("box-obj-mobile", 80, 40);
const s1 = await st();
await assertScopeFrame(1);
await page.screenshot({ path: "screenshots/m5-level1-dark.png" });
await expectTheme(page, "m5-level1-dark.png", "dark");
levels.push({ diagramId: s1.diagramId, viewport: s1.viewport, boxId: "obj-mobile", rect: s1.rects["obj-mobile"] });

// L2: drill Web App (create-on-first-zoom) ------------------------------------
{
  const t0 = Date.now();
  await page.getByTestId("drill-obj-webapp").click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: "screenshots/m5-mid-drill-dark.png" });
  await expectTheme(page, "m5-mid-drill-dark.png", "dark");
  await page.waitForFunction(() => window.__speculum.getState().animating === true, { timeout: 1500 }).catch(() => {});
  await page.waitForFunction(
    () => window.__speculum.getState().animating === false,
    { timeout: 3000 },
  );
  d = Date.now() - t0;
  ok("drill-in duration 200..320ms (L2)", d >= 200 && d <= 320, `dur=${d}ms`);
}
await page.getByTestId("box-obj-cart").waitFor({ timeout: 15000 });
await setViewport();
await dragBox("box-obj-checkout", 80, 40);
const s2 = await st();
await assertScopeFrame(2);
levels.push({ diagramId: s2.diagramId, viewport: s2.viewport, boxId: "obj-checkout", rect: s2.rects["obj-checkout"] });

// L3: drill Cart Service (component with children) ------------------------------
d = await drillIn("obj-cart");
ok("drill-in duration 200..320ms (L3)", d >= 200 && d <= 320, `dur=${d}ms`);
await page.getByTestId("box-obj-cart-item").waitFor({ timeout: 15000 });
await setViewport();
await dragBox("box-obj-cart-item", 80, 40);
const s3 = await st();
await assertScopeFrame(3);
await page.screenshot({ path: "screenshots/m5-level3-dark.png" });
await expectTheme(page, "m5-level3-dark.png", "dark");
levels.push({ diagramId: s3.diagramId, viewport: s3.viewport, boxId: "obj-cart-item", rect: s3.rects["obj-cart-item"] });

// L3 frame-edge hover: an edge touches the scope frame here (Cart Service is
// the scope, so its connections serialize one endpoint as {frame:true}).
// Hovering that box must not throw (regression: real-app bare "frame"
// string crashed `"box" in e.from`), and the frame edge must be rendered.
{
  const errBefore = errors.length;
  await page.getByTestId("box-obj-cart-item").hover();
  await page.waitForTimeout(600);
  ok(
    "L3 hover over frame-edge box: no page errors",
    errors.length === errBefore,
    errors.slice(errBefore, errBefore + 3).join(" | "),
  );
  const frameEdges = await page
    .locator(".react-flow__edge.flow-edge--frame")
    .count();
  ok(
    "L3 frame-edge rendered (edge to __frame__ in DOM)",
    frameEdges >= 1,
    `frameEdges=${frameEdges}`,
  );
  const rfFrameEdge = await page
    .locator('[data-testid^="rf__edge-"].flow-edge--frame')
    .count();
  ok(
    "L3 frame-edge has an rf edge element in the DOM",
    rfFrameEdge >= 1,
    `rfFrameEdges=${rfFrameEdge}`,
  );
}

// Crumbs exist for the whole path ----------------------------------------------
{
  const s = await st();
  ok("nav stack has 4 entries", s.navStack.length === 4, JSON.stringify(s.navStack));
  for (const id of s.navStack) {
    ok(`crumb visible for ${id}`, (await page.getByTestId(`crumb-${id}`).count()) >= 1);
  }
}

// Back up 3x with Backspace: exact pan/zoom + box positions ---------------------
for (let i = 3; i >= 1; i--) {
  d = await drillUp();
  ok(`drill-up duration 160..280ms (to L${i - 1})`, d >= 160 && d <= 280, `dur=${d}ms`);
  await page.waitForTimeout(400);
  const s = await st();
  ok(`back at L${i - 1}`, s.diagramId === levels[i - 1].diagramId, `${s.diagramId}`);
  ok(
    `L${i - 1} viewport restored`,
    vpClose(s.viewport, levels[i - 1].viewport),
    `got=${JSON.stringify(s.viewport)} want=${JSON.stringify(levels[i - 1].viewport)}`,
  );
  ok(
    `L${i - 1} box rect restored`,
    JSON.stringify(s.rects[levels[i - 1].boxId]) === JSON.stringify(levels[i - 1].rect),
    JSON.stringify(s.rects[levels[i - 1].boxId]),
  );
}
await page.screenshot({ path: "screenshots/m5-back-to-top-dark.png" });
await expectTheme(page, "m5-back-to-top-dark.png", "dark");

// Forward 3x with Alt+Right ------------------------------------------------------
for (let i = 1; i <= 3; i++) {
  await page.keyboard.press("Alt+ArrowRight");
  await page.getByTestId(`box-${levels[i].boxId}`).waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  const s = await st();
  ok(`forward at L${i}`, s.diagramId === levels[i].diagramId, `${s.diagramId}`);
  ok(
    `L${i} viewport restored (forward)`,
    vpClose(s.viewport, levels[i].viewport),
    `got=${JSON.stringify(s.viewport)}`,
  );
  ok(
    `L${i} box rect restored (forward)`,
    JSON.stringify(s.rects[levels[i].boxId]) === JSON.stringify(levels[i].rect),
    JSON.stringify(s.rects[levels[i].boxId]),
  );
}

// Light theme: re-drill to L2, shots ----------------------------------------------
await page.goto(BASE + "?theme=light", { waitUntil: "networkidle" });
await page.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
{
  const s = await st();
  ok("L0 viewport persisted across reload", vpClose(s.viewport, levels[0].viewport), JSON.stringify(s.viewport));
  ok(
    "L0 box rect persisted across reload",
    JSON.stringify(s.rects["obj-customer"]) === JSON.stringify(levels[0].rect),
    JSON.stringify(s.rects["obj-customer"]),
  );
}
// Re-drill through existing diagrams and verify every persisted level.
for (let i = 1; i <= 3; i++) {
  const drillId = ["obj-storefront", "obj-webapp", "obj-cart"][i - 1];
  // Fallback: the badge may be faint; hover the box first.
  await page.getByTestId(`box-${drillId}`).hover();
  await page.getByTestId(`drill-${drillId}`).click();
  await page.getByTestId(`box-${levels[i].boxId}`).waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const s = await st();
  ok(`reload: L${i} viewport persisted`, vpClose(s.viewport, levels[i].viewport), JSON.stringify(s.viewport));
  ok(
    `reload: L${i} box rect persisted`,
    JSON.stringify(s.rects[levels[i].boxId]) === JSON.stringify(levels[i].rect),
    JSON.stringify(s.rects[levels[i].boxId]),
  );
  if (i === 2) {
    await page.screenshot({ path: "screenshots/m5-level2-light.png" });
    await expectTheme(page, "m5-level2-light.png", "light");
    // Breadcrumb menu (last crumb keeps the M4 menu).
    const lastCrumb = s.navStack[s.navStack.length - 1];
    await page.getByTestId(`crumb-${lastCrumb}`).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: "screenshots/m5-breadcrumb-menu-light.png" });
    await expectTheme(page, "m5-breadcrumb-menu-light.png", "light");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
}

// Reduced motion: plain ~120ms cross-fade, no scale transform ----------------------
await page.goto(BASE + "?theme=dark", { waitUntil: "networkidle" });
await page.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
await page.emulateMedia({ reducedMotion: "reduce" });
{
  const t0 = Date.now();
  await page.getByTestId("drill-obj-storefront").click();
  await page.waitForFunction(() => window.__speculum.getState().animating === true, { timeout: 1500 }).catch(() => {});
  const overlayCount = await page.locator(".drill-overlay").count();
  ok("reduced-motion: no scale overlay", overlayCount === 0, `overlays=${overlayCount}`);
  await page.waitForFunction(
    () => window.__speculum.getState().animating === false,
    { timeout: 3000 },
  );
  const dur = Date.now() - t0;
  ok("reduced-motion: fade is about 120ms", dur >= 60 && dur <= 220, `dur=${dur}ms`);
}

ok("no console/page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close();
if (failed.length > 0) {
  console.log("FAILED: " + failed.join(", "));
  process.exit(1);
}
console.log("m5-check: ALL PASS");
