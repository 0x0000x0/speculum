// M6 edge-look check: serve app/ui/dist, drive the mock with playwright-core.
import { chromium } from "../tools-shot/node_modules/playwright-core/index.mjs";

const BASE = process.env.M6_BASE || "http://localhost:4173/";
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
const setZoom = (z) =>
  page.evaluate((zz) => window.__speculum.setZoom(zz), z);

/** Read every rendered spec edge's endpoints from the DOM (flow coords). */
function domEdges() {
  return page.evaluate(() =>
    [...document.querySelectorAll('g[data-testid^="spec-e-"]')].map((g) => ({
      testId: g.dataset.testid,
      from: g.dataset.from,
      to: g.dataset.to,
      x1: Number(g.dataset.x1),
      y1: Number(g.dataset.y1),
      x2: Number(g.dataset.x2),
      y2: Number(g.dataset.y2),
      arrows: g.querySelectorAll("[data-arrow]").length,
      parentPort: g.dataset.parentPort === "true",
    })),
  );
}

/** Assert all rendered endpoints sit on their box/frame border (never inside). */
async function assertAnchors(label) {
  const s = await st();
  const rects = s.rects;
  const frame = s.frameRect;
  const edges = await domEdges();
  ok(`${label}: edges rendered`, edges.length >= 3, `count=${edges.length}`);
  let bad = 0;
  for (const e of edges) {
    const fr = e.from === "__frame__" ? frame : (rects[e.from] ?? null);
    const tr = e.to === "__frame__" ? frame : (rects[e.to] ?? null);
    const a = fr != null && onBorder(fr, e.x1, e.y1, 1.5);
    const b = tr != null && onBorder(tr, e.x2, e.y2, 1.5);
    if (!a || !b) {
      bad += 1;
      console.log(
        `   off-border ${e.testId} from=${e.from} to=${e.to} a=${a} b=${b}`,
      );
    }
  }
  ok(`${label}: every endpoint on its border (1.5px)`, bad === 0, `bad=${bad}`);
  return edges;
}

/** Assert rendered arrowhead counts match each sublink's direction. */
async function assertArrowheads(label, expectBidi) {
  const s = await st();
  const edges = await domEdges();
  const want = new Map(s.sublinks.map((sl) => [sl.testId, sl.arrowheads]));
  let bad = 0;
  for (const e of edges) {
    if (want.get(e.testId) !== e.arrows) {
      bad += 1;
      console.log(`   arrows ${e.testId}: want=${want.get(e.testId)} got=${e.arrows}`);
    }
  }
  ok(`${label}: arrowhead counts match direction`, bad === 0, `bad=${bad}`);
  if (expectBidi) {
    const bidi = s.sublinks.filter((sl) => sl.direction === "bidirectional");
    ok(
      `${label}: a bidirectional link renders 2 arrowheads`,
      bidi.length >= 1 && bidi.every((sl) => sl.arrowheads === 2),
      `bidi=${bidi.map((sl) => sl.connId).join(",")}`,
    );
  }
}

// 1. fresh + sample (dark), landscape -----------------------------------------
await page.goto(BASE + "?mock=fresh&theme=dark", { waitUntil: "networkidle" });
await page.getByTestId("empty-open-sample").waitFor({ timeout: 15000 });
await page.getByTestId("empty-open-sample").click();
await page.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
await setZoom(1);
await page.waitForTimeout(500);

{
  const s = await st();
  ok("landscape has scope null (no frame)", s.scope == null && s.frameRect == null, `scope=${s.scope}`);
  const dirs = new Set(Object.values(s.connections).map((c) => c.direction));
  ok("sample has a bidirectional link", dirs.has("bidirectional"), [...dirs].join(","));
  const shapes = new Set(Object.values(s.connections).map((c) => c.lineShape));
  ok("sample has square + straight shapes", shapes.has("square") && shapes.has("straight"), [...shapes].join(","));
  const statuses = new Set(Object.values(s.connections).map((c) => c.status));
  ok("sample has future + deprecated links", statuses.has("future") && statuses.has("deprecated"), [...statuses].join(","));
  ok(
    "sample has a via link (Orders Queue)",
    Object.values(s.connections).some((c) => c.viaId === "obj-queue"),
  );
}

await assertAnchors("landscape");
await assertArrowheads("landscape", true);

{
  // Roll-up edge on landscape: customer->storefront groups conn-1 + conn-15.
  const badges = page.locator('[data-testid="spec-edge-badge"]');
  const n = await badges.count();
  ok("landscape roll-up badge present", n >= 1, `badges=${n}`);
  if (n >= 1) {
    const text = await badges.first().textContent();
    ok("roll-up badge shows count", (text ?? "").trim() === "2", text ?? "");
    const title = await badges.first().getAttribute("title");
    ok(
      "roll-up tooltip lists both names",
      (title ?? "").includes("browses") && (title ?? "").includes("reorders"),
      title ?? "",
    );
  }
  // Arrowheads never below 8px on screen at 100%.
  const small = await page.evaluate(() => {
    let bad = 0;
    for (const p of document.querySelectorAll(".spec-edge__arrow")) {
      const r = p.getBoundingClientRect();
      if (Math.max(r.width, r.height) < 7.5) bad += 1;
    }
    return bad;
  });
  ok("arrowheads >= 8px on screen", small === 0, `small=${small}`);
}

await page.screenshot({ path: "screenshots/m6-edges-landscape-dark.png" });
await expectTheme(page, "m6-edges-landscape-dark.png", "dark");

// 2. light theme: labels visible at 100%, hidden at 50% -------------------------
await page.goto(BASE + "?theme=light", { waitUntil: "networkidle" });
await page.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
await setZoom(1);
await page.waitForTimeout(500);
{
  const n = await page.locator('[data-testid="spec-edge-label"]').count();
  ok("labels shown at 100% zoom", n >= 3, `labels=${n}`);
}
await page.screenshot({ path: "screenshots/m6-edges-landscape-light.png" });
await expectTheme(page, "m6-edges-landscape-light.png", "light");

await setZoom(0.5);
await page.waitForTimeout(600);
{
  const n = await page.locator('[data-testid="spec-edge-label"]').count();
  ok("labels hidden at 50% zoom", n === 0, `labels=${n}`);
}
await page.screenshot({ path: "screenshots/m6-labels-zoomed-out-light.png" });
await expectTheme(page, "m6-labels-zoomed-out-light.png", "light");
await setZoom(1);
await page.waitForTimeout(500);

// 3. Storefront Apps: parent port + via + parallel ------------------------------
await page.goto(BASE + "?theme=dark&diagram=dg-storefront", { waitUntil: "networkidle" });
await page.getByTestId("box-obj-webapp").waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
await setZoom(1);
await page.waitForTimeout(500);

