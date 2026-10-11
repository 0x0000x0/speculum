/**
 * Pure geometry for the M6 "specEdge" edge type (no React, no DOM).
 * Constants come from tokens/tokens.json (single source of truth).
 */
import rawTokens from "../../../../tokens/tokens.json";

export interface FlowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
}

export type Side = "top" | "right" | "bottom" | "left";

export interface Anchor extends Pt {
  side: Side;
}

interface EdgeTokens {
  cornerRadius: number;
  framePadding: number;
  frameHeader: number;
  portSize: number;
  fanStep: number;
  labelZoomThreshold: number;
  labelMaxWidth: number;
  stroke: number;
  strokeHi: number;
  arrowMin: number;
}

/** Tight-packing + tray constants (single source: tokens/tokens.json). */
export interface PackingTokens {
  boxS: number;
  boxWideW: number;
  boxWideH: number;
  cell: number;
  gap: number;
  gapLabelRow: number;
  framePad: number;
  frameHeader: number;
  ctxChild: number;
  ctxGap: number;
  ctxPad: number;
  ctxHeader: number;
  ctxTrayGap: number;
}

const T = (rawTokens as unknown as { edge: Record<string, number> }).edge;
const L = (
  rawTokens as unknown as {
    layout: Record<string, number>;
  }
).layout;
export const EDGE_TOKENS: EdgeTokens = {
  cornerRadius: T.cornerRadius ?? 8,
  framePadding: T.framePadding ?? 30,
  frameHeader: L.frameHeader ?? 72,
  portSize: T.portSize ?? 10,
  fanStep: T.fanStep ?? 24,
  labelZoomThreshold: T.labelZoomThreshold ?? 0.6,
  labelMaxWidth: T.labelMaxWidth ?? 140,
  stroke: T.stroke ?? 1.5,
  strokeHi: T.strokeHi ?? 2.5,
  arrowMin: T.arrowMin ?? 8,
};

/** Packing constants shared with the Rust layout crate (no magic numbers). */
export const PACKING: PackingTokens = {
  boxS: L.boxS ?? 120,
  boxWideW: L.boxWideW ?? 220,
  boxWideH: L.boxWideH ?? 110,
  cell: L.cell ?? 180,
  gap: L.gap ?? 60,
  gapLabelRow: L.gapLabelRow ?? 120,
  framePad: L.framePad ?? 30,
  frameHeader: L.frameHeader ?? 72,
  ctxChild: (L as Record<string, number>).ctxChildS ?? 96,
  ctxGap: (L as Record<string, number>).ctxGap ?? 24,
  ctxPad: (L as Record<string, number>).ctxPad ?? 20,
  ctxHeader: (L as Record<string, number>).ctxHeader ?? 44,
  ctxTrayGap: (L as Record<string, number>).ctxTrayGap ?? 60,
};

export function centerOf(r: FlowRect): Pt {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/**
 * Floating anchor: the point where the center-to-center line from `r`
 * toward `toward` crosses the border of `r`, clamped away from the
 * rounded corners (corner radius + 2px margin).
 */
export function anchorOnRect(r: FlowRect, toward: Pt): Anchor {
  const c = centerOf(r);
  let dx = toward.x - c.x;
  let dy = toward.y - c.y;
  if (dx === 0 && dy === 0) {
    dx = 1;
    dy = 0;
  }
  const tx = dx !== 0 ? r.w / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = dy !== 0 ? r.h / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);
  let x = c.x + dx * t;
  let y = c.y + dy * t;
  let side: Side;
  if (tx < ty) {
    side = dx > 0 ? "right" : "left";
    const margin = EDGE_TOKENS.cornerRadius + 2;
    y = Math.min(Math.max(y, r.y + margin), r.y + r.h - margin);
  } else {
    side = dy > 0 ? "bottom" : "top";
    const margin = EDGE_TOKENS.cornerRadius + 2;
    x = Math.min(Math.max(x, r.x + margin), r.x + r.w - margin);
  }
  return { x, y, side };
}

