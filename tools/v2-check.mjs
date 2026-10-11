// V2 visual-overhaul check (part 2 of 3): square box anatomy + neutral edges.
// Serve app/ui/dist, drive the mock with playwright-core.
import { chromium } from "../tools-shot/node_modules/playwright-core/index.mjs";

const BASE = process.env.V2_BASE || process.env.M6_BASE || "http://localhost:4173/";
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

async function openDiagram(theme, diagram) {
  await page.goto(`${BASE}?theme=${theme}&diagram=${diagram}`, {
    waitUntil: "networkidle",
  });
  await page.locator('[data-testid^="box-"]').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
}

// Fresh session, then open the made-up sample once (persists in storage).
await page.goto(BASE + "?mock=fresh&theme=dark", { waitUntil: "networkidle" });
await page.getByTestId("empty-open-sample").waitFor({ timeout: 15000 });
await page.getByTestId("empty-open-sample").click();
await page.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
await page.waitForTimeout(800);

/** (a) fitted + centred: zoom capped at 1.25, tray/boxes centred in canvas. */
async function assertFitted(label) {
  const s = await st();
  const z = s.zoom ?? 1;
  ok(`${label}: zoom capped at 1.25`, z <= 1.251, `zoom=${z}`);
  const c = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="canvas"]');
    const frame = document.querySelector('[data-testid="scope-frame"]');
    if (!canvas) return null;
    const cr = canvas.getBoundingClientRect();
    let fx, fy, fw, fh;
    if (frame) {
      const fr = frame.getBoundingClientRect();
      fx = fr.x; fy = fr.y; fw = fr.width; fh = fr.height;
    } else {
      const boxes = [...document.querySelectorAll('[data-testid^="box-"]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (boxes.length === 0) return null;
      const x0 = Math.min(...boxes.map((b) => b.x));
      const y0 = Math.min(...boxes.map((b) => b.y));
      const x1 = Math.max(...boxes.map((b) => b.x + b.w));
      const y1 = Math.max(...boxes.map((b) => b.y + b.h));
      fx = x0; fy = y0; fw = x1 - x0; fh = y1 - y0;
    }
    return {
      dx: Math.abs(fx + fw / 2 - (cr.x + cr.width / 2)) / cr.width,
      dy: Math.abs(fy + fh / 2 - (cr.y + cr.height / 2)) / cr.height,
    };
  });
  ok(`${label}: tray centred in canvas`, c != null, JSON.stringify(c));
  if (c != null) {
    ok(`${label}: tray centre within 20% of canvas centre`, c.dx <= 0.2 && c.dy <= 0.2, `dx=${c.dx.toFixed(3)} dy=${c.dy.toFixed(3)}`);
  }
}

/** (b) dot grid faintly visible: token alpha 6-10% + RF background present. */
async function assertDots(label) {
  const r = await page.evaluate(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--sp-color-bg-canvas-dot").trim();
    const bg = document.querySelector(".react-flow__background") != null
      || document.querySelector(".react-flow__background-pattern") != null
      || document.querySelector("svg .react-flow__background") != null
      || [...document.querySelectorAll("svg pattern")].length > 0
      || document.querySelector(".react-flow__background") !== null;
    return { v, bg };
  });
  const m = String(r.v).match(/([\d.]+)\s*\)\s*$/);
  const alpha = m ? Number(m[1]) : NaN;
  ok(`${label}: dot token alpha 6-10%`, !Number.isNaN(alpha) && alpha >= 0.06 && alpha <= 0.10, r.v);
  const bgPresent = await page.evaluate(() => document.querySelector(".react-flow__background") != null);
  ok(`${label}: dot background layer rendered`, bgPresent);
}