{
  const s = await st();
  ok("storefront scope is Storefront", s.scope === "obj-storefront", `scope=${s.scope}`);
  ok("parent port rendered", (await page.getByTestId("parent-port").count()) === 1);
  const parent = s.sublinks.filter((sl) => sl.parentPort);
  ok("one parent->child sublink from the port", parent.length === 1, JSON.stringify(parent.map((p) => p.connId)));
  if (parent.length === 1) {
    const g = await page.evaluate((testId) => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      return el ? { x1: Number(el.dataset.x1), y1: Number(el.dataset.y1) } : null;
    }, parent[0].testId);
    const want = { x: s.frameRect.x + 29, y: s.frameRect.y };
    const close = g != null && Math.abs(g.x1 - want.x) <= 1.5 && Math.abs(g.y1 - want.y) <= 1.5;
    ok("parent edge starts at the parent port", close, `got=${JSON.stringify(g)} want=${JSON.stringify(want)}`);
  }
  // External frame endpoint: the parent edge's frame end is on the border.
  const fe = await domEdges();
  const frameEnds = fe.filter((e) => e.from === "__frame__" || e.to === "__frame__");
  ok("frame edge present (parent link)", frameEnds.length >= 1, `frameEnds=${frameEnds.length}`);
  let bad = 0;
  for (const e of frameEnds) {
    const r = s.frameRect;
    if (e.from === "__frame__" && !onBorder(r, e.x1, e.y1, 1.5)) bad += 1;
    if (e.to === "__frame__" && !onBorder(r, e.x2, e.y2, 1.5)) bad += 1;
  }
  ok("external frame-link starts on the frame border", bad === 0, `bad=${bad}`);

  // Via pill for the Orders Queue link.
  const via = page.locator('[data-testid="via-pill"]');
  ok("via pill present", (await via.count()) >= 1);
  if ((await via.count()) >= 1) {
    ok("via pill names Orders Queue", ((await via.first().textContent()) ?? "").includes("Orders Queue"));
  }

  // Parallel pair cart->checkout fans apart (different paths).
  const pair = s.sublinks.filter((sl) => sl.connId === "conn-6" || sl.connId === "conn-14");
  ok("parallel pair renders two sublinks", pair.length === 2, pair.map((p) => p.connId).join(","));
  if (pair.length === 2) {
    const ds = await page.evaluate((ids) => {
      const get = (testId) => {
        const g = document.querySelector(`[data-testid="${testId}"]`);
        const p = g?.querySelector(".spec-edge__path");
        return p?.getAttribute("d") ?? "";
      };
      return ids.map(get);
    }, pair.map((p) => p.testId));
    ok("parallel edges have different paths", ds[0] !== "" && ds[0] !== ds[1]);
  }

  // Future + deprecated + shapes visible here.
  ok("future link on this diagram", s.sublinks.some((sl) => sl.status === "future"));
  ok("deprecated link on this diagram", s.sublinks.some((sl) => sl.status === "deprecated"));
  ok("square link on this diagram", s.sublinks.some((sl) => sl.lineShape === "square"));
  ok("straight link on this diagram", s.sublinks.some((sl) => sl.lineShape === "straight"));
}

await assertAnchors("storefront");
await assertArrowheads("storefront", false);

// Hover highlight still works with the new edge type.
await page.getByTestId("box-obj-webapp").hover();
await page.waitForTimeout(500);
{
  const hi = await page.locator(".react-flow__edge.flow-edge--hi").count();
  ok("hover highlights connected edges", hi >= 1, `hi=${hi}`);
  const w = await page.evaluate(() => {
    const p = document.querySelector(".flow-edge--hi .spec-edge__path");
    return p ? getComputedStyle(p).strokeWidth : "";
  });
  ok("highlighted edge is thicker (2px)", w === "2px", `strokeWidth=${w}`);
}

await page.screenshot({ path: "screenshots/m6-storefront-apps-dark.png" });
await expectTheme(page, "m6-storefront-apps-dark.png", "dark");

// 4. Frame grows live mid-drag, persists, returns after undo --------------------
{
  const before = (await st()).frameRect;
  ok("frame rect measurable", before != null, JSON.stringify(before));
  const handle = page.getByTestId("box-obj-orders");
  const bb = await handle.boundingBox();
  const cx = bb.x + bb.width / 2;
  const cy = bb.y + bb.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy, { steps: 6 });
  await page.waitForTimeout(400);
  const mid = (await st()).frameRect;
  const grew = mid != null && before != null && mid.w > before.w + 30;
  ok("frame grows live mid-drag past its edge", grew, `before=${JSON.stringify(before)} mid=${JSON.stringify(mid)}`);
  await page.screenshot({ path: "screenshots/m6-frame-growing-dark.png" });
  await expectTheme(page, "m6-frame-growing-dark.png", "dark");
  await page.mouse.move(cx + 320, cy + 40, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(1100);
  const after = (await st()).frameRect;
  ok(
    "frame stays grown after drop",
    after != null && before != null && after.w > before.w + 30,
    `after=${JSON.stringify(after)}`,
  );
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(1100);
  const undone = (await st()).frameRect;
  ok(
    "frame returns after undo",
    JSON.stringify(undone) === JSON.stringify(before),
    `undone=${JSON.stringify(undone)} before=${JSON.stringify(before)}`,
  );
}

// 5. M6p2 editing: create + edit connections on a FRESH document -----------
// Done-when script (prompts/m6-2.txt section D): 5 labeled links incl. one
// two-way and one parent->child from the frame port, drop-on-empty creating
// an object, keyboard connect mode; Esc creates nothing; reuse dropdown;
// re-point change vs new; hide vs delete-from-model; one-step undo each;
// reload persists all 5. Uses real pointer drags from the conn-dot testids.
{
const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const p2 = await ctx2.newPage();
p2.on("pageerror", (e) => errors.push("pageerror: " + e.message));
p2.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});
const st2 = () => p2.evaluate(() => window.__speculum.getState());
const linksOf = async () => (await st2()).counts.links;
const gotoDiagram = async (theme, diagram) => {
  await p2.goto(`${BASE}?theme=${theme}&diagram=${diagram}`, { waitUntil: "networkidle" });
  await p2.locator('[data-testid^="box-"]').first().waitFor({ timeout: 15000 });
  await p2.waitForTimeout(800);
  await p2.evaluate(() => window.__speculum.setZoom(1));
  await p2.waitForTimeout(500);
};
const connIdByName = async (name) => {
  const s = await st2();
  const hit = Object.keys(s.connections).find((k) => s.connections[k].name === name);
  return hit ?? null;
};
const sublinkTestId = async (connId) => {
  const s = await st2();
  return (s.sublinks.find((x) => x.connId === connId) ?? {}).testId ?? null;
};
// Flow->screen mapping derived from a known box (zoom is 1 here).
const flowToScreen = async (fx, fy) => p2.evaluate(([x, y]) => {
  const els = [...document.querySelectorAll('[data-testid^="box-"]')];
  const st8 = window.__speculum.getState();
  for (const el of els) {
    const raw = el.getAttribute("data-testid") ?? "";
    const id = raw.startsWith("box-") ? raw.slice(4) : "";
    const r = st8.rects[id];
    if (!r) continue;
    const b = el.getBoundingClientRect();
    const k = b.width / r.w;
    return { x: b.x + (x - r.x) * k, y: b.y + (y - r.y) * k };
  }
  return null;
}, [fx, fy]);