/**
 * Scope tray = bbox(children) + FRAME_PAD on the left/right/bottom and
 * FRAME_HEADER above the first row (title area). Shared with the Rust
 * layout crate's frame_rect (same constants, no duplicated numbers).
 */
export function frameRectOf(rects: FlowRect[]): FlowRect | null {
  if (rects.length === 0) return null;
  const pad = PACKING.framePad;
  const header = PACKING.frameHeader;
  const minX = Math.min(...rects.map((r) => r.x)) - pad;
  const minY = Math.min(...rects.map((r) => r.y)) - header;
  const maxX = Math.max(...rects.map((r) => r.x + r.w)) + pad;
  const maxY = Math.max(...rects.map((r) => r.y + r.h)) + pad;
  return {
    x: minX,
    y: minY,
    w: Math.max(maxX - minX, 40),
    h: Math.max(maxY - minY, 40),
  };
}

/**
 * Parent port: a small circle on the frame header line. Flow coords of
 * its center (matches the ScopeFrameNode CSS: left offset 24px, centered
 * on the top border).
 */
export function parentPortOf(frame: FlowRect): Pt {
  return { x: frame.x + 24 + EDGE_TOKENS.portSize / 2, y: frame.y };
}

/** One placed context-tray child (flow coords, deterministic). */
export interface CtxChildLayout {
  /** RF node id (`ctxc-<objectId>`). */
  id: string;
  objectId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One placed context tray: faint frame outside the main tray. */
export interface CtxTrayLayout {
  /** RF node id (`ctxt-<objectId>`). */
  id: string;
  objectId: string;
  side: string;
  x: number;
  y: number;
  w: number;
  h: number;
  children: CtxChildLayout[];
}

/**
 * Place faint neighbour trays outside the main tray (spec 4.6): "right"
 * trays stack in a column right of the frame, "left" trays left of it,
 * both starting at the frame top with a 60px gap. Deterministic in the
 * tray order given (the backend sorts by name, then id).
 */
export function layoutContextTrays(
  frame: FlowRect,
  trays: { objectId: string; side: string; children: { objectId: string }[] }[],
): CtxTrayLayout[] {
  const S = PACKING.ctxChild;
  const G = PACKING.ctxGap;
  const P = PACKING.ctxPad;
  const H = PACKING.ctxHeader;
  const TG = PACKING.ctxTrayGap;
  const out: CtxTrayLayout[] = [];
  const cursor = new Map<string, number>([["right", frame.y], ["left", frame.y]]);
  for (const t of trays) {
    const n = Math.max(t.children.length, 1);
    const cols = Math.min(4, Math.ceil(Math.sqrt(n)));
    const rows = Math.ceil(n / cols);
    const w = P * 2 + cols * S + (cols - 1) * G;
    const h = H + rows * S + (rows - 1) * G + P;
    const side = t.side === "left" ? "left" : "right";
    const x = side === "right" ? frame.x + frame.w + TG : frame.x - TG - w;
    const y = cursor.get(side) ?? frame.y;
    cursor.set(side, y + h + TG);
    out.push({
      id: `ctxt-${t.objectId}`,
      objectId: t.objectId,
      side,
      x,
      y,
      w,
      h,
      children: t.children.map((c, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        return {
          id: `ctxc-${c.objectId}`,
          objectId: c.objectId,
          x: x + P + col * (S + G),
          y: y + H + row * (S + G),
          w: S,
          h: S,
        };
      }),
    });
  }
  return out;
}

export function sideNormal(side: Side): Pt {
  switch (side) {
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
  }
}

function fmt(n: number): string {
  // Short stable numbers for SVG path data.
  return String(Math.round(n * 100) / 100);
}

export type LineShape = "curved" | "straight" | "square";

export interface PathGeom {
  d: string;
  /** Tangent (unit-ish) at the path end, for the arrowhead. */
  endTangent: Pt;
  /** Tangent at the path start, for bidirectional arrowheads. */
  startTangent: Pt;
  /** Point at fraction t (0..1) along the path, for labels/badges. */
  at: (t: number) => Pt;
}

function polylineAt(pts: Pt[], t: number): Pt {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return { ...pts[0] };
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    lens.push(l);
    total += l;
  }
  if (total <= 0) return { ...pts[0] };
  let target = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const f = lens[i] <= 0 ? 0 : target / lens[i];
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * f,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * f,
      };
    }
    target -= lens[i];
  }
  return { ...pts[pts.length - 1] };
}

