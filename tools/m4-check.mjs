// M4 smoke check: serve app/ui/dist, drive the mock with playwright-core.
import { chromium } from "../tools-shot/node_modules/playwright-core/index.mjs";
import { inflateSync } from "node:zlib";

function pngAverage(buf) {
  // Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced): average RGB.
  const b = Buffer.from(buf);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png");
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  const idat = [];
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString("ascii", pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6))
    throw new Error(`unsupported png depth=${bitDepth} type=${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  let r = 0;
  let g = 0;
  let bl = 0;
  let n = 0;
  let prev = Buffer.alloc(stride);
  let p = 0;
  const paeth = (a, bb2, c) => {
    const pp = a + bb2 - c;
    const pa = Math.abs(pp - a);
    const pb = Math.abs(pp - bb2);
    const pc = Math.abs(pp - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? bb2 : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const cur = Buffer.alloc(stride);
    raw.copy(cur, 0, p, p + stride);
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const bb2 = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = cur[i];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + bb2) & 255;
      else if (filter === 3) v = (v + ((a + bb2) >> 1)) & 255;
      else if (filter === 4) v = (v + paeth(a, bb2, c)) & 255;
      cur[i] = v;
    }
    for (let x = 0; x < width; x++) {
      r += cur[x * channels];
      g += cur[x * channels + 1];
      bl += cur[x * channels + 2];
      n++;
    }
    prev = cur;
  }
  return [r / n, g / n, bl / n];
}

const BASE = process.env.M4_BASE || "http://127.0.0.1:4173/";
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

async function themeProbe(page) {
  return page.evaluate(() => {
    const theme = document.documentElement.dataset.theme || "";
    const el =
      document.querySelector('[data-testid="canvas"]') ||
      document.querySelector(".app-main") ||
      document.body;
    const bg = getComputedStyle(el).backgroundColor;
    return { theme, bg };
  });
}

function parseRgb(s) {
  const m = String(s).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

async function expectTheme(page, shotName, want) {
  const { theme, bg } = await themeProbe(page);
  const rgb = parseRgb(bg);
  const lum = rgb ? luminanceOf(rgb) : NaN;
  const themeOk = theme === want;
  const lumOk =
    rgb != null && (want === "dark" ? lum < 0.2 : lum >= 0.2);
  ok(
    `${shotName} renders ${want} theme`,
    themeOk,
    `data-theme=${theme}`,
  );
  ok(
    `${shotName} background is ${want}`,
    lumOk,
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

// 1. fresh -> empty state (dark theme forced so the dark shot is labeled right)
await page.goto(BASE + "?mock=fresh&theme=dark", { waitUntil: "networkidle" });
await page.getByTestId("empty-open-sample").waitFor({ timeout: 15000 });
ok("fresh shows empty state", true);
ok("canvas hidden when empty", (await page.getByTestId("canvas").count()) === 0);

// 2. open sample -> boxes render
await page.getByTestId("empty-open-sample").click();
await page.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
const boxCount = await page.locator('[data-testid^="box-"]').count();
ok("sample renders boxes", boxCount >= 4, `count=${boxCount}`);
const st1 = await page.evaluate(() => window.__speculum.getState());
ok("debug api exposes diagram", !!st1.diagramId, `diagram=${st1.diagramId}`);
const before = st1.rects["obj-customer"];
ok("customer rect present", !!before, JSON.stringify(before));
// (a) counts refresh without reload: status bar + side panel + debug api
await page
  .getByTestId("status-counts")
  .waitFor({ timeout: 15000 });
await page.waitForFunction(
  () =>
    document.querySelector('[data-testid="status-counts"]')?.textContent
      ?.includes("15 objects"),
  { timeout: 15000 },
);
const countsText = await page.getByTestId("status-counts").textContent();
ok(
  "status counts show sample (15 objects, 15 links)",
  (countsText ?? "").includes("15 objects") &&
    (countsText ?? "").includes("15 links"),
  countsText ?? "",
);
const pObjs = await page.getByTestId("panel-count-objects").textContent();
const pLinks = await page.getByTestId("panel-count-links").textContent();
const pFlows = await page.getByTestId("panel-count-flows").textContent();
ok(
  "side panel shows sample counts 15/15/0",
  (pObjs ?? "").trim() === "15" &&
    (pLinks ?? "").trim() === "15" &&
    (pFlows ?? "").trim() === "0",
  `objects=${pObjs} links=${pLinks} flows=${pFlows}`,
);
const stCounts = await page.evaluate(() => window.__speculum.getState());
ok(
  "debug counts match panel",
  stCounts.counts?.objects === 15 &&
    stCounts.counts?.links === 15 &&
    stCounts.counts?.flows === 0,
  JSON.stringify(stCounts.counts),
);
await page.screenshot({ path: "screenshots/m4-sample-dark.png" });
await expectTheme(page, "m4-sample-dark.png", "dark");
// Attribution badge must stay visible (makers ask Pro to hide it).
const attr = await page.evaluate(() => {
  const el = document.querySelector(".react-flow__attribution");
  if (!el) return { found: false, w: 0, h: 0, opacity: "0" };
  const r = el.getBoundingClientRect();
  return {
    found: true,
    w: r.width,
    h: r.height,
    opacity: getComputedStyle(el).opacity,
  };
});
ok(
  "react-flow attribution visible",
  attr.found && attr.w > 0 && attr.h > 0 && Number(attr.opacity) > 0.5,
  JSON.stringify(attr),
);
// 2b. canvas uniformity after panning: no painted rectangle may move with
// the content (regression: background on the transformed viewport layer).
{
  const canvasBox = await page.getByTestId("canvas").boundingBox();
  ok("canvas box measurable for pan check", !!canvasBox, JSON.stringify(canvasBox));
  if (canvasBox) {
    // Pan by 200px via an empty-canvas drag (bottom edge, away from boxes).
    const sx = canvasBox.x + canvasBox.width / 2;
    const sy = canvasBox.y + canvasBox.height - 40;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 200, sy, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    const inset = 10;
    const size = 12;
    // Bottom-right is shifted left to stay clear of the React Flow
    // attribution badge (which must remain visible).
    // Clips stay clear of canvas chrome: the M6 left tool bar (44px),
    // the breadcrumb card (top-left), and the zoom/labels groups
    // (top-right). They still sample the painted canvas background.
    const leftX = canvasBox.x + 44 + inset;
    const topY = canvasBox.y + 90;
    const clips = [
      { x: leftX, y: topY, width: size, height: size },
      { x: canvasBox.x + canvasBox.width - inset - size, y: topY, width: size, height: size },
      { x: leftX, y: canvasBox.y + canvasBox.height - inset - size, width: size, height: size },
      { x: canvasBox.x + canvasBox.width - inset - size - 140, y: canvasBox.y + canvasBox.height - inset - size, width: size, height: size },
    ];
    const avgs = [];
    for (const clip of clips) {
      const buf = await page.screenshot({ clip });
      avgs.push(pngAverage(buf));
    }
    let maxDiff = 0;
    for (let i = 0; i < avgs.length; i++) {
      for (let j = i + 1; j < avgs.length; j++) {
        for (let k = 0; k < 3; k++) {
          maxDiff = Math.max(maxDiff, Math.abs(avgs[i][k] - avgs[j][k]));
        }
      }
    }
    ok(
      "canvas corners uniform after 200px pan",
      maxDiff <= 14,
      `maxDiff=${maxDiff.toFixed(1)} avgs=${avgs.map((a) => a.map((v) => v.toFixed(0)).join(",")).join(" | ")}`,
    );
    // Pan back so later drag assertions start from the same place.
    // Wait past the 600ms debounced viewport save so the save settles
    // before the next drag (a save landing mid-drag can reset the nodes).
    await page.mouse.move(sx + 200, sy);
    await page.mouse.down();
    await page.mouse.move(sx, sy, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
  }
}

// 3. drag customer box, check rect moved + snapped
const handle = page.getByTestId("box-obj-customer");
const bb = await handle.boundingBox();
const cx = bb.x + bb.width / 2;
const cy = bb.y + bb.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 83, cy + 41, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(800);
const st2 = await page.evaluate(() => window.__speculum.getState());
const after = st2.rects["obj-customer"];
const dx = after.x - before.x;
const dy = after.y - before.y;
ok("drag moves box", Math.abs(dx) > 40 && Math.abs(dy) > 20, `dx=${dx} dy=${dy}`);
ok("drag snapped to 8px", after.x % 8 === 0 && after.y % 8 === 0, `x=${after.x} y=${after.y}`);

// 4. undo/redo in the same session (history is per session, like the app)
await page.keyboard.press("Control+z");
await page.waitForTimeout(800);
const stU = await page.evaluate(() => window.__speculum.getState());
ok("undo restores previous position", JSON.stringify(stU.rects["obj-customer"]) === JSON.stringify(before), JSON.stringify(stU.rects["obj-customer"]));
await page.keyboard.press("Control+y");
await page.waitForTimeout(800);
const stR = await page.evaluate(() => window.__speculum.getState());
ok("redo re-applies the move", JSON.stringify(stR.rects["obj-customer"]) === JSON.stringify(after), JSON.stringify(stR.rects["obj-customer"]));

// 5. reopen (no ?mock=fresh, which would wipe storage) -> position persists
await page.goto(BASE + "?theme=dark", { waitUntil: "networkidle" });
await page.getByTestId("box-obj-customer").waitFor({ timeout: 15000 });
const st3 = await page.evaluate(() => window.__speculum.getState());
ok("position persists across close/reopen", JSON.stringify(st3.rects["obj-customer"]) === JSON.stringify(after), JSON.stringify(st3.rects["obj-customer"]));
await page.screenshot({ path: "screenshots/m4-after-reopen-dark.png" });
await expectTheme(page, "m4-after-reopen-dark.png", "dark");

// 6. chrome: zoom + switcher + hover dimming
const zoomText = await page.getByTestId("status-zoom").textContent();
ok("status zoom visible", /\d+%/.test(zoomText ?? ""), zoomText ?? "");
await page.getByTestId("box-obj-storefront").hover();
await page.waitForTimeout(300);
const dimmed = await page.locator(".spec-node--dim").count();
ok("hover dims unrelated boxes", dimmed > 0, `dimmed=${dimmed}`);

// 7. remove-from-diagram via keyboard + toast undo
await page.getByTestId("box-obj-support").click();
await page.keyboard.press("Delete");
await page.waitForTimeout(800);
const st5 = await page.evaluate(() => window.__speculum.getState());
ok("delete removes from diagram only", st5.rects["obj-support"] === undefined);
const toastCount = await page.locator(".app-toast").count();
ok("toast shown", toastCount === 1);
await page.locator(".app-toast button").click();
await page.waitForTimeout(800);
const st6 = await page.evaluate(() => window.__speculum.getState());
ok("toast undo restores box", st6.rects["obj-support"] !== undefined);

// 7b. delete-from-model via the details panel updates counts without reload,
// then undo restores them.
const countsBefore = await page.evaluate(() => window.__speculum.getState().counts);
await page.getByTestId("box-obj-support").click();
await page.getByRole("button", { name: /Delete from model/ }).click();
await page.getByRole("button", { name: /^Delete$/ }).click();
await page.waitForTimeout(1000);
const countsAfter = await page.evaluate(() => window.__speculum.getState().counts);
const statusAfter = await page.getByTestId("status-counts").textContent();
ok(
  "delete-from-model updates counts without reload",
  countsAfter.objects === countsBefore.objects - 1 &&
    countsAfter.links === countsBefore.links - 1 &&
    (statusAfter ?? "").includes(`${countsAfter.objects} objects`) &&
    (statusAfter ?? "").includes(`${countsAfter.links} links`),
  `before=${JSON.stringify(countsBefore)} after=${JSON.stringify(countsAfter)} status=${statusAfter}`,
);
await page.keyboard.press("Control+z");
await page.waitForTimeout(1000);
const countsUndone = await page.evaluate(() => window.__speculum.getState().counts);
const statusUndone = await page.getByTestId("status-counts").textContent();
ok(
  "undo restores counts",
  countsUndone.objects === countsBefore.objects &&
    countsUndone.links === countsBefore.links &&
    (statusUndone ?? "").includes(`${countsBefore.objects} objects`),
  `restored=${JSON.stringify(countsUndone)} status=${statusUndone}`,
);

// 8. light theme empty state shot
await page.goto(BASE + "?mock=fresh&theme=light", { waitUntil: "networkidle" });
await page.getByTestId("empty-add-system").waitFor({ timeout: 15000 });
await page.screenshot({ path: "screenshots/m4-empty-light.png" });
ok("light empty state renders", true);
await expectTheme(page, "m4-empty-light.png", "light");

ok("no console/page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close();
if (failed.length > 0) {
  console.log("FAILED: " + failed.join(", "));
  process.exit(1);
}
console.log("m4-check: ALL PASS");