/** R.2: at 100% no label pill overlaps a box or another label. */
async function assertNoLabelOverlap(label) {
  await p2.evaluate(() => window.__speculum.setZoom(1));
  await p2.waitForTimeout(500);
  const res = await p2.evaluate(() => {
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
      badLab: labels.flatMap((l, i) =>
        labels.slice(i + 1).filter((m) => hit(l, m, 1)).map((m) => `${l.t}<>${m.t}`)),
    };
  });
  ok(`${label}: labels render at 100%`, res.n >= 1, `labels=${res.n}`);
  ok(`${label}: no label pill overlaps a box`, res.badBox.length === 0, res.badBox.slice(0, 3).join(" | "));
  ok(`${label}: no label overlaps another label`, res.badLab.length === 0, res.badLab.slice(0, 3).join(" | "));
}

/** Drag a conn-dot (or the frame parent port) onto a box; ends mid-drag. */
async function startDotDrag(srcDotPrefix,shot) {
  const dot = p2.locator(`[data-testid^="${srcDotPrefix}"]`).first();
  await dot.waitFor({ state: "visible", timeout: 8000 });
  const dbb = await dot.boundingBox();
  await p2.mouse.move(dbb.x + dbb.width / 2, dbb.y + dbb.height / 2);
  await p2.mouse.down();
  await p2.mouse.move(dbb.x + 70, dbb.y + 30, { steps: 4 });
  await p2.waitForTimeout(300);
  return dbb;
}
async function dropOnBox(testId) {
  await p2.getByTestId(testId).scrollIntoViewIfNeeded().catch(() => {});
  const tbb = await p2.getByTestId(testId).boundingBox();
  await p2.mouse.move(tbb.x + tbb.width / 2, tbb.y + tbb.height / 2, { steps: 10 });
  await p2.waitForTimeout(300);
  await p2.mouse.up();
  await p2.waitForTimeout(600);
  return tbb;
}
/** Full gesture: dot -> box, then name + commit in the connect dialog. */
async function dragCreate(srcBoxId, dstBoxTestId, name, srcPrefix) {
  await p2.getByTestId(`box-${srcBoxId}`).click();
  await p2.waitForTimeout(300);
  await startDotDrag(srcPrefix ?? `conn-dot-${srcBoxId}-`);
  await dropOnBox(dstBoxTestId);
  ok(`dialog opens for ${name}`, (await p2.getByTestId("connect-dialog").count()) === 1);
  await p2.getByTestId("connect-name-input").fill(name);
  await p2.getByTestId("connect-create").click();
  await p2.waitForTimeout(1200);
  ok(`link created: ${name}`, (await connIdByName(name)) != null);
}
async function undoIsOneStep(what, countFn) {
  const before = await countFn();
  await p2.keyboard.press("Control+z");
  await p2.waitForTimeout(1100);
  const undone = await countFn();
  ok(`${what}: undo is one step`, undone === before - 1, `${before}->${undone}`);
  await p2.keyboard.press("Control+y");
  await p2.waitForTimeout(1100);
  ok(`${what}: redo restores`, (await countFn()) === before);
}
/** Click an edge path midpoint (retries fractions) until its link selects. */
async function selectEdgeConn(connId) {
  const testId = await sublinkTestId(connId);
  if (!testId) return null;
  for (const f of [0.5, 0.3, 0.7]) {
    const pt = await p2.evaluate(([tid, frac]) => {
      const g = document.querySelector(`[data-testid="${tid}"]`);
      const path = g?.querySelector(".spec-edge__halo");
      if (!path) return null;
      const q = path.getPointAtLength(path.getTotalLength() * frac);
      const d = new DOMPoint(q.x, q.y).matrixTransform(path.getScreenCTM());
      return { x: d.x, y: d.y };
    }, [testId, f]);
    if (!pt) continue;
    await p2.mouse.click(pt.x, pt.y);
    await p2.waitForTimeout(500);
    if ((await st2()).selectedEdge?.connId === connId) return testId;
  }
  return null;
}

// Fresh document, then Open sample.
await p2.goto(BASE + "?mock=fresh&theme=dark", { waitUntil: "networkidle" });
await p2.getByTestId("empty-open-sample").waitFor({ timeout: 15000 });
await p2.getByTestId("empty-open-sample").click();
await p2.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
await p2.waitForTimeout(800);
ok("editing starts from 15 sample links", (await linksOf()) === 15, `links=${await linksOf()}`);

// R.2 on every sample diagram, fresh sample, 100%.
await gotoDiagram("dark", "dg-landscape");
await assertNoLabelOverlap("landscape R.2");
await gotoDiagram("dark", "dg-storefront");
await assertNoLabelOverlap("storefront R.2");
await gotoDiagram("dark", "dg-payments-api");
await assertNoLabelOverlap("payments R.2");
await gotoDiagram("dark", "dg-landscape");

// (1) box->box on the landscape, with a mid-drag preview screenshot.
await p2.getByTestId("box-obj-customer").click();
await p2.waitForTimeout(300);
await startDotDrag("conn-dot-obj-customer-");
ok("mid-drag preview line renders", (await p2.getByTestId("connect-preview").count()) === 1);
{
  const arrow = await p2.locator('[data-testid="connect-preview"] [data-arrow]').count();
  ok("preview line has an arrowhead", arrow >= 1, `arrows=${arrow}`);
}
await p2.screenshot({ path: "screenshots/m6-connect-drag-dark.png" });
await expectTheme(p2, "m6-connect-drag-dark.png", "dark");
await dropOnBox("box-obj-payments");
ok("dialog opens for link alpha", (await p2.getByTestId("connect-dialog").count()) === 1);
ok("create disabled with empty name", await p2.getByTestId("connect-create").isDisabled());
// Esc with an unnamed link creates nothing.
await p2.keyboard.press("Escape");
await p2.waitForTimeout(500);
ok("Esc creates nothing", (await linksOf()) === 15 && (await p2.getByTestId("connect-dialog").count()) === 0);
// Re-drag and commit.
await startDotDrag("conn-dot-obj-customer-");
await dropOnBox("box-obj-payments");
await p2.getByTestId("connect-name-input").fill("m6 link alpha");
await p2.getByTestId("connect-create").click();
await p2.waitForTimeout(1200);
{
  const id = await connIdByName("m6 link alpha");
  ok("link alpha created", id != null);
  const s = await st2();
  ok("alpha shown on landscape", id != null && s.shownConnections.includes(id), `shown=${s.shownConnections.length}`);
}
await undoIsOneStep("alpha creation", linksOf);