/** Step 3: square box anatomy on the scoped (120px) diagram. */
async function assertBoxAnatomy(label) {
  const a = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="box-obj-webapp"]');
    if (!box) return null;
    const title = box.querySelector(".spec-box__title");
    const kind = box.querySelector(".spec-box__kind");
    const icon = box.querySelector(".spec-box__icon svg");
    const dot = box.querySelector(".spec-box__dot");
    const glyphs = box.querySelectorAll(".spec-box__glyph").length;
    const tags = box.querySelectorAll(".spec-box__tags, .sp-tag-pill").length;
    return {
      titleAlign: title ? getComputedStyle(title).textAlign : null,
      titleSize: title ? getComputedStyle(title).fontSize : null,
      titleWeight: title ? getComputedStyle(title).fontWeight : null,
      kindText: kind?.textContent ?? null,
      kindTransform: kind ? getComputedStyle(kind).textTransform : null,
      kindFont: kind ? getComputedStyle(kind).fontFamily : null,
      kindSize: kind ? getComputedStyle(kind).fontSize : null,
      icon: icon != null,
      iconW: icon ? icon.getAttribute("width") : null,
      dot: dot != null,
      dotW: dot ? getComputedStyle(dot).width : null,
      glyphs,
      tags,
      drillWith: document.querySelector('[data-testid="drill-obj-webapp"]') != null,
      drillWithout: document.querySelector('[data-testid="drill-obj-orders"]') != null,
      captionInSquare: box.querySelector(".spec-box__caption") != null,
    };
  });
  ok(`${label}: box rendered`, a != null);
  if (a == null) return;
  ok(`${label}: centred name`, a.titleAlign === "center", a.titleAlign ?? "(none)");
  ok(`${label}: name 16-17px/500`, (a.titleSize === "16px" || a.titleSize === "17px") && (a.titleWeight === "500" || a.titleWeight === 500), `${a.titleSize}/${a.titleWeight}`);
  ok(`${label}: kind icon 24-28px`, a.icon && ["24", "25", "26", "27", "28"].includes(String(a.iconW)), `w=${a.iconW}`);
  ok(`${label}: mono kind line at bottom`, a.kindText != null && /mono|JetBrains|Consolas/i.test(a.kindFont ?? ""), `${a.kindText} / ${a.kindFont}`);
  ok(`${label}: kind not uppercase`, a.kindTransform === "none", `transform=${a.kindTransform} text=${a.kindText}`);
  ok(`${label}: 6px status dot`, a.dot && a.dotW === "6px", `w=${a.dotW}`);
  ok(`${label}: no uppercase kind header`, a.glyphs === 0, `glyphs=${a.glyphs}`);
  ok(`${label}: no tag pills in square box`, a.tags === 0, `tags=${a.tags}`);
  ok(`${label}: child-count glyph only on boxes with children`, a.drillWith && !a.drillWithout, `with=${a.drillWith} without=${a.drillWithout}`);
}

// Clicking the child-count glyph drills into the child level.
async function assertDrill(label) {
  await page.getByTestId("box-obj-webapp").hover();
  await page.waitForTimeout(300);
  await page.getByTestId("drill-obj-webapp").click();
  await page.getByTestId("box-obj-cart").waitFor({ timeout: 15000 });
  await page.waitForTimeout(900);
  const s = await st();
  ok(`${label}: clicking drill opens the child level`, s.scope === "obj-webapp", `scope=${s.scope}`);
}

/** Step 4: default link look (neutral grey, solid, filled arrowhead). */
async function assertDefaultEdge(label, theme) {
  const s = await st();
  const live = s.sublinks.find((sl) => sl.status === "live" && !sl.lower);
  ok(`${label}: a live default link exists`, live != null, live?.testId ?? "(none)");
  if (live == null) return;
  const e = await page.evaluate((pathTestId) => {
    const p = document.querySelector(`[data-testid="${pathTestId}"]`);
    if (!p) return null;
    const cs = getComputedStyle(p);
    const g = p.closest("g[data-testid]");
    const arrow = g?.querySelector('[data-arrow="end"]') ?? g?.querySelector("[data-arrow]");
    const acs = arrow ? getComputedStyle(arrow) : null;
    return {
      stroke: cs.stroke,
      width: cs.strokeWidth,
      dash: cs.strokeDasharray,
      arrowFill: acs ? acs.fill : null,
      arrows: g?.querySelectorAll("[data-arrow]").length ?? 0,
    };
  }, live.pathTestId ?? `spec-edge-path-${live.edgeIndex}`);
  ok(`${label}: default edge rendered`, e != null, JSON.stringify(e?.stroke));
  if (e == null) return;
  const rgb = parseRgb(e.stroke);
  const neutral = rgb != null && Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]) <= 12;
  ok(`${label}: default stroke is neutral grey`, neutral, e.stroke);
  ok(`${label}: default stroke is solid`, e.dash === "none" || e.dash === "", `dasharray=${e.dash}`);
  ok(`${label}: default width is 1.5px`, e.width === "1.5px", `width=${e.width}`);
  ok(`${label}: arrowhead filled`, e.arrows >= 1 && e.arrowFill != null && e.arrowFill !== "none", `fill=${e.arrowFill}`);
  void theme;
}

