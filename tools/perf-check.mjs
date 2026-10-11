// Quick performance check (PLAN 5.7). Generates made-up sample models with
// N objects on one level (default 200 and 500), loads each through the
// in-browser mock and measures: cold open to interactive canvas, hover and
// selection frame times, pan/zoom frame times, drill-in/out duration and
// the longest frame during a drill. Prints a table and writes
// screenshots/perf-<N>-dark.png. Budgets are reported as PASS/WARN only:
// headless software rendering is slower than the real app, so this check
// is for trends; the release gate is the in-app benchmark (PLAN 9.4).
import { chromium } from "../tools-shot/node_modules/playwright-core/index.mjs";

const BASE = process.env.PERF_BASE || "http://localhost:4173/";
const SIZES = (process.env.PERF_SIZES || "200,500").split(",").map(Number);
const KINDS = ["app", "component", "store", "app", "component"];
const WORDS = ["Orders", "Cart", "Catalog", "Billing", "Search", "Shipping", "Users", "Reviews", "Stock", "Pricing", "Alerts", "Reports"];

function makeDoc(n) {
  const now = "2026-01-01T00:00:00Z";
  const obj = (id, name, type, parentId = null) => ({
    id, name, type, parentId, status: "live", external: false, icon: null,
    caption: `${type} for perf sample`, description: "", tagIds: [], technologies: [],
    links: [], groupIds: [], domainId: null, labels: {},
  });
  const objects = {};
  const connections = {};
  const boxes = {};
  const cols = Math.ceil(Math.sqrt(n * 1.6));
  // One system with 12 children so a drill-in can be measured.
  objects["perf-sys"] = obj("perf-sys", "Perf System", "system");
  for (let c = 0; c < 12; c++) objects[`perf-sys-c${c}`] = obj(`perf-sys-c${c}`, `Inner ${c + 1}`, "component", "perf-sys");
  for (let i = 0; i < n; i++) {
    const id = i === 0 ? "perf-sys" : `perf-o${i}`;
    if (i > 0) objects[id] = obj(id, `${WORDS[i % WORDS.length]} ${i}`, KINDS[i % KINDS.length] === "component" ? "system" : "system");
    boxes[id] = { x: (i % cols) * 180, y: Math.floor(i / cols) * 180, w: 120, h: 120 };
  }
  const ids = Object.keys(boxes);
  let k = 0;
  for (let i = 0; i < ids.length; i++) {
    for (const off of [1, cols]) {
      const j = i + off;
      if (j >= ids.length || k >= Math.round(n * 1.5)) continue;
      const id = `perf-l${k++}`;
      connections[id] = {
        id, originId: ids[i], targetId: ids[j], name: k % 4 === 0 ? "calls" : "",
        description: "", direction: "outgoing", status: "live", lineShape: "curved",
        labelPosition: null, viaId: null, tagIds: [], technologies: [], links: [],
      };
    }
  }
  return {
    schema: 1,
    meta: { name: `Perf ${n}`, created: now, modified: now },
    model: { objects, connections, tags: {}, tagGroups: {}, domains: {}, flows: {} },
    diagrams: {
      "dg-perf": {
        id: "dg-perf", name: `Perf ${n} Landscape`, level: "context", scopeObjectId: null,
        domainId: null, description: "", order: 0, pinned: false, boxes,
        connections: {}, viewport: null, landing: {}, autoPlaced: false,
        showAllLabels: false, created: now, modified: now,
      },
    },
  };
}

const pct = (a, p) => {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "?");