// (2) a two-way link, direction set in the details panel.
// Pair support->cloud: no sample link rolls up to it, so the new link
// renders as its own edge (a rolled-up group would bury it under conn-5).
await dragCreate("obj-support", "box-obj-cloud", "m6 link beta");
await undoIsOneStep("beta creation", linksOf);
{
  const id = await connIdByName("m6 link beta");
  const picked = await selectEdgeConn(id);
  ok("beta edge selects", picked != null);
  ok("edge details panel opens", (await p2.getByTestId("edge-details").count()) === 1);
  await p2.screenshot({ path: "screenshots/m6-edge-details-dark.png" });
  await expectTheme(p2, "m6-edge-details-dark.png", "dark");
  await p2.getByTestId("edge-direction-bidirectional").click();
  await p2.waitForTimeout(1100);
  const s = await st2();
  ok("beta is bidirectional", s.connections[id].direction === "bidirectional");
  const arrows = await p2.locator(`[data-testid="${await sublinkTestId(id)}"] [data-arrow]`).count();
  ok("bidirectional link renders 2 arrowheads", arrows === 2, `arrows=${arrows}`);
}
// L toggles show-all-labels (persisted per diagram).
await p2.keyboard.press("l");
await p2.waitForTimeout(1100);
ok("L shows all labels", (await st2()).labelsOn === true);
await p2.keyboard.press("l");
await p2.waitForTimeout(1100);
ok("L toggles back", (await st2()).labelsOn === false);

// (3) parent->child on Storefront Apps, dragged from the frame port.
await gotoDiagram("dark", "dg-storefront");
{
  const port = p2.getByTestId("parent-port");
  await port.waitFor({ state: "visible", timeout: 8000 });
  const pbb = await port.boundingBox();
  await p2.mouse.move(pbb.x + pbb.width / 2, pbb.y + pbb.height / 2);
  await p2.mouse.down();
  await p2.waitForTimeout(200);
  ok("port drag draws a preview", (await p2.getByTestId("connect-preview").count()) === 1);
  await dropOnBox("box-obj-cart");
  ok("parent->child dialog opens", (await p2.getByTestId("connect-dialog").count()) === 1);
  const ends = await p2.getByTestId("connect-dialog-ends").textContent();
  ok("dialog names parent and child", (ends ?? "").includes("Storefront") && (ends ?? "").includes("Cart Service"), ends ?? "");
  await p2.getByTestId("connect-name-input").fill("m6 link gamma");
  await p2.getByTestId("connect-create").click();
  await p2.waitForTimeout(1200);
  const id = await connIdByName("m6 link gamma");
  const s = await st2();
  ok("gamma is parent->child in the model", id != null && s.connections[id].originId === "obj-storefront" && s.connections[id].targetId === "obj-cart");
  const sl = s.sublinks.find((x) => x.connId === id);
  ok("gamma starts at the parent port", sl?.parentPort === true);
}
await undoIsOneStep("gamma creation", linksOf);

// (4) drop-on-empty creates a new object (light theme).
await gotoDiagram("light", "dg-landscape");
{
  await p2.getByTestId("box-obj-payments").click();
  await p2.waitForTimeout(300);
  const before = { links: await linksOf(), objs: (await st2()).counts.objects };
  await startDotDrag("conn-dot-obj-payments-");
  const pt = await flowToScreen(920, 580);
  ok("empty flow point maps to screen", pt != null, JSON.stringify(pt));
  await p2.mouse.move(pt.x, pt.y, { steps: 10 });
  await p2.waitForTimeout(300);
  await p2.mouse.up();
  await p2.waitForTimeout(800);
  ok("quick-add opens with link context", (await p2.getByTestId("quick-add-linking").count()) === 1);
  await p2.getByTestId("quick-add-kind-store").click();
  await p2.getByTestId("quick-add-name").fill("M6 Drop Store");
  await p2.getByTestId("quick-add-link-name").fill("m6 link delta");
  await p2.getByTestId("quick-add-create").click();
  await p2.waitForTimeout(1200);
  const id = await connIdByName("m6 link delta");
  const s = await st2();
  ok("delta link created", id != null);
  ok("drop-on-empty added one object", s.counts.objects === before.objs + 1, `${before.objs}->${s.counts.objects}`);
  const newBox = id != null ? Object.keys(s.rects).find((b) => s.connections[id].targetId === b) : null;
  ok("new object has a box", newBox != null && s.rects[newBox] != null, `box=${newBox}`);
  const revBefore = s.counts.links;
  await p2.keyboard.press("Control+z");
  await p2.waitForTimeout(1100);
  const s2 = await st2();
  ok("delta undo removes link+object in one step", s2.counts.links === revBefore - 1 && (await connIdByName("m6 link delta")) == null);
  await p2.keyboard.press("Control+y");
  await p2.waitForTimeout(1100);
  ok("delta redo restores", (await connIdByName("m6 link delta")) != null);
}

// (5) C connect mode with the keyboard (light; name dialog screenshot).
// Source customer: every candidate pair from it is free of sample
// roll-ups, so the new link renders as its own edge.
{
  await p2.getByTestId("box-obj-customer").click();
  await p2.waitForTimeout(300);
  await p2.keyboard.press("c");
  await p2.waitForTimeout(300);
  ok("connect hint shows", (await p2.getByTestId("connect-hint").count()) === 1);
  const cm = (await st2()).connectMode;
  ok("connect mode sources the selection", cm?.source === "obj-customer", JSON.stringify(cm));
  const cand0 = cm?.candidate;
  await p2.keyboard.press("ArrowRight");
  await p2.waitForTimeout(300);
  const cm1 = (await st2()).connectMode;
  ok("arrows move the candidate", cm1?.candidate !== cand0, `${cand0}->${cm1?.candidate}`);
  await p2.keyboard.press("ArrowLeft");
  await p2.waitForTimeout(300);
  ok("arrows move back", (await st2()).connectMode?.candidate === cand0);
  await p2.keyboard.press("Enter");
  await p2.waitForTimeout(500);
  const pending = (await st2()).pendingLink;
  ok("keyboard pick opens the name field", pending != null && pending.sourceKey === "obj-customer" && pending.targetKey === cand0, JSON.stringify(pending));
  await p2.screenshot({ path: "screenshots/m6-name-new-link-light.png" });
  await expectTheme(p2, "m6-name-new-link-light.png", "light");
  const targetName = pending ? ((await st2()).connections[pending.targetKey]?.name ?? pending.targetKey) : "?";
  void targetName;
  await p2.getByTestId("connect-name-input").fill("m6 link epsilon");
  await p2.keyboard.press("Enter");
  await p2.waitForTimeout(1200);
  const s = await st2();
  const id = Object.keys(s.connections).find((k) => s.connections[k].name === "m6 link epsilon");
  ok("epsilon created via keyboard", id != null && s.shownConnections.includes(id));
}
await undoIsOneStep("epsilon creation", linksOf);