/** Hover highlight: own links hi (white/near-black 2px, no dash), rest dimmed. */
async function assertHover(label, theme) {
  await page.getByTestId("box-obj-webapp").hover();
  await page.waitForTimeout(600);
  const hi = await page.locator(".react-flow__edge.flow-edge--hi").count();
  ok(`${label}: hover highlights connected edges`, hi >= 1, `hi=${hi}`);
  const w = await page.evaluate(() => {
    const p = document.querySelector(".flow-edge--hi .spec-edge__path");
    if (!p) return null;
    const cs = getComputedStyle(p);
    return { width: cs.strokeWidth, stroke: cs.stroke, dash: cs.strokeDasharray, anim: cs.animationName };
  });
  ok(`${label}: highlighted edge is 2px`, w?.width === "2px", `strokeWidth=${w?.width}`);
  const rgb = w ? parseRgb(w.stroke) : null;
  const wantHi = theme === "dark"
    ? rgb != null && luminanceOf(rgb) > 0.8
    : rgb != null && luminanceOf(rgb) < 0.2;
  ok(`${label}: highlighted edge is ${theme === "dark" ? "white" : "near-black"}`, wantHi, w?.stroke ?? "(none)");
  ok(`${label}: highlighted edge not dashed`, w?.dash === "none" || w?.dash === "", `dasharray=${w?.dash}`);
  const dim = await page.evaluate(() => {
    const n = document.querySelector(".spec-node--dim");
    const e = document.querySelector(".flow-edge--dim");
    return {
      node: n ? getComputedStyle(n).opacity : null,
      edge: e ? getComputedStyle(e).opacity : null,
    };
  });
  const dimOk = (v) => v != null && Math.abs(Number(v) - 0.25) <= 0.03;
  ok(`${label}: unrelated boxes dim to ~0.25`, dimOk(dim.node), `opacity=${dim.node}`);
  ok(`${label}: unrelated links dim to ~0.25`, dimOk(dim.edge), `opacity=${dim.edge}`);
}

/** Rolled-up link: count badge (number, no xN text). */
async function assertBadge(label) {
  const n = await page.locator('[data-testid="spec-edge-badge"]').count();
  ok(`${label}: rolled-up count badge present`, n >= 1, `badges=${n}`);
  if (n >= 1) {
    const text = (await page.locator('[data-testid="spec-edge-badge"]').first().textContent()) ?? "";
    ok(`${label}: badge shows a number`, /^\d+$/.test(text.trim()), text);
    const box = await page.locator('[data-testid="spec-edge-badge"]').first().boundingBox();
    ok(`${label}: badge is ~18px tall`, box != null && Math.abs(box.height - 18) <= 5, `h=${box?.height}`);
  }
}

/** Label pill: radius 4, never covers a box. */
async function assertLabels(label) {
  const pills = page.locator('[data-testid="spec-edge-label"]');
  const n = await pills.count();
  ok(`${label}: label pills render`, n >= 1, `labels=${n}`);
  if (n >= 1) {
    const r = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="spec-edge-label"]');
      return el ? getComputedStyle(el).borderRadius : null;
    });
    ok(`${label}: label pill radius is 4px`, r === "4px", r ?? "(none)");
  }
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
    return { bad: labels.filter((l) => boxes.some((b) => hit(l, b, 1))).map((l) => l.t) };
  });
  ok(`${label}: no label covers a box`, res.bad.length === 0, res.bad.slice(0, 3).join(" | "));
}

/** (d) Labels toggle lives top-right, not floating over the canvas centre. */
async function assertToolbar(label) {
  const r = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="labels-toggle"]');
    const c = document.querySelector('[data-testid="canvas"]');
    if (!t || !c) return null;
    const tr = t.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    return { x: (tr.x + tr.width / 2 - cr.x) / cr.width, y: (tr.y - cr.y) / cr.height, w: tr.width };
  });
  ok(`${label}: labels toggle rendered`, r != null);
  if (r != null) {
    ok(`${label}: labels toggle in top-right`, r.x > 0.6 && r.y < 0.25, `x=${r.x.toFixed(2)} y=${r.y.toFixed(2)}`);
  }
}

