// Probe: open-phase breakdown for perf-200.
import { chromium } from "../tools-shot/node_modules/playwright-core/index.mjs";

const BASE = process.env.PERF_BASE || "http://localhost:4173/";
function makeDoc(n) {
  const now = "2026-01-01T00:00:00Z";
  const obj = (id, name, type, parentId = null) => ({
    id, name, type, parentId, status: "live", external: false, icon: null,
    caption: "x", description: "", tagIds: [], technologies: [],
    links: [], groupIds: [], domainId: null, labels: {},
  });
  const objects = {};
  const connections = {};
  const boxes = {};
  const cols = Math.ceil(Math.sqrt(n * 1.6));
  objects["perf-sys"] = obj("perf-sys", "Perf System", "system");
  for (let c = 0; c < 12; c++) objects[`perf-sys-c${c}`] = obj(`perf-sys-c${c}`, `Inner ${c + 1}`, "component", "perf-sys");
  for (let i = 0; i < n; i++) {
    const id = i === 0 ? "perf-sys" : `perf-o${i}`;
    if (i > 0) objects[id] = obj(id, `Sys ${i}`, "system");
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
        id, originId: ids[i], targetId: ids[j], name: "", description: "",
        direction: "outgoing", status: "live", lineShape: "curved",
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
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
for (let run = 0; run < 2; run++) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript((d) => {
    if (!sessionStorage.getItem("perf-seeded")) {
      localStorage.setItem("speculum.mock.doc", d);
      sessionStorage.setItem("perf-seeded", "1");
    }
  }, JSON.stringify({ doc: makeDoc(200), rev: 1 }));
  const page = await ctx.newPage();
  await ctx.tracing.start({ screenshots: false, snapshots: false });
  if (process.env.PROBE_NOFONT === "1") {
    await page.route("**/*.woff2", (r) => r.abort());
  }
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
  await cdp.send("Profiler.start");
  await page.goto(BASE + "?theme=dark", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector('[data-testid="box-perf-sys"]') != null, null, { timeout: 30000, polling: 16 });
  const t = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const paints = performance.getEntriesByType("paint").map((p) => `${p.name}@${p.startTime.toFixed(0)}`);
    const resources = performance.getEntriesByType("resource")
      .map((r) => `${r.name.split("/").pop()}:${r.duration.toFixed(0)}`)
      .slice(0, 12);
    const marks = performance.getEntriesByType("mark").map((m) => `${m.name}@${m.startTime.toFixed(0)}`);
    const measures = performance.getEntriesByType("measure").map((m) => `${m.name}=${m.duration.toFixed(1)}`);
    return {
      domContentLoaded: nav.domContentLoadedEventEnd.toFixed(0),
      load: nav.loadEventEnd.toFixed(0),
      transfer: nav.transferSize,
      decoded: nav.decodedBodySize,
      paints,
      resources,
      marks,
      measures,
      now: performance.now().toFixed(0),
    };
  });
  console.log(`run ${run}:`, JSON.stringify(t, null, 1));
  if (run === 0) {
    await ctx.tracing.stop({ path: "./probe-trace-tmp.zip" });
    const { profile } = await cdp.send("Profiler.stop");
    const byFn = new Map();
    const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
    for (let i = 0; i < profile.samples.length; i++) {
      const n = nodes.get(profile.samples[i]);
      if (!n) continue;
      const f = n.callFrame;
      const key = `${f.functionName || "(anon)"} ${ (f.url || "").split("/").pop()}:${f.lineNumber}`;
      byFn.set(key, (byFn.get(key) ?? 0) + 1);
    }
    const total = profile.samples.length;
    const top = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
    console.log(`profile samples=${total} (~0.25ms each):`);
    for (const [k, c] of top) console.log(`  ${(c * 0.25).toFixed(1)}ms  ${k}`);
  }
  await ctx.close();
}
await browser.close();
console.log("probe: DONE");