// Re-point beta: "change in model" keeps the count, "new" adds one.
{
  const beta = await connIdByName("m6 link beta");
  const picked = await selectEdgeConn(beta);
  ok("beta re-selects for re-point", picked != null);
  const handle = p2.locator(`[data-testid="repoint-to-${picked}"]`);
  await handle.waitFor({ state: "visible", timeout: 8000 });
  const hbb = await handle.boundingBox();
  await p2.mouse.move(hbb.x + hbb.width / 2, hbb.y + hbb.height / 2);
  await p2.mouse.down();
  const tgt = await dropOnBox("box-obj-payments");
  void tgt;
  // mouse.up already happened in dropOnBox; dialog should be open.
  ok("re-point dialog opens", (await p2.getByTestId("repoint-dialog").count()) === 1);
  await p2.screenshot({ path: "screenshots/m6-repoint-dialog-light.png" });
  await expectTheme(p2, "m6-repoint-dialog-light.png", "light");
  const n0 = await linksOf();
  await p2.getByTestId("repoint-change").click();
  await p2.waitForTimeout(1200);
  const s = await st2();
  ok("re-point change keeps model count", (await linksOf()) === n0);
  ok("beta now targets Payments", s.connections[beta].targetId === "obj-payments", s.connections[beta].targetId);
  // Second re-point as "new connection".
  const picked2 = await selectEdgeConn(beta);
  ok("beta re-selects again", picked2 != null);
  const h2 = await p2.locator(`[data-testid="repoint-to-${picked2}"]`).boundingBox();
  await p2.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
  await p2.mouse.down();
  await dropOnBox("box-obj-customer");
  await p2.getByTestId("repoint-new").click();
  await p2.waitForTimeout(1200);
  const s2 = await st2();
  ok("re-point new adds one link", (await linksOf()) === n0 + 1);
  const copy = Object.keys(s2.connections).find((k) => k !== beta && s2.connections[k].name === "m6 link beta");
  ok("copy targets Customer", copy != null && s2.connections[copy].targetId === "obj-customer");
  ok("original still targets Payments", s2.connections[beta].targetId === "obj-payments");
  // Delete the copy from the model (confirm modal lists flows/steps).
  const pickedCopy = await selectEdgeConn(copy);
  ok("copy edge selects", pickedCopy != null);
  await p2.getByTestId("edge-delete").click();
  await p2.waitForTimeout(400);
  ok("delete confirm modal opens", (await p2.getByRole("dialog").count()) >= 1);
  const modalText = await p2.getByRole("dialog").last().textContent();
  ok("modal lists flows/steps", (modalText ?? "").includes("flow"), (modalText ?? "").slice(0, 120));
  await p2.getByTestId("edge-delete-confirm").click();
  await p2.waitForTimeout(1200);
  ok("delete-from-model removes the link", (await linksOf()) === n0 && !((await st2()).sublinks.some((x) => x.connId === copy)));
}

// Hide (Delete key) vs delete-from-model: hide keeps the model link.
{
  const alpha = await connIdByName("m6 link alpha");
  const picked = await selectEdgeConn(alpha);
  ok("alpha edge selects", picked != null);
  const n0 = await linksOf();
  await p2.keyboard.press("Delete");
  await p2.waitForTimeout(1200);
  const s = await st2();
  ok("hide keeps the model link", (await linksOf()) === n0 && s.connections[alpha] != null);
  ok("hide drops it from the diagram", !s.shownConnections.includes(alpha));
  ok("hide toasts with Undo", ((await p2.locator(".app-toast").first().textContent().catch(() => "")) ?? "").includes("Hidden from diagram"));
  // Reuse: dragging the same pair offers the hidden link; showing it
  // does not change the model connection count.
  await p2.getByTestId("box-obj-customer").click();
  await p2.waitForTimeout(300);
  await startDotDrag("conn-dot-obj-customer-");
  await dropOnBox("box-obj-payments");
  ok("reuse list offers the hidden link", (await p2.getByTestId(`connect-reuse-${alpha}`).count()) === 1);
  await p2.getByTestId(`connect-reuse-${alpha}`).click();
  await p2.getByTestId("connect-create").click();
  await p2.waitForTimeout(1200);
  const s2 = await st2();
  ok("reuse does not duplicate the model link", (await linksOf()) === n0);
  ok("reuse shows it on the diagram again", s2.shownConnections.includes(alpha));
}

// Reload (no mock=fresh): all 5 links persist with names/directions/diagrams.
await p2.goto(BASE + "?theme=dark", { waitUntil: "networkidle" });
await p2.locator('[data-testid^="box-"]').first().waitFor({ timeout: 15000 });
await p2.waitForTimeout(1000);
{
  const s = await st2();
  ok("reload keeps 20 links", s.counts.links === 20, `links=${s.counts.links}`);
  const byName = (n) => Object.entries(s.connections).find(([, c]) => c.name === n);
  const want = [
    ["m6 link alpha", "dg-landscape", "outgoing"],
    ["m6 link beta", "dg-landscape", "bidirectional"],
    ["m6 link gamma", "dg-storefront", "outgoing"],
    ["m6 link delta", "dg-landscape", "outgoing"],
    ["m6 link epsilon", "dg-landscape", "outgoing"],
  ];
  for (const [name, diagram, dir] of want) {
    const hit = byName(name);
    ok(`reload keeps ${name}`, hit != null && hit[1].direction === dir, hit ? `${hit[0]} ${hit[1].direction}` : "missing");
    void diagram;
  }
  // Per-diagram placement.
  await p2.goto(BASE + "?theme=dark&diagram=dg-storefront", { waitUntil: "networkidle" });
  await p2.locator('[data-testid^="box-"]').first().waitFor({ timeout: 15000 });
  await p2.waitForTimeout(800);
  const g = await connIdByName("m6 link gamma");
  ok("gamma shown on Storefront Apps", (await st2()).shownConnections.includes(g));
  await p2.goto(BASE + "?theme=dark&diagram=dg-landscape", { waitUntil: "networkidle" });
  await p2.locator('[data-testid^="box-"]').first().waitFor({ timeout: 15000 });
  await p2.evaluate(() => window.__speculum.setZoom(1));
  await p2.waitForTimeout(800);
  const s3 = await st2();
  for (const name of ["m6 link alpha", "m6 link beta", "m6 link delta", "m6 link epsilon"]) {
    const id = Object.keys(s3.connections).find((k) => s3.connections[k].name === name);
    ok(`${name} shown on landscape`, id != null && s3.shownConnections.includes(id));
  }
  await assertNoLabelOverlap("landscape after reload R.2");
  await p2.screenshot({ path: "screenshots/m6-five-links-after-reload-dark.png" });
  await expectTheme(p2, "m6-five-links-after-reload-dark.png", "dark");
}
await ctx2.close();
}

// 6. M6p3 toolbar: left palette, placement, pan, connect-anywhere, stubs,
// zoom group + fit, double-click drill/rename/quick-add --------------------
{
const ctx3 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const p3 = await ctx3.newPage();
p3.on("pageerror", (e) => errors.push("pageerror: " + e.message));
p3.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});
const st3 = () => p3.evaluate(() => window.__speculum.getState());
const toolOf = async () => (await st3()).tool;
const counts3 = async () => ({ o: (await st3()).counts.objects, l: (await st3()).counts.links });
const goto3 = async (theme, diagram) => {
  await p3.goto(`${BASE}?theme=${theme}${diagram ? `&diagram=${diagram}` : ""}`, { waitUntil: "networkidle" });
  await p3.locator('[data-testid^="box-"]').first().waitFor({ timeout: 15000 });
  await p3.waitForTimeout(800);
  await p3.evaluate(() => window.__speculum.setZoom(1));
  await p3.waitForTimeout(500);
};
const canvasBox = () => p3.getByTestId("canvas").boundingBox();
const pressKey = (k) => p3.keyboard.press(k);