function cubicAt(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
  };
}

function quadAt(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}

function norm(v: Pt): Pt {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

export function curvedGeom(p1: Pt, n1: Pt, p2: Pt, n2: Pt, fan: number): PathGeom {
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const k = Math.min(Math.max(dist * 0.35, 24), 120);
  // Perpendicular fan shift on the control points (symmetric fan-out).
  const mx = p2.x - p1.x;
  const my = p2.y - p1.y;
  const len = Math.hypot(mx, my) || 1;
  const px = -my / len;
  const py = mx / len;
  const c1 = { x: p1.x + n1.x * k + px * fan, y: p1.y + n1.y * k + py * fan };
  const c2 = { x: p2.x + n2.x * k + px * fan, y: p2.y + n2.y * k + py * fan };
  const d = `M ${fmt(p1.x)} ${fmt(p1.y)} C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(p2.x)} ${fmt(p2.y)}`;
  return {
    d,
    endTangent: norm({ x: p2.x - c2.x, y: p2.y - c2.y }),
    startTangent: norm({ x: c1.x - p1.x, y: c1.y - p1.y }),
    at: (t: number) => cubicAt(p1, c1, c2, p2, Math.min(Math.max(t, 0), 1)),
  };
}

export function straightGeom(p1: Pt, p2: Pt, fan: number): PathGeom {
  if (fan === 0) {
    const pts = [p1, p2];
    return {
      d: `M ${fmt(p1.x)} ${fmt(p1.y)} L ${fmt(p2.x)} ${fmt(p2.y)}`,
      endTangent: norm({ x: p2.x - p1.x, y: p2.y - p1.y }),
      startTangent: norm({ x: p2.x - p1.x, y: p2.y - p1.y }),
      at: (t: number) => polylineAt(pts, t),
    };
  }
  // Bowed quadratic so parallel straights fan apart instead of overlapping.
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const c = { x: mx + (-dy / len) * fan * 2, y: my + (dx / len) * fan * 2 };
  return {
    d: `M ${fmt(p1.x)} ${fmt(p1.y)} Q ${fmt(c.x)} ${fmt(c.y)}, ${fmt(p2.x)} ${fmt(p2.y)}`,
    endTangent: norm({ x: p2.x - c.x, y: p2.y - c.y }),
    startTangent: norm({ x: c.x - p1.x, y: c.y - p1.y }),
    at: (t: number) => quadAt(p1, c, p2, Math.min(Math.max(t, 0), 1)),
  };
}

/** Orthogonal polyline with corner radius, from p1 to p2. */
export function squareGeom(
  p1: Pt,
  s1: Side,
  p2: Pt,
  s2: Side,
  fan: number,
): PathGeom {
  const r = Math.min(EDGE_TOKENS.cornerRadius, Math.abs(p2.x - p1.x) / 2, Math.abs(p2.y - p1.y) / 2);
  const horizontalFirst = s1 === "left" || s1 === "right";
  void s2;
  let pts: Pt[];
  if (horizontalFirst) {
    const midX = (p1.x + p2.x) / 2 + fan;
    pts = [
      p1,
      { x: midX, y: p1.y },
      { x: midX, y: p2.y },
      p2,
    ];
  } else {
    const midY = (p1.y + p2.y) / 2 + fan;
    pts = [
      p1,
      { x: p1.x, y: midY },
      { x: p2.x, y: midY },
      p2,
    ];
  }
  // Drop zero-length legs so short runs don't kink.
  const cleaned: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) > 0.5) cleaned.push(pts[i]);
  }
  if (cleaned.length < 2) {
    return straightGeom(p1, p2, 0);
  }
  let d = `M ${fmt(cleaned[0].x)} ${fmt(cleaned[0].y)}`;
  for (let i = 1; i < cleaned.length - 1; i++) {
    const prev = cleaned[i - 1];
    const cur = cleaned[i];
    const next = cleaned[i + 1];
    const v1 = norm({ x: cur.x - prev.x, y: cur.y - prev.y });
    const v2 = norm({ x: next.x - cur.x, y: next.y - cur.y });
    const a = { x: cur.x - v1.x * r, y: cur.y - v1.y * r };
    const b = { x: cur.x + v2.x * r, y: cur.y + v2.y * r };
    d += ` L ${fmt(a.x)} ${fmt(a.y)} Q ${fmt(cur.x)} ${fmt(cur.y)}, ${fmt(b.x)} ${fmt(b.y)}`;
  }
  const last = cleaned[cleaned.length - 1];
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  const before = cleaned[cleaned.length - 2];
  const spine = [...cleaned];
  return {
    d,
    endTangent: norm({ x: last.x - before.x, y: last.y - before.y }),
    startTangent: norm({ x: cleaned[1].x - cleaned[0].x, y: cleaned[1].y - cleaned[0].y }),
    at: (t: number) => polylineAt(spine, t),
  };
}