/** (e) halo/label click selects its link on the crowded landscape. */
async function assertHitTest(label) {
  const s = await st();
  const target = s.sublinks.find((sl) => sl.connId !== "");
  ok(`${label}: clickable link exists`, target != null);
  if (target == null) return;
  for (const f of [0.5, 0.3, 0.7]) {
    const pt = await page.evaluate(([tid, frac]) => {
      const g = document.querySelector(`[data-testid="${tid}"]`);
      const path = g?.querySelector(".spec-edge__halo");
      if (!path) return null;
      const q = path.getPointAtLength(path.getTotalLength() * frac);
      const d = new DOMPoint(q.x, q.y).matrixTransform(path.getScreenCTM());
      return { x: d.x, y: d.y };
    }, [target.testId, f]);
    if (!pt) continue;
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(500);
    if ((await st()).selectedEdge?.connId === target.connId) break;
  }
  ok(`${label}: halo click selects its link`, (await st()).selectedEdge?.connId === target.connId, `sel=${(await st()).selectedEdge?.connId}`);
}

// Storefront Apps, dark -------------------------------------------------------
await openDiagram("dark", "dg-storefront");
await assertFitted("apps-dark");
await assertDots("apps-dark");
await assertBoxAnatomy("apps-dark");
await assertDefaultEdge("apps-dark", "dark");
await assertHover("apps-dark", "dark");
await assertLabels("apps-dark");
await assertToolbar("apps-dark");
await page.screenshot({ path: "screenshots/v2-apps-dark.png" });
await page.screenshot({ path: "screenshots/v2-hover-dark.png" });

// Drill from the child-count glyph --------------------------------------------
await assertDrill("apps-dark");
await openDiagram("dark", "dg-storefront");

// Storefront Apps, light ------------------------------------------------------
await openDiagram("light", "dg-storefront");
await assertFitted("apps-light");
await assertDots("apps-light");
await assertBoxAnatomy("apps-light");
await assertDefaultEdge("apps-light", "light");
await assertHover("apps-light", "light");
await assertLabels("apps-light");
await assertToolbar("apps-light");
await page.screenshot({ path: "screenshots/v2-apps-light.png" });

// Landscape, dark: wide variant + badge + hit test ----------------------------
await openDiagram("dark", "dg-landscape");
{
  const s = await st();
  const rects = s.rects;
  const ids = Object.keys(rects);
  ok("landscape: boxes are 220x110", ids.length > 0 && ids.every((id) => rects[id].w === 220 && rects[id].h === 110));
  const wide = await page.evaluate(() => {
    const box = document.querySelector('[data-testid^="box-"]');
    if (!box) return null;
    const cap = box.querySelector(".spec-box__caption")?.textContent ?? null;
    const tech = box.querySelector(".spec-box__tech")?.textContent ?? null;
    const t = box.querySelector(".spec-box__title")?.getBoundingClientRect();
    const c = box.querySelector(".spec-box__caption")?.getBoundingClientRect();
    const f = box.querySelector(".spec-box__tech")?.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const noOverlap = !!(t && c && f && t.bottom <= c.top + 0.5 && c.bottom <= f.top + 0.5 && f.bottom <= b.bottom + 0.5);
    return { cap, tech, noOverlap, t: t && [t.top, t.bottom], c: c && [c.top, c.bottom], f: f && [f.top, f.bottom], b: [b.top, b.bottom] };
  });
  ok("landscape: wide box name, caption and footer do not overlap", wide?.noOverlap === true, JSON.stringify(wide));
  ok("landscape: wide box shows 1-line caption", wide?.cap != null && wide.cap !== "", wide?.cap ?? "(none)");
  ok("landscape: wide box shows [Kind: tech] footer", wide?.tech != null && /^\[.+\]$/.test(wide.tech ?? ""), wide?.tech ?? "(none)");
}
await assertFitted("landscape-dark");
await assertBadge("landscape-dark");
await assertLabels("landscape-dark");
await assertHitTest("landscape-dark");
await page.screenshot({ path: "screenshots/v2-landscape-dark.png" });

ok("no console/page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close();
if (failed.length > 0) {
  console.log("FAILED: " + failed.join(", "));
  process.exit(1);
}
console.log("v2-check: ALL PASS");