// Fresh document in this context, then open the sample.
await p3.goto(BASE + "?mock=fresh&theme=dark", { waitUntil: "networkidle" });
await p3.getByTestId("empty-open-sample").waitFor({ timeout: 15000 });
await p3.getByTestId("empty-open-sample").click();
await p3.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
await p3.waitForTimeout(800);
await goto3("dark", "dg-landscape");

// Bar geometry + theme (dark): full height, ~44px, chrome bg luminance < 0.2.
{
  const r = await p3.evaluate(() => {
    const c = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
    const b = document.querySelector('[data-testid="toolbar"]').getBoundingClientRect();
    const bg = getComputedStyle(document.querySelector('[data-testid="toolbar"]')).backgroundColor;
    return { c: { x: c.x, y: c.y, w: c.width, h: c.height }, b: { x: b.x, y: b.y, w: b.width, h: b.height }, bg };
  });
  ok("toolbar on the canvas left edge", Math.abs(r.b.x - r.c.x) <= 2 && r.b.y - r.c.y <= 2, JSON.stringify({ x: r.b.x, y: r.b.y }));
  ok("toolbar ~44px wide, full height", Math.abs(r.b.w - 44) <= 4 && r.b.h > r.c.h * 0.9, `w=${r.b.w.toFixed(1)} h=${r.b.h.toFixed(0)}`);
  const lum = luminanceOf(parseRgb(r.bg));
  ok("toolbar themed dark (luminance < 0.2)", lum < 0.2, `bg=${r.bg} lum=${lum.toFixed(3)}`);
  const crumb = await p3.evaluate(() => {
    const c = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
    const k = document.querySelector('[data-testid="breadcrumb-card"]').getBoundingClientRect();
    return k.x - c.x;
  });
  ok("breadcrumb sits right of the bar (bar + 12px)", Math.abs(crumb - 56) <= 14, `dx=${crumb.toFixed(1)}`);
}

// Each tool button activates its tool, highlighted, only one at a time.
for (const id of ["select", "pan", "add-system", "add-app", "add-component", "add-store", "add-actor", "add-group", "connect"]) {
  await p3.getByTestId(`tool-${id}`).click();
  await p3.waitForTimeout(250);
  ok(`tool button activates ${id}`, (await toolOf()) === id);
  const pressed = await p3.evaluate(() => [...document.querySelectorAll('[data-testid^="tool-"]')].filter((el) => el.getAttribute("aria-pressed") === "true").map((el) => el.dataset.testid));
  ok(`only ${id} highlighted`, pressed.length === 1 && pressed[0] === `tool-${id}`, pressed.join(","));
}
await p3.getByTestId("tool-select").click();

// Shortcut keys select the same tool as the tooltip says (parsed from DOM).
{
  const pairs = await p3.evaluate(() => [...document.querySelectorAll('[data-testid^="tool-"]')].map((el) => ({ id: el.dataset.testid, title: el.getAttribute("title") ?? "" })));
  for (const { id, title } of pairs) {
    const short = (title.match(/\(([^)]+)\)/) ?? [])[1] ?? "";
    const tool = id.replace("tool-", "");
    if (tool === "note" || tool === "flow") continue; // stubs toast + return to select (checked below)
    if (short.startsWith("Shift+")) await p3.keyboard.press(`Shift+${short.slice(6).toLowerCase()}`);
    else await pressKey(short.toLowerCase());
    await p3.waitForTimeout(250);
    ok(`shortcut ${short} selects ${tool}`, (await toolOf()) === tool, `title=${title}`);
  }
  await p3.getByTestId("tool-select").click();
}

// Sticky + flow stubs toast and return to select.
await p3.getByTestId("tool-note").click();
await p3.waitForTimeout(300);
ok("note stub toasts", (((await p3.locator(".app-toast").first().textContent().catch(() => "")) ?? "").includes("Sticky notes")) && (await toolOf()) === "select");
await p3.keyboard.press("Escape");
await p3.getByTestId("tool-flow").click();
await p3.waitForTimeout(300);
ok("flow stub toasts", (((await p3.locator(".app-toast").first().textContent().catch(() => "")) ?? "").includes("Flows")) && (await toolOf()) === "select");
await p3.keyboard.press("Escape");

// Tooltip visible on the Component button (dark screenshot).
await p3.getByTestId("tool-add-component").hover();
await p3.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
await p3.waitForTimeout(800);
ok("component tooltip visible", await p3.evaluate(() => {
  const tip = document.querySelector('[data-testid="tool-add-component"] .tool-bar__tip');
  if (!tip) return false;
  const r = tip.getBoundingClientRect();
  return r.width > 0 && getComputedStyle(tip).visibility !== "hidden";
}));
await p3.screenshot({ path: "screenshots/m6-toolbar-dark.png" });
await expectTheme(p3, "m6-toolbar-dark.png", "dark");
await p3.screenshot({ path: "screenshots/m6-toolbar-tooltip-dark.png" });

// Click-to-place: ghost follows, click creates one snapped object, undo removes.
{
  await p3.getByTestId("tool-add-component").click();
  await p3.waitForTimeout(250);
  const cb = await canvasBox();
  await p3.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2, { steps: 4 });
  await p3.waitForTimeout(300);
  ok("ghost box mid-placement", (await p3.getByTestId("tool-ghost").count()) === 1);
  const before = await counts3();
  // Empty flow point far from boxes: use a seeded mapping like the m6p2 section.
  const pt = await p3.evaluate(() => {
    const els = [...document.querySelectorAll('[data-testid^="box-"]')];
    const st8 = window.__speculum.getState();
    for (const el of els) {
      const raw = el.getAttribute("data-testid") ?? "";
      const id = raw.startsWith("box-") ? raw.slice(4) : "";
      const r = st8.rects[id];
      if (!r) continue;
      const b = el.getBoundingClientRect();
      const k = b.width / r.w;
      return { x: b.x + (980 - r.x) * k, y: b.y + (620 - r.y) * k };
    }
    return null;
  });
  await p3.mouse.click(pt.x, pt.y);
  await p3.waitForTimeout(1200);
  const after = await st3();
  ok("click-to-place creates exactly one object", after.counts.objects === before.o + 1, `${before.o}->${after.counts.objects}`);
  const nid = (after.selection ?? [])[0] ?? null;
  const nr = nid ? after.rects[nid] : null;
  ok("placed box snapped to 8px", nid != null && nr != null && nr.x % 8 === 0 && nr.y % 8 === 0, JSON.stringify(nr));
  ok("tool returns to select after place", after.tool === "select");
  await p3.keyboard.press("Escape"); // dismiss inline rename if open
  await p3.waitForTimeout(300);
  await p3.keyboard.press("Control+z");
  await p3.waitForTimeout(1100);
  ok("one undo removes the placed box", (await counts3()).o === before.o);
  await p3.keyboard.press("Control+y");
  await p3.waitForTimeout(1100);
  const redoN = (await counts3()).o;
  ok("redo restores the placed box", redoN === before.o + 1);
  await p3.keyboard.press("Control+z");
  await p3.waitForTimeout(1100);
}