/** Polyline through explicit waypoints (M11b owns editing; M6 only draws). */
export function waypointGeom(p1: Pt, waypoints: Pt[], p2: Pt, shape: LineShape): PathGeom {
  const pts = [p1, ...waypoints, p2].filter(
    (p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > 0.5,
  );
  if (shape === "curved" && pts.length === 2) {
    const n = norm({ x: p2.x - p1.x, y: p2.y - p1.y });
    void n;
    return curvedGeom(p1, { x: 0, y: 0 }, p2, { x: 0, y: 0 }, 0);
  }
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${fmt(pts[i].x)} ${fmt(pts[i].y)}`;
  const a = pts[pts.length - 2] ?? p1;
  const b = pts[pts.length - 1];
  const spine = [...pts];
  return {
    d,
    endTangent: norm({ x: b.x - a.x, y: b.y - a.y }),
    startTangent: norm({ x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y }),
    at: (t: number) => polylineAt(spine, t),
  };
}

export interface EdgePathInput {
  shape: LineShape;
  p1: Pt;
  n1: Pt;
  s1: Side;
  p2: Pt;
  n2: Pt;
  s2: Side;
  fan: number;
  waypoints: Pt[];
}

export function edgePath(input: EdgePathInput): PathGeom {
  if (input.waypoints.length > 0) {
    return waypointGeom(input.p1, input.waypoints, input.p2, input.shape);
  }
  switch (input.shape) {
    case "straight":
      return straightGeom(input.p1, input.p2, input.fan);
    case "square":
      return squareGeom(input.p1, input.s1, input.p2, input.s2, input.fan);
    case "curved":
    default:
      return curvedGeom(input.p1, input.n1, input.p2, input.n2, input.fan);
  }
}

/** Symmetric fan offsets for n parallel links: e.g. n=2 -> [-12, +12]. */
export function fanOffsets(n: number): number[] {
  const step = EDGE_TOKENS.fanStep;
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push((k - (n - 1) / 2) * step);
  return out;
}

/** True when (x,y) is on the border of r within tol (and never inside). */
export function isOnBorder(r: FlowRect, x: number, y: number, tol: number): boolean {
  const dx = Math.min(Math.abs(x - r.x), Math.abs(x - (r.x + r.w)));
  const dy = Math.min(Math.abs(y - r.y), Math.abs(y - (r.y + r.h)));
  const insideX = x > r.x + tol && x < r.x + r.w - tol;
  const insideY = y > r.y + tol && y < r.y + r.h - tol;
  if (insideX && insideY) return false;
  const nearX = x >= r.x - tol && x <= r.x + r.w + tol;
  const nearY = y >= r.y - tol && y <= r.y + r.h + tol;
  if (!nearX || !nearY) return false;
  return Math.min(dx, dy) <= tol;
}

/**
 * Estimated label pill size in flow px (matches the pill CSS at 100%).
 * Labels shorten at 140px and wrap to at most 2 lines at the tighter
 * spacing, then nudge along the path clear of boxes (see
 * placeLabelAvoiding).
 */
export function estimateLabelSize(text: string): { w: number; h: number } {
  const max = EDGE_TOKENS.labelMaxWidth;
  const w = Math.min(Math.max(text.length * 6.8 + 24, 40), max);
  // Two-line (wrapped at max width) pills are ~36px tall in the real CSS
  // (2 x 11px/1.35 lines + padding + border); keep the estimate
  // conservative so avoidance never thinks a clipped box is clear.
  return { w, h: w >= max ? 36 : 24 };
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  pad: number,
): boolean {
  return (
    a.x - pad < b.x + b.w &&
    b.x - pad < a.x + a.w &&
    a.y - pad < b.y + b.h &&
    b.y - pad < a.y + a.h
  );
}

const LABEL_T_CANDIDATES = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.15, 0.85, 0.1, 0.9];

/** Perpendicular nudges (flow px) tried when sliding along the path finds
 *  no free spot (e.g. parallel fan edges whose middles run side by side).
 *  At the V1 tight packing a 60px horizontal gap is narrower than most
 *  pills, so short edges must lift clear above/below the 120px-tall boxes
 *  (60 half-height + 12 half-pill + 4 pad = 76 minimum); the extended tail
 *  reaches ±110 to clear even 140px-wide pills beside 120px-wide boxes. */
const LABEL_OFFSET_CANDIDATES = [0, 20, -20, 34, -34, 48, -48, 62, -62, 76, -76, 90, -90, 106, -106];

/**
 * Slide a label along its path to the first spot that overlaps no box
 * and no already-placed label; when every on-path slot is taken, nudge
 * perpendicular to the path. A manual labelPosition always wins.
 */
export function placeLabelAvoiding(
  at: (t: number) => Pt,
  text: string,
  manualT: number | null,
  boxes: FlowRect[],
  placed: { x: number; y: number; w: number; h: number }[],
): { t: number; x: number; y: number; w: number; h: number } {
  const size = estimateLabelSize(text);
  if (manualT != null) {
    const p = at(Math.min(Math.max(manualT, 0), 1));
    return { t: manualT, x: p.x, y: p.y, ...size };
  }
  const tangentAt = (t: number): Pt => {
    const a = at(Math.min(Math.max(t - 0.02, 0), 1));
    const b = at(Math.min(Math.max(t + 0.02, 0), 1));
    return norm({ x: b.x - a.x, y: b.y - a.y });
  };
  for (const t of LABEL_T_CANDIDATES) {
    const p = at(t);
    const tan = tangentAt(t);
    const n = { x: -tan.y, y: tan.x };
    for (const o of LABEL_OFFSET_CANDIDATES) {
      const x = p.x + n.x * o;
      const y = p.y + n.y * o;
      const r = { x: x - size.w / 2, y: y - size.h / 2, w: size.w, h: size.h };
      if (boxes.some((b) => rectsOverlap(r, b, 4))) continue;
      if (placed.some((l) => rectsOverlap(r, l, 2))) continue;
      return { t, x, y, ...size };
    }
  }
  const p = at(0.5);
  return { t: 0.5, x: p.x, y: p.y, ...size };
}