async function startFrames(page) {
  await page.evaluate(() => {
    window.__perfFrames = [];
    let last = performance.now();
    window.__perfOn = true;
    const tick = (t) => {
      window.__perfFrames.push(t - last);
      last = t;
      if (window.__perfOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); });
  });
}
async function stopFrames(page) {
  return page.evaluate(() => { window.__perfOn = false; return window.__perfFrames.slice(1); });
}

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const rows = [];
const errors = [];
for (const n of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const doc = makeDoc(n);
  await ctx.addInitScript((d) => {
    if (!sessionStorage.getItem("perf-seeded")) {
      localStorage.setItem("speculum.mock.doc", d);
      sessionStorage.setItem("perf-seeded", "1");
    }
  }, JSON.stringify({ doc, rev: 1 }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${n}: ${e.message} @ ${(e.stack || "").split("\n").slice(0, 4).join(" < ")}`));
  // Open: navigation start -> all level boxes rendered or culled-but-mounted canvas accepting input.
  await page.goto(BASE + "?theme=dark", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector('[data-testid="box-perf-sys"]') != null, null, { timeout: 30000, polling: 16 });
  const openMs = await page.evaluate(() => performance.now());
  const boxCount = await page.evaluate(() => document.querySelectorAll('.react-flow__node [data-testid^="box-"]:not([data-testid^="box-name-"]):not([data-testid^="box-kind-"])').length);
  // Speed-run hook (additive): dev-only in-app timings + render counts.
  const perfOpen = await page.evaluate(() => {
    try {
      const p = window.__speculum?.perf;
      if (!p) return null;
      return { lastOpenMs: p.lastOpenMs, boxRenders: p.boxRenders, edgeRenders: p.edgeRenders };
    } catch { return null; }
  });
  await page.evaluate(() => { try { window.__speculum?.perf?.reset(); } catch {} });
  await page.waitForTimeout(800);
  // Fit so the whole level is on screen (worst case for pan/zoom).
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(600);
  const canvas = await page.getByTestId("canvas").boundingBox();
  const cx = canvas.x + canvas.width / 2, cy = canvas.y + canvas.height / 2;

  // Pan + zoom at the fitted (everything visible) zoom.
  await startFrames(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 200, cy + 120, { steps: 40 });
  await page.mouse.move(cx - 100, cy - 60, { steps: 40 });
  await page.mouse.up();
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, i < 4 ? -120 : 120); await page.waitForTimeout(40); }
  const panZoom = await stopFrames(page);
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(600);

  // Hover sweep across boxes.
  await page.getByTestId("box-perf-sys").scrollIntoViewIfNeeded().catch(() => {});
  const bb = await page.getByTestId("box-perf-sys").boundingBox();
  await startFrames(page);
  for (let i = 0; i < 30; i++) { await page.mouse.move(bb.x + bb.width / 2 + i * 12, bb.y + bb.height / 2 + i * 6, { steps: 2 }); }
  const hover = await stopFrames(page);

  // Selection: time from click dispatch (in page) to the next painted frame after selection lands.
  const selMs = [];
  for (const id of ["perf-sys", "perf-o1", "perf-o2", "perf-o3", "perf-o4"]) {
    const b = await page.getByTestId(`box-${id}`).boundingBox().catch(() => null);
    if (!b) continue;
    const ms = await page.evaluate(async ({ id, x, y }) => {
      const el = document.elementFromPoint(x, y);
      const t0 = performance.now();
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        el?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
      }
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        if (window.__speculum.getState().selection.includes(id)) return performance.now() - t0;
      }
      return NaN;
    }, { id, x: b.x + b.width / 2, y: b.y + b.height - 14 });
    selMs.push(ms);
  }
  await page.keyboard.press("Escape");

  // Drill in / out.
  await page.getByTestId("box-perf-sys").hover();
  await page.waitForTimeout(200);
  await startFrames(page);
  // In-page tap log (additive): captures the animating true-window even
  // when the driver returns after the drill already settled, so fast
  // drills are measured from the in-page click event, not driver overhead.
  await page.evaluate(() => {
    window.__drillTap = { tClick: 0, tTrue: 0, tFalse: 0 };
    const stamp = () => performance.now();
    document.addEventListener("click", () => { if (!window.__drillTap.tClick) window.__drillTap.tClick = stamp(); }, true);
    document.addEventListener("dblclick", () => { if (!window.__drillTap.tClick) window.__drillTap.tClick = stamp(); }, true);
    let last = window.__speculum.getState().animating;
    window.__drillTapTimer = setInterval(() => {
      const a = window.__speculum.getState().animating;
      if (a !== last) {
        if (a) window.__drillTap.tTrue = stamp();
        else window.__drillTap.tFalse = stamp();
        last = a;
      }
    }, 5);
  });
  let t0 = Date.now();
  // Zoomed out to fit, the drill badge may be hidden: double-click drills too.
  const drillBadge = page.getByTestId("drill-perf-sys");
  if (await drillBadge.isVisible().catch(() => false)) await drillBadge.click();
  else await page.getByTestId("box-perf-sys").dblclick({ position: { x: 10, y: 10 } });
  await page.waitForFunction(() => window.__speculum.getState().animating === true, null, { timeout: 2000, polling: 5 }).catch(() => {});
  await page.waitForFunction(() => window.__speculum.getState().animating === false, null, { timeout: 4000, polling: 5 });
  const drillIn = Date.now() - t0;
  const drillTapIn = await page.evaluate(() => {
    const t = window.__drillTap;
    window.__drillTap = { tClick: 0, tTrue: 0, tFalse: 0 };
    if (!t || !t.tClick || !t.tFalse) return null;
    return { inPageMs: t.tFalse - t.tClick, sawTrue: !!t.tTrue };
  });
  await page.waitForTimeout(400);
  t0 = Date.now();
  await page.keyboard.press("Backspace");
  await page.waitForFunction(() => window.__speculum.getState().animating === true, null, { timeout: 2000, polling: 5 }).catch(() => {});
  await page.waitForFunction(() => window.__speculum.getState().animating === false, null, { timeout: 4000, polling: 5 });
  const drillUp = Date.now() - t0;
  const drillFrames = await stopFrames(page);
  await page.evaluate(() => { try { clearInterval(window.__drillTapTimer); } catch {} });
  const drillTap = drillTapIn;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `screenshots/perf-${n}-dark.png` });

  const perfDrill = await page.evaluate(() => {
    try {
      const p = window.__speculum?.perf;
      if (!p) return null;
      return { lastDrillMs: p.lastDrillMs, boxRenders: p.boxRenders, edgeRenders: p.edgeRenders };
    } catch { return null; }
  });
  const drillApp = await page.evaluate(() => {
    try { return window.__speculum?.perf?.lastDrillClickMs ?? null; } catch { return null; }
  });
  rows.push({
    n, boxCount, links: Object.keys(doc.model.connections).length,
    openMs, drillIn, drillUp, perfOpen, perfDrill, drillTap, drillApp,
    panMean: mean(panZoom), panP95: pct(panZoom, 95),
    hoverMean: mean(hover), hoverP95: pct(hover, 95),
    selMean: mean(selMs.filter(Number.isFinite)), selMax: Math.max(...selMs.filter(Number.isFinite)),
    drillMaxFrame: Math.max(...drillFrames),
  });
  await ctx.close();
}
await browser.close();

const mark = (ok) => (ok ? "PASS" : "WARN");
for (const r of rows) {
  console.log(`--- ${r.n} objects (${r.boxCount} box nodes mounted, ${r.links} links) ---`);
  console.log(`${mark(r.openMs < (r.n <= 200 ? 300 : 1500))}  open to interactive canvas      ${f1(r.openMs)} ms (budget ${r.n <= 200 ? "300 ms" : "1500 ms cold start"})`);
  console.log(`${mark(r.drillIn >= 170 && r.drillIn <= 300)}  drill-in (click to settled)      ${r.drillIn} ms (budget 180-220 in-app; includes click round-trip)`);
  console.log(`${mark(r.drillUp >= 160 && r.drillUp <= 300)}  drill-out (key to settled)       ${r.drillUp} ms`);
  console.log(`${mark(r.drillMaxFrame <= 50)}  longest frame during drills      ${f1(r.drillMaxFrame)} ms (input not blocked if <=50)`);
  console.log(`${mark(r.panMean <= 16.7 && r.panP95 <= 25)}  pan/zoom frames                  mean ${f1(r.panMean)} / p95 ${f1(r.panP95)} ms (budget 16.7 / 25)`);
  console.log(`${mark(r.hoverP95 <= 25)}  hover sweep frames               mean ${f1(r.hoverMean)} / p95 ${f1(r.hoverP95)} ms (budget 16 per highlight)`);
  console.log(`${mark(r.selMax <= 16.7 * 2)}  selection to painted frame       mean ${f1(r.selMean)} / max ${f1(r.selMax)} ms (budget 16)`);
  if (r.perfOpen) console.log(`  in-app open fetch ${f1(r.perfOpen.lastOpenMs)} ms | box renders ${r.perfOpen.boxRenders} edge renders ${r.perfOpen.edgeRenders}`);
  if (r.perfDrill?.lastDrillMs) {
    const d = r.perfDrill.lastDrillMs;
    console.log(`  in-app drill fetch ${f1(d.fetchMs)} / build ${f1(d.buildMs)} / total ${f1(d.totalMs)} ms | box renders ${r.perfDrill.boxRenders} edge renders ${r.perfDrill.edgeRenders}`);
  }
  if (r.drillTap) console.log(`  in-page drill click-to-settled  ${f1(r.drillTap.inPageMs)} ms (sawTrue=${r.drillTap.sawTrue})`);
  if (r.drillApp != null) console.log(`  app drill gesture-to-settled   ${f1(r.drillApp)} ms (handler entry to animating false)`);
  // Speed-run real budgets (additive, never loosened): open 200 < 300 ms;
  // drill-in on 500 < 250 ms click-to-settled; pan/zoom mean <= 17 ms on
  // 500; hover p95 <= 25 ms; select mean < 16 ms in-page event-to-frame.
  // drill500 uses the app gesture measurement when available (it excludes
  // driver actionability overhead, which dominates on 500-node DOMs).
  const drill500 = r.drillApp ?? (r.drillTap ? r.drillTap.inPageMs : r.drillIn);
  const speedOk =
    (r.n !== 200 || r.openMs < 300) &&
    (r.n !== 500 || drill500 < 250) &&
    (r.n !== 500 || r.panMean <= 17) &&
    r.hoverP95 <= 25 &&
    r.selMean < 16;
  console.log(`${mark(speedOk)}  SPEED-RUN budgets                open200<300 drill500<250 panMean<=17 hoverP95<=25 selMean<16`);
}
if (errors.length) console.log("page errors: " + errors.slice(0, 3).join(" | "));
console.log("perf-check: DONE " + JSON.stringify(rows));