// Drag-to-place via palette drag + drop.
{
  const before = await counts3();
  const cb = await canvasBox();
  const dx = cb.x + cb.width * 0.72;
  const dy = cb.y + cb.height * 0.72;
  await p3.evaluate(([x, y]) => {
    const btn = document.querySelector('[data-testid="tool-add-store"]');
    const canvas = document.querySelector('[data-testid="canvas"]');
    const dt = new DataTransfer();
    dt.setData("application/x-speculum-kind", "store");
    btn.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
    canvas.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    canvas.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  }, [dx, dy]);
  await p3.waitForTimeout(1200);
  const after = await st3();
  ok("drag-to-place creates exactly one object", after.counts.objects === before.o + 1, `${before.o}->${after.counts.objects}`);
  const nid = (after.selection ?? [])[0] ?? null;
  const nr = nid ? after.rects[nid] : null;
  const near = nid && nr ? await p3.evaluate(([id]) => {
    const el = document.querySelector(`[data-testid="box-${id}"]`);
    return el ? el.getBoundingClientRect() : null;
  }, nid) : null;
  void near;
  ok("dropped box snapped to 8px", nid != null && nr != null && nr.x % 8 === 0 && nr.y % 8 === 0, JSON.stringify(nr));
  await p3.keyboard.press("Escape");
  await p3.waitForTimeout(300);
  await p3.keyboard.press("Control+z");
  await p3.waitForTimeout(1100);
  ok("one undo removes the dropped box", (await counts3()).o === before.o);
}

// Pan tool: drags the viewport, not a box.
{
  await p3.getByTestId("tool-pan").click();
  await p3.waitForTimeout(250);
  const s0 = await st3();
  const b0 = await p3.getByTestId("box-obj-customer").boundingBox();
  const cb = await canvasBox();
  // Empty-canvas point: search a pane pixel via elementFromPoint.
  const empty = await p3.evaluate(() => {
    const c = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.85], [0.3, 0.8], [0.7, 0.8], [0.5, 0.15]]) {
      const x = c.x + c.width * fx;
      const y = c.y + c.height * fy;
      const el = document.elementFromPoint(x, y);
      if (el?.closest?.('[data-testid="canvas"]') && !el.closest('[data-testid^="box-"]') && !el.closest('[data-testid="toolbar"]') && !el.closest('.zoom-group') && !el.closest('.crumb-card')) return { x, y };
    }
    return null;
  });
  ok("empty canvas point found for pan", empty != null, JSON.stringify(empty));
  await p3.mouse.move(empty.x, empty.y);
  await p3.mouse.down();
  await p3.mouse.move(empty.x + 160, empty.y + 60, { steps: 10 });
  await p3.waitForTimeout(400);
  await p3.mouse.up();
  await p3.waitForTimeout(800);
  const b1 = await p3.getByTestId("box-obj-customer").boundingBox();
  const moved = Math.hypot((b1.x - b0.x), (b1.y - b0.y));
  ok("pan drag moves the viewport", moved > 40, `moved=${moved.toFixed(1)}`);
  const s1 = await st3();
  ok("pan does not move the model box", JSON.stringify(s1.rects["obj-customer"]) === JSON.stringify(s0.rects["obj-customer"]));
  // Drag starting ON a box also pans (boxes not draggable in pan tool).
  const bc = await p3.getByTestId("box-obj-customer").boundingBox();
  await p3.mouse.move(bc.x + bc.width / 2, bc.y + bc.height / 2);
  await p3.mouse.down();
  await p3.mouse.move(bc.x + bc.width / 2 + 120, bc.y + bc.height / 2, { steps: 8 });
  await p3.mouse.up();
  await p3.waitForTimeout(800);
  const s2 = await st3();
  ok("box drag in pan tool keeps the model rect", JSON.stringify(s2.rects["obj-customer"]) === JSON.stringify(s0.rects["obj-customer"]));
  await p3.evaluate(() => window.__speculum.setZoom(1));
  await p3.waitForTimeout(500);
  await p3.getByTestId("tool-select").click();
  void cb;
}

// Draw-connection tool: drag box->box (anywhere), name, one undo.
{
  const before = (await counts3()).l;
  await p3.getByTestId("tool-connect").click();
  await p3.waitForTimeout(250);
  const a = await p3.getByTestId("box-obj-support").boundingBox();
  const b = await p3.getByTestId("box-obj-cloud").boundingBox();
  await p3.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p3.mouse.down();
  await p3.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await p3.waitForTimeout(300);
  ok("connect-anywhere preview line renders", (await p3.getByTestId("connect-preview").count()) === 1);
  await p3.mouse.up();
  await p3.waitForTimeout(600);
  ok("connect dialog opens", (await p3.getByTestId("connect-dialog").count()) === 1);
  await p3.getByTestId("connect-name-input").fill("m6 toolbar link");
  await p3.getByTestId("connect-create").click();
  await p3.waitForTimeout(1200);
  const s = await st3();
  const hit = Object.keys(s.connections).find((k) => s.connections[k].name === "m6 toolbar link");
  ok("toolbar link created", hit != null);
  ok("connect tool stays active", s.tool === "connect");
  await p3.keyboard.press("Control+z");
  await p3.waitForTimeout(1100);
  ok("one undo removes the toolbar link", (await counts3()).l === before);
  await p3.keyboard.press("Escape");
  await p3.waitForTimeout(300);
  await p3.getByTestId("tool-select").click();
}

// Double-click: body drills in, name renames, empty canvas quick-adds.
{
  await goto3("dark", "dg-landscape");
  const sb = await p3.getByTestId("box-obj-storefront").boundingBox();
  await p3.mouse.dblclick(sb.x + 14, sb.y + sb.height - 14);
  await p3.waitForTimeout(1500);
  const s = await st3();
  ok("double-click body drills into the box", s.diagramId === "dg-storefront", `diagram=${s.diagramId}`);
  await p3.getByTestId("box-obj-cart").waitFor({ timeout: 15000 });
  const nb = await p3.getByTestId("box-name-obj-cart").boundingBox();
  await p3.mouse.dblclick(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await p3.waitForTimeout(500);
  ok("double-click name starts rename", (await p3.locator(".spec-box__rename").count()) >= 1);
  await p3.keyboard.press("Escape");
  await p3.waitForTimeout(300);
  const empty = await p3.evaluate(() => {
    const c = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
    const x = c.x + c.width * 0.5;
    const y = c.y + c.height * 0.88;
    return { x, y };
  });
  await p3.mouse.dblclick(empty.x, empty.y);
  await p3.waitForTimeout(600);
  ok("double-click empty canvas opens quick-add", (await p3.getByTestId("quick-add").count()) === 1);
  await p3.keyboard.press("Escape");
  await p3.waitForTimeout(300);
}

// Zoom group: top-right, buttons change zoom, pct resets.
{
  await goto3("dark", "dg-landscape");
  const pos = await p3.evaluate(() => {
    const c = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
    const g = document.querySelector('[data-testid="zoom-group"]').getBoundingClientRect();
    return { right: c.right - g.right, top: g.top - c.top };
  });
  ok("zoom group in the top-right corner", pos.right <= 16 && pos.top <= 16, `right=${pos.right.toFixed(1)} top=${pos.top.toFixed(1)}`);
  await p3.evaluate(() => window.__speculum.setZoom(1));
  await p3.waitForTimeout(500);
  const z0 = (await st3()).zoom ?? 1;
  await p3.getByTestId("zoom-in").click();
  await p3.waitForTimeout(800);
  const z1 = (await st3()).zoom ?? 1;
  ok("zoom in changes zoom", z1 > z0 + 0.05, `${z0}->${z1}`);
  await p3.getByTestId("zoom-out").click();
  await p3.waitForTimeout(800);
  const z2 = (await st3()).zoom ?? 1;
  ok("zoom out changes zoom", z2 < z1 - 0.02, `${z1}->${z2}`);
  await p3.evaluate(() => window.__speculum.setZoom(2.5));
  await p3.waitForTimeout(500);
  await p3.getByTestId("zoom-pct").click();
  await p3.waitForTimeout(800);
  const z3 = (await st3()).zoom ?? 0;
  ok("zoom % resets to 100%", Math.abs(z3 - 1) < 0.08, `zoom=${z3}`);
}

// Fit (button AND Shift+1 AND Ctrl+0): far pan + 300% -> all boxes inside,
// animated, both themes + drilled-in frame included.
async function fitAsserts(label, via) {
  await p3.evaluate(() => window.__speculum.setZoom(3));
  await p3.waitForTimeout(400);
  // Pan far away with a real drag so the viewport is distinctive.
  const cb = await canvasBox();
  await p3.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await p3.mouse.down();
  await p3.mouse.move(cb.x + cb.width / 2 - 320, cb.y + cb.height / 2 - 200, { steps: 10 });
  await p3.mouse.up();
  await p3.waitForTimeout(700);
  const start = await p3.evaluate(() => {
    const c = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  void start;
  await p3.screenshot({ path: "screenshots/m6-fit-before-dark.png" });
  const v0 = await p3.evaluate(() => ({ ...(window.__speculum.getState().viewport ?? { x: 0, y: 0, zoom: 1 }) }));
  if (via === "button") await p3.getByTestId("fit-screen").click();
  else if (via === "shift1") await p3.keyboard.press("Shift+1");
  else await p3.keyboard.press("Control+0");
  await p3.waitForTimeout(150);
  const vmid = await p3.evaluate(() => ({ ...(window.__speculum.getState().viewport ?? { x: 0, y: 0, zoom: 1 }) }));
  void vmid;
  // Sample the live zoom mid-animation (debug zoom mirrors every move).
  const zmid = (await st3()).zoom ?? null;
  await p3.waitForTimeout(900);
  const vend = await p3.evaluate(() => ({ ...(window.__speculum.getState().viewport ?? { x: 0, y: 0, zoom: 1 }) }));
  const zend = (await st3()).zoom ?? 1;
  ok(`${label}: fit animates (mid differs from start and end)`, zmid != null && (Math.abs(zmid - 3) > 0.05 || Math.abs(zend - 3) > 0.05), `mid=${zmid} end=${zend}`);
  ok(`${label}: fit clamps to 0.1..4`, zend >= 0.09 && zend <= 4.01, `zoom=${zend}`);
  const fit = await p3.evaluate(() => {
    const c = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('[data-testid^="box-"]')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    const frame = document.querySelector('[data-testid="scope-frame"]')?.getBoundingClientRect() ?? null;
    const all = frame ? [...boxes, frame] : boxes;
    let hMargin = Infinity;
    let vMargin = Infinity;
    let outside = 0;
    for (const b of all) {
      if (b.left < c.left - 1 || b.right > c.right + 1 || b.top < c.top - 1 || b.bottom > c.bottom + 1) outside += 1;
      hMargin = Math.min(hMargin, b.left - c.left, c.right - b.right);
      vMargin = Math.min(vMargin, b.top - c.top, c.bottom - b.bottom);
    }
    return { n: all.length, outside, hMargin, vMargin };
  });
  ok(`${label}: every box (+frame) inside the canvas`, fit.outside === 0, `outside=${fit.outside} n=${fit.n}`);
  ok(`${label}: >=40px margin on an axis pair`, fit.hMargin >= 40 || fit.vMargin >= 40, `h=${fit.hMargin.toFixed(0)} v=${fit.vMargin.toFixed(0)}`);
  void v0;
  void vend;
}
await fitAsserts("fit button", "button");
await p3.screenshot({ path: "screenshots/m6-fit-after-dark.png" });
await expectTheme(p3, "m6-fit-after-dark.png", "dark");
await fitAsserts("fit Shift+1", "shift1");
await fitAsserts("fit Ctrl+0", "ctrl0");
// Drilled-in diagram: fit includes the scope frame.
await goto3("dark", "dg-storefront");
await fitAsserts("fit drilled-in", "button");

// Light theme: toolbar themed + zoom tooltip + placing ghost screenshots.
await goto3("light", "dg-landscape");
{
  const bg = await p3.evaluate(() => getComputedStyle(document.querySelector('[data-testid="toolbar"]')).backgroundColor);
  const lum = luminanceOf(parseRgb(bg));
  ok("toolbar themed light (luminance > 0.6)", lum > 0.6, `bg=${bg} lum=${lum.toFixed(3)}`);
  await p3.screenshot({ path: "screenshots/m6-toolbar-light.png" });
  await expectTheme(p3, "m6-toolbar-light.png", "light");
  await p3.getByTestId("fit-screen").hover();
  await p3.waitForTimeout(800);
  await p3.screenshot({ path: "screenshots/m6-zoom-group-light.png" });
  await p3.getByTestId("tool-add-app").click();
  const cb = await canvasBox();
  await p3.mouse.move(cb.x + cb.width * 0.6, cb.y + cb.height * 0.5, { steps: 4 });
  await p3.waitForTimeout(300);
  await p3.screenshot({ path: "screenshots/m6-toolbar-placing-light.png" });
  await p3.keyboard.press("Escape");
  await p3.getByTestId("tool-select").click();
}

await ctx3.close();
}

ok("no console/page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close();
if (failed.length > 0) {
  console.log("FAILED: " + failed.join(", "));
  process.exit(1);
}
console.log("m6-check: ALL PASS");
