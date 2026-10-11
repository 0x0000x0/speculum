import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "../theme/ThemeProvider";
import SpecBox, { KindGlyph, type SpecBoxData, type SpecBoxTag, type ZoomTier } from "./SpecBox";
import BreadcrumbCard from "./BreadcrumbCard";
import SpecEdge, { type SpecEdgeData } from "./SpecEdge";
import {
  EDGE_TOKENS,
  anchorOnRect,
  centerOf,
  edgePath,
  fanOffsets,
  frameRectOf,
  layoutContextTrays,
  parentPortOf,
  placeLabelAvoiding,
  sideNormal,
  type CtxTrayLayout,
  type FlowRect,
  type Pt,
} from "./edgeGeometry";
import { toTagColor } from "../components/TagPill";
import ConnectDialog from "./ConnectDialog";
import RepointDialog from "./RepointDialog";
import ToolPalette from "./ToolPalette";
import ZoomGroup from "./ZoomGroup";
import { isAddTool, kindOfAddTool, type ToolId } from "./tools";
import {
  KIND_LABELS,
  canContain,
  createBox,
  finishDrill,
  goBack,
  goForward,
  goToObjectDiagram,
  goUp,
  hideConnection,
  moveBoxes,
  prefersReducedMotion,
  redoModel,
  removeFromDiagram,
  renameObject,
  repointConnection,
  select,
  setConnectMode,
  setDebugCtxRects,
  setDebugFrameRect,
  setDebugHoverEdge,
  setDebugSelectedEdges,
  setDebugSublinks,
  setDebugZoom,
  setDrillPhase,
  setEdgeLabelPosition,
  setHover,
  setLiveViewport,
  setPendingLink,
  getSelection,
  setQuickAdd,
  setRenaming,
  setSelectedEdge,
  subscribeSelection,
  setTool,
  saveViewport,
  showToast,
  snap8,
  toggleShowAllLabels,
  undoModel,
  useModel,
  zoomInto,
  type CanvasToolId,
  type SublinkInfo,
} from "../model/store";
import type { ContextTray, DiagramView, ObjectKind, Rect, ScreenRect, SpecDocument } from "../model/types";
import { endpointBox } from "../model/endpoints";
import "./FlowCanvas.css";

function tagColor(raw: string): SpecBoxTag["color"] {
  return toTagColor(raw);
}

/**
 * Scope frame: a large labelled container behind all boxes (not a model box).
 * Boundary edges (touching the scope, i.e. `{frame:true}` endpoints) attach
 * to this node, so it exposes invisible source/target handles on every side
 * (React Flow skips edges whose endpoint node has no handles).
 */
function ScopeFrameNode({ data }: { data: { label: string; sub?: string; onConnectStart?: (e: React.MouseEvent) => void } }) {
  return (
    <div className="scope-frame" data-testid="scope-frame">
      <Handle type="target" position={Position.Top} id="frame-in-top" className="scope-frame__handle" aria-label="Frame input top" />
      <Handle type="target" position={Position.Left} id="frame-in-left" className="scope-frame__handle" aria-label="Frame input left" />
      <Handle type="target" position={Position.Bottom} id="frame-in-bottom" className="scope-frame__handle" aria-label="Frame input bottom" />
      <Handle type="target" position={Position.Right} id="frame-in-right" className="scope-frame__handle" aria-label="Frame input right" />
      <Handle type="source" position={Position.Top} id="frame-out-top" className="scope-frame__handle" aria-label="Frame output top" />
      <Handle type="source" position={Position.Bottom} id="frame-out-bottom" className="scope-frame__handle" aria-label="Frame output bottom" />
      <Handle type="source" position={Position.Left} id="frame-out-left" className="scope-frame__handle" aria-label="Frame output left" />
      <Handle type="source" position={Position.Right} id="frame-out-right" className="scope-frame__handle" aria-label="Frame output right" />
      <span className="scope-frame__label">{data.label}</span>
      {data.sub != null && data.sub !== "" && (
        <span className="scope-frame__sub" data-testid="scope-frame-sub">{data.sub}</span>
      )}
      {/* Parent port: 10px circle on the header line; drag from here to
          link the parent to a child, or drop here to link to the parent. */}
      <span
        className="scope-frame__port scope-frame__port--source nodrag"
        data-testid="parent-port"
        data-frame-port="true"
        title="Parent port: drag to a child to link the parent"
        onMouseDown={(e) => {
          e.stopPropagation();
          data.onConnectStart?.(e);
        }}
      />
    </div>
  );
}
const MemoScopeFrame = memo(ScopeFrameNode);

/**
 * Faint neighbour tray (spec 4.6): a sibling system with links into the
 * current scope. View-only: never saved, never draggable, pointer events
 * pass through except the label. Children are separate ctxChild nodes.
 */
function CtxTrayNode({ data }: { data: { label: string; sub?: string; objectId: string } }) {
  return (
    <div className="ctx-tray" data-testid={`ctx-tray-${data.objectId}`}>
      <span className="ctx-tray__label">{data.label}</span>
      {data.sub != null && data.sub !== "" && (
        <span className="ctx-tray__sub">{data.sub}</span>
      )}
    </div>
  );
}
const MemoCtxTray = memo(CtxTrayNode);

export interface CtxChildData extends Record<string, unknown> {
  objectId: string;
  kind: ObjectKind;
  name: string;
  kindLabel: string;
}

/** Small dimmed box inside a context tray; click navigates to its diagram. */
function CtxChildNode({ data }: { data: CtxChildData }) {
  return (
    <div
      className="ctx-child"
      data-testid={`ctx-child-${data.objectId}`}
      title={`Open ${data.name}`}
    >
      {/* Invisible edge anchors: React Flow only renders edges whose ends
          resolve to handles, so tray children expose one per side. */}
      <Handle type="target" position={Position.Top} id="in-top" className="spec-box__handle" aria-label="Input top" />
      <Handle type="target" position={Position.Left} id="in-left" className="spec-box__handle" aria-label="Input left" />
      <Handle type="target" position={Position.Bottom} id="in-bottom" className="spec-box__handle" aria-label="Input bottom" />
      <Handle type="target" position={Position.Right} id="in-right" className="spec-box__handle" aria-label="Input right" />
      <Handle type="source" position={Position.Top} id="out-top" className="spec-box__handle" aria-label="Output top" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="spec-box__handle" aria-label="Output bottom" />
      <Handle type="source" position={Position.Left} id="out-left" className="spec-box__handle" aria-label="Output left" />
      <Handle type="source" position={Position.Right} id="out-right" className="spec-box__handle" aria-label="Output right" />
      <span className="ctx-child__icon" aria-hidden="true">
        <KindGlyph kind={data.kind} size={22} />
      </span>
      <span className="ctx-child__title">{data.name}</span>
      <span className="ctx-child__kind">{data.kindLabel}</span>
    </div>
  );
}
const MemoCtxChild = memo(CtxChildNode);

/**
 * Perf-regime edge layer (mid/far tiers, >150 boxes): ALL edges as ONE
 * combined SVG path per style class instead of hundreds of edge
 * components. Lives in a single React Flow node at the content origin so
 * it pans/zooms with the canvas; pointer events pass through (edge
 * hover/click select stay available at near tier). Highlighted edges
 * (hover/selection) draw as one overlay path on top.
 */
export interface BatchGroup {
  cls: string;
  d: string;
  arrowD: string;
}
export interface BatchEdgesData extends Record<string, unknown> {
  groups: BatchGroup[];
  hi: BatchGroup[];
  ox: number;
  oy: number;
}
function BatchEdgesNode({ data }: { data: BatchEdgesData }) {
  return (
    <svg
      className="edge-batch"
      data-testid="edge-batch"
      width={1}
      height={1}
      aria-hidden="true"
    >
      <g transform={`translate(${-data.ox},${-data.oy})`}>
        {data.groups.map((g, i) => (
          <g key={i} className={g.cls}>
            {g.d !== "" && <path className="edge-batch__path" d={g.d} />}
            {g.arrowD !== "" && <path className="edge-batch__arrow" d={g.arrowD} />}
          </g>
        ))}
        {data.hi.map((g, i) => (
          <g key={`hi-${i}`} className={g.cls}>
            {g.d !== "" && <path className="edge-batch__path edge-batch__path--hi" d={g.d} />}
            {g.arrowD !== "" && <path className="edge-batch__arrow edge-batch__arrow--hi" d={g.arrowD} />}
          </g>
        ))}
      </g>
    </svg>
  );
}
const MemoBatchEdges = memo(BatchEdgesNode);
type BatchNodeType = FlowNode<BatchEdgesData, "batchEdges">;

const nodeTypes = { specBox: SpecBox, scopeFrame: MemoScopeFrame, ctxTray: MemoCtxTray, ctxChild: MemoCtxChild, batchEdges: MemoBatchEdges };
const edgeTypes = { specEdge: SpecEdge };

/** Live drag preview: a dashed line with an arrowhead following the pointer. */
function ConnectPreview({ from, to }: { from: Pt; to: Pt }) {
  const instance = useReactFlow();
  let a = from;
  let b = to;
  try {
    a = instance.flowToScreenPosition(from);
    b = instance.flowToScreenPosition(to);
  } catch {
    /* canvas not ready */
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const s = 11;
  const p = (n: number) => String(Math.round(n * 100) / 100);
  const points = `${p(b.x)},${p(b.y)} ${p(b.x - ux * s - uy * s * 0.5)},${p(b.y - uy * s + ux * s * 0.5)} ${p(b.x - ux * s + uy * s * 0.5)},${p(b.y - uy * s - ux * s * 0.5)}`;
  return (
    <div className="connect-preview" data-testid="connect-preview" aria-hidden="true">
      <svg className="connect-preview__svg">
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="connect-preview__line" />
        <polygon points={points} className="connect-preview__arrow" data-arrow="preview" />
      </svg>
    </div>
  );
}

type SpecNode = FlowNode<SpecBoxData & { __boxId: string }, "specBox">;
type FrameNodeType = FlowNode<{ label: string; sub?: string; onConnectStart?: (e: React.MouseEvent) => void }, "scopeFrame">;
type CtxTrayNodeType = FlowNode<{ label: string; sub?: string; objectId: string }, "ctxTray">;
type CtxChildNodeType = FlowNode<CtxChildData, "ctxChild">;
type AnyNode = SpecNode | FrameNodeType | CtxTrayNodeType | CtxChildNodeType;

/**
 * Tray subtitle: "<Kind> | <caption>" in mono 11px (spec 4.2). The caption
 * comes from the full document (the scope object itself is never a box on
 * its own diagram, so the view DTO does not carry it).
 */
function scopeSub(
  doc: { model: { objects: Record<string, { caption?: string } | undefined> } },
  scope: { id: string; kind: ObjectKind },
): string {
  const kind = KIND_LABELS[scope.kind] ?? scope.kind;
  const caption = doc.model.objects[scope.id]?.caption ?? "";
  return caption !== "" ? `${kind} | ${caption}` : kind;
}

function tierOf(zoom: number): ZoomTier {
  if (zoom < 0.25) return "far";
  if (zoom < 0.45) return "mid";
  return "near";
}

/**
 * Tier-quantized zoom for edge presentation (arrowheads, label rules):
 * geometry memos key on the tier, so wheel ticks within a tier never
 * recompute edge geometry — zoom only re-renders on a tier change.
 */
function tierZoomOf(tier: ZoomTier): number {
  return tier === "far" ? 0.15 : tier === "mid" ? 0.35 : 1;
}

/** Cheap rolling hash over persisted boxes (drill-return cache key). */
function boxesHashOf(boxes: Record<string, Rect>): string {
  let h1 = 0;
  let h2 = 0;
  let n = 0;
  for (const id of Object.keys(boxes).sort()) {
    const r = boxes[id];
    n += 1;
    const s = `${id}:${r.x},${r.y},${r.w},${r.h};`;
    for (let i = 0; i < s.length; i++) {
      h1 = (h1 * 31 + s.charCodeAt(i)) | 0;
      h2 = (h2 * 17 + s.charCodeAt(i) * (i + 1)) | 0;
    }
  }
  return `${n}:${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/** Above this many boxes the canvas switches to the perf regime
 *  (lite boxes, batched edges, no per-frame transitions). */
const PERF_REGIME_NODES = 150;

// SPEED part 3: the kept-level LRU co-mounted 500 hidden nodes during
// every drill (hideKeptNodes allocated 500 new objects + React reconciled
// ~1000 nodes). Measured: drill 350ms / 2994 box renders / 200ms longest
// frame. Dropping the LRU restores single-level DOM; drill-back remounts
// from the node/edge caches (part 1: ~230ms).

/**
 * Fit framing for a set of persisted rects in a cw×ch container (~20%
 * margin, capped at 1.25): the same framing as the layout-effect sync fit,
 * usable BEFORE first render so the mount lands in the final LOD tier.
 */
function fitViewportFor(
  rects: Rect[],
  cw: number,
  ch: number,
): { x: number; y: number; zoom: number } | null {
  if (rects.length === 0 || cw <= 0 || ch <= 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    if (r.x < x0) x0 = r.x;
    if (r.y < y0) y0 = r.y;
    if (r.x + r.w > x1) x1 = r.x + r.w;
    if (r.y + r.h > y1) y1 = r.y + r.h;
  }
  const bw = Math.max(x1 - x0, 1);
  const bh = Math.max(y1 - y0, 1);
  const z = Math.min(
    Math.max(Math.min((cw * 0.8) / bw, (ch * 0.8) / bh), 0.1),
    1.25,
  );
  const cx = x0 + bw / 2;
  const cy = y0 + bh / 2;
  return { x: cw / 2 - cx * z, y: ch / 2 - cy * z, zoom: z };
}

/** Quantized zoom for geometry memos: edge/node rebuilds only run when the
 *  bucket changes, so pan frames and fractional wheel deltas never recompute
 *  edge geometry. */
function zoomBucketOf(zoom: number): number {
  return Math.round(zoom * 20) / 20;
}

/** Persisted-box plan for the faint neighbour trays (spec 4.6). */
function ctxPlanFor(
  boxes: Record<string, Rect>,
  trays: ContextTray[],
): CtxTrayLayout[] {
  const rects = Object.values(boxes);
  if (rects.length === 0 || trays.length === 0) return [];
  const frame = frameRectOf(rects);
  if (frame == null) return [];
  return layoutContextTrays(
    frame,
    trays.map((t) => ({
      objectId: t.objectId,
      side: t.side,
      children: t.children.map((c) => ({ objectId: c.objectId })),
    })),
  );
}

/** Append faint tray frames + dimmed children (view-only, never saved). */
function appendCtxNodes(
  out: AnyNode[],
  v: DiagramView,
  doc: SpecDocument,
): void {
  const trays = v.contextTrays ?? [];
  if (trays.length === 0) return;
  const byId = new Map(trays.map((t) => [t.objectId, t]));
  for (const t of ctxPlanFor(v.diagram.boxes, trays)) {
    const src = byId.get(t.objectId);
    const kindLabel = src ? (KIND_LABELS[src.kind] ?? src.kind) : "";
    out.push({
      id: t.id,
      type: "ctxTray",
      position: { x: t.x, y: t.y },
      style: { width: Math.max(t.w, 40), height: Math.max(t.h, 40) },
      className: "ctx-tray-node",
      data: {
        label: src?.name ?? "",
        sub: src && src.caption !== "" ? `${kindLabel} | ${src.caption}` : kindLabel,
        objectId: t.objectId,
      },
      selectable: false,
      draggable: false,
    });
    for (const c of t.children) {
      const obj = doc.model.objects[c.objectId];
      if (obj == null) continue;
      out.push({
        id: c.id,
        type: "ctxChild",
        position: { x: c.x, y: c.y },
        style: { width: Math.max(c.w, 40), height: Math.max(c.h, 40) },
        className: "ctx-child-node",
        data: {
          objectId: c.objectId,
          kind: obj.type,
          name: obj.name,
          kindLabel: KIND_LABELS[obj.type] ?? obj.type,
        },
        selectable: false,
        draggable: false,
      });
    }
  }
}

interface FlowCanvasProps {
  onZoom: (zoom: number) => void;
}

function FlowCanvasInner({ onZoom }: FlowCanvasProps) {
  const { resolved } = useTheme();
  const model = useModel();
  const { view, diagramId, selection, hover, renamingId, error, status } = model;
  const instance = useReactFlow();
  const [zoom, setZoom] = useState(1);
  // Diagram the zoom state was seeded for (render-phase seeding below).
  const [zoomSeedId, setZoomSeedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const draggingRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const cursorFlow = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;
  const drill = model.drill;
  const drillRef = useRef(drill);
  drillRef.current = drill;
  // Box kept full-strength while the camera zooms (others fade, spec 4.7).
  // "__frame__" keeps the tray on drill-up (exact reverse).
  const [zoomKeep, setZoomKeep] = useState<string | null>(null);
  // Swap/settle bookkeeping for the drill camera (flow coords + viewports).
  const swapRef = useRef<{
    dir: "in" | "up";
    boxFlow: FlowRect | null;
    frameFlow: FlowRect | null;
  } | null>(null);
  // True while a programmatic camera move runs (its onMove is not input).
  const programmaticRef = useRef(false);
  const progTimer = useRef<number | null>(null);
  // Guards the drill-start zoom so the store's double set (zoomInto +
  // navigateTo) runs the camera once per navigation.
  const zoomGuardRef = useRef<{ key: string; at: number } | null>(null);
  // True once the swap preset ran (settle/done timers own the rest; the
  // store clearing `drill` must not cancel them).
  const swappedRef = useRef(false);
  const drillTimers = useRef<number[]>([]);
  // Latest live viewport per diagram is mirrored here every move; while a
  // drill animation runs, camera moves must not persist (no layout writes).
  const animatingRef = useRef(model.animating);
  animatingRef.current = model.animating;
  const tool: CanvasToolId = model.tool;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  // Space-held temporary pan: the tool to return to on keyup.
  const spacePrevRef = useRef<CanvasToolId | null>(null);
  // Ghost placement cursor (screen px relative to the canvas container).
  const [ghost, setGhost] = useState<{ kind: string; x: number; y: number } | null>(null);

  const tier = tierOf(zoom);
  // Quantized zoom: geometry memos key on the TIER, so fractional wheel
  // deltas and pan frames never recompute edge geometry. The bucket only
  // gates the parent zoom callback (cheap), never geometry.
  const zoomB = zoomBucketOf(zoom);
  const tierZoom = tierZoomOf(tier);
  // Perf regime (SPEED part 2): lite boxes + one combined edge path layer.
  const nodeCount = view == null ? 0 : Object.keys(view.diagram.boxes).length;
  const batchEdges = tier !== "near" && nodeCount > PERF_REGIME_NODES;
  // Deferred second paint: labels/badges/via pills and context trays are
  // not needed for the first frame; they join right after first paint so
  // open stays under budget. Reset on every diagram change.
  const [labelsReady, setLabelsReady] = useState(false);
  const [ctxReady, setCtxReady] = useState(false);
  useEffect(() => {
    setLabelsReady(false);
    setCtxReady(false);
    let t: number | null = null;
    const raf = requestAnimationFrame(() => {
      t = window.setTimeout(() => {
        setLabelsReady(true);
        setCtxReady(true);
      }, 20);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (t != null) window.clearTimeout(t);
    };
  }, [view?.diagram.id]);
  const ctxReadyRef = useRef(ctxReady);
  ctxReadyRef.current = ctxReady;
  // Mount once at the final viewport AND tier: the saved viewport — or,
  // for a fresh level, the fitted viewport computed from the persisted
  // rects BEFORE first render — seeds both React Flow's initial viewport
  // and the zoom state during render, so the first paint already mounts
  // the right LOD variant (no near-mode mount followed by a mid-mode
  // rebuild). The layout effect below still corrects to the measured
  // container; a seed in the right tier makes that correction free.
  if (view != null && zoomSeedId !== view.diagram.id) {
    setZoomSeedId(view.diagram.id);
    const saved = view.diagram.viewport;
    if (saved != null && saved.zoom > 0) {
      setZoom(saved.zoom);
    } else {
      try {
        const seed = fitViewportFor(
          Object.values(view.diagram.boxes),
          window.innerWidth - 380,
          window.innerHeight - 160,
        );
        if (seed != null) setZoom(seed.zoom);
      } catch {
        /* keep 1 */
      }
    }
  }
  const defaultViewport = useMemo(() => {
    const v = view;
    if (v == null) return undefined;
    const saved = v.diagram.viewport;
    if (saved != null && saved.zoom > 0) {
      return { x: saved.x, y: saved.y, zoom: saved.zoom };
    }
    try {
      const cw = window.innerWidth - 380;
      const ch = window.innerHeight - 160;
      return fitViewportFor(Object.values(v.diagram.boxes), cw, ch) ?? undefined;
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.diagram.id]);
  const lastZoomBucketRef = useRef(zoomB);
  // Latest programmatic viewport zoom, flushed to state when the camera
  // settles (see flushCameraZoom).
  const pendingZoomRef = useRef<number | null>(null);
  const flushCameraZoom = useCallback(() => {
    const z = pendingZoomRef.current;
    pendingZoomRef.current = null;
    if (z == null) return;
    setZoom(z);
    const b = zoomBucketOf(z);
    if (b !== lastZoomBucketRef.current) {
      lastZoomBucketRef.current = b;
      onZoomRef.current(z);
    }
  }, []);
  const edgeCacheRef = useRef(new Map<string, { sig: string; edge: FlowEdge }>());

  // ---- node building -------------------------------------------------------
  // All inputs are mirrored into refs so the builder never closes over
  // stale data (it runs from an effect keyed on a revision string).

  const docRef = useRef(model.doc);
  docRef.current = model.doc;
  const selRef = useRef(selection);
  selRef.current = selection;
  // Selection-only emits (select()) skip full-snapshot subscribers, so the
  // ref is also fed by the selection subscription (keyboard shortcuts and
  // node builds always see the live selection without re-rendering).
  useEffect(
    () =>
      subscribeSelection(() => {
        selRef.current = getSelection();
      }),
    [],
  );
  const renRef = useRef(renamingId);
  renRef.current = renamingId;
  const tierRef = useRef(tier);
  tierRef.current = tier;
  const connectRef = useRef(model.connectMode);
  connectRef.current = model.connectMode;
  const drillCbRef = useRef(
    (_boxId: string, _rect: ScreenRect | null): void => {},
  );
  const connectStartRef = useRef(
    (_boxId: string, _e: React.MouseEvent): void => {},
  );
  const frameConnectRef = useRef((_e: React.MouseEvent): void => {});

  // Stable node identity: per-id cache keyed on a cheap signature. Only
  // nodes whose data actually changed get new objects, so React.memo +
  // React Flow skip everything else (hover/selection never rebuild arrays).
  const nodeCacheRef = useRef(new Map<string, { sig: string; node: AnyNode }>());
  const buildNodes = useCallback((): AnyNode[] => {
    const v = viewRef.current;
    const doc = docRef.current;
    const sel = selRef.current;
    const ren = renRef.current;
    const tr = tierRef.current;
    const cm = connectRef.current;
    if (v == null) return [];
    const cache = nodeCacheRef.current;
    const seen = new Set<string>();
    const take = (id: string, sig: string, make: () => AnyNode): AnyNode => {
      seen.add(id);
      const hit = cache.get(id);
      if (hit != null && hit.sig === sig) return hit.node;
      const node = make();
      cache.set(id, { sig, node });
      return node;
    };
    const out: AnyNode[] = [];
    const ids = Object.keys(v.diagram.boxes).sort();
    // Scope frame: wraps all boxes + frame padding, behind everything.
    // (Geometry helper shared with the live-drag frame below.)
    const scope = v.scope ?? null;
    if (scope != null && ids.length > 0) {
      const rects = ids.map((id) => v.diagram.boxes[id]).filter((r) => r != null);
      const frame = frameRectOf(rects);
      if (frame != null) {
        const sub = scopeSub(docRef.current, scope);
        const fsig = `frame:${frame.x},${frame.y},${frame.w},${frame.h}:${scope.name}:${sub}`;
        out.push(
          take("__frame__", fsig, () => ({
            id: "__frame__",
            type: "scopeFrame",
            position: { x: frame.x, y: frame.y },
            style: {
              width: Math.max(frame.w, 40),
              height: Math.max(frame.h, 40),
            },
            // Behind boxes via DOM order (first node); pointer-events are
            // disabled on the wrapper (see .spec-frame-node) so only the
            // parent port stays clickable above the edge layer.
            className: "spec-frame-node",
            data: {
              label: scope.name,
              sub,
              onConnectStart: (e: React.MouseEvent) => frameConnectRef.current(e),
            },
            selectable: false,
            draggable: false,
          })),
        );
      }
    }
    const byId = new Map(v.objects.map((o) => [o.id, o]));
    for (const id of ids) {
      const r = v.diagram.boxes[id];
      const o = byId.get(id);
      if (!o) continue;
      const tags: SpecBoxTag[] = o.tagIds
        .map((tid) => doc.model.tags[tid])
        .filter((t) => t != null)
        .map((t) => ({ label: (t as { name: string }).name, color: tagColor((t as { color: string }).color) }));
      const kids = v.childCounts[id] ?? 0;
      const obj = doc.model.objects[id] as unknown as
        | { technologies?: string[]; description?: string }
        | undefined;
      const tagSig = tags.map((t) => `${t.label}=${t.color}`).join(";");
      const selected = sel.includes(id);
      const renaming = ren === id;
      const candidate = cm?.candidate === id;
      const tech = obj?.technologies?.[0] ?? "";
      const description = obj?.description ?? "";
      const zoomable = canContain(o.type) || kids > 0;
      const wide = r.w > 150;
      // Lite perf regime is decided per build (zoomed-out + many boxes);
      // it only changes the DOM weight, never the model content.
      const lite = tr !== "near" && ids.length > PERF_REGIME_NODES;
      // SPEED part 3: the lite DOM ignores the tier (single-element box in
      // both far and mid), so far<->mid wheel ticks must not invalidate the
      // cache: 500 identical re-renders per tick (~1500 box renders across
      // the perf-check zoom sweep). The LOD key is "lite" for both.
      const lodKey = lite ? "lite" : tr;
      const sig = [
        `${r.x},${r.y},${r.w},${r.h}`, o.type, o.name, o.caption,
        String(o.external), String(o.status), String(kids), lodKey,
        String(zoomable), String(wide), tech, description,
        selected ? "s1" : "s0", renaming ? "r1" : "r0",
        candidate ? "c1" : "c0", tagSig,
        lite ? "l1" : "l0",
      ].join("|");
      out.push(
        take(id, sig, () => ({
          id,
          type: "specBox",
          position: { x: r.x, y: r.y },
          style: { width: Math.max(r.w, 40), height: Math.max(r.h, 40) },
          zIndex: o.type === "group" ? -1 : undefined,
          selected,
          data: {
            __boxId: id,
            boxId: id,
            kind: o.type,
            name: o.name,
            caption: o.caption,
            tags,
            external: o.external,
            status: o.status,
            childCount: kids,
            tier: tr,
            lite,
            zoomable,
            wide,
            tech,
            description,
            // Stable by id: handlers resolve through refs, so a cached
            // node never closes over stale data.
            onDrill: (boxId: string, rect: ScreenRect | null) =>
              drillCbRef.current(boxId, rect),
            renaming,
            onRename: (name: string) => {
              void renameObject(id, name);
            },
            onCancelRename: () => setRenaming(null),
            candidate,
            onConnectStart: (boxId: string, e: React.MouseEvent) =>
              connectStartRef.current(boxId, e),
          },
        })),
      );
    }
    // Faint neighbour trays (spec 4.6): placed outside the main tray from
    // the PERSISTED boxes (stable mid-drag, like the frame node which the
    // canvas resizes imperatively during drags). Deferred to the second
    // paint (ctxReady) so open mounts boxes + edges first.
    const beforeCtx = out.length;
    if (ctxReadyRef.current) appendCtxNodes(out, v, doc);
    // Cache ctx/tray nodes by signature too (they are rebuilt wholesale by
    // appendCtxNodes; reuse identical objects across rebuilds).
    for (let i = beforeCtx; i < out.length; i++) {
      const n = out[i];
      const sig = `ctx:${n.id}:${n.position.x},${n.position.y}:${JSON.stringify(n.data)}`;
      const hit = cache.get(n.id);
      if (hit != null && hit.sig === sig) {
        out[i] = hit.node;
      } else {
        cache.set(n.id, { sig, node: n });
      }
      seen.add(n.id);
    }
    // Evict ids that left the diagram so the cache cannot grow stale.
    for (const key of [...cache.keys()]) {
      if (!seen.has(key)) cache.delete(key);
    }
    return out;
  }, []);

  const [baseNodes, setBaseNodes, onNodesChange] = useNodesState<AnyNode>([]);
  // Single-level DOM (SPEED part 3): no kept-level co-mount.
  const renderedDiagramRef = useRef<string | null>(null);
  // Hover intent: a 30ms settle so fast sweeps never commit per-box
  // highlight work (enter+leave during a sweep just replace the pending
  // value); dwelling hovers land 30ms later (checks wait 300ms+).
  const hoverTimer = useRef<number | null>(null);
  const queueHover = useCallback((id: string | null) => {
    if (hoverTimer.current != null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      setHover(id);
    }, 30);
  }, []);
  useEffect(
    () => () => {
      if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    },
    [],
  );
  // Drag positions coalesced to one state write per frame (a single
  // mousemove burst otherwise recomputes all edge geometry per event).
  const dragRaf = useRef<number | null>(null);
  const pendingDragPos = useRef<Record<string, { x: number; y: number }>>({});
  useEffect(
    () => () => {
      if (dragRaf.current != null) cancelAnimationFrame(dragRaf.current);
    },
    [],
  );

  // Live drag positions (flow coords) keyed by box id. Updated from every
  // position change so the scope frame + edges follow the drag each frame;
  // cleared on drop (the persisted MoveBoxes refresh takes over).
  const [dragPos, setDragPos] = useState<Record<string, { x: number; y: number }>>({});
  const handleNodesChange = useCallback(
    (changes: NodeChange<AnyNode>[]) => {
      onNodesChange(changes);
      let any = false;
      for (const ch of changes) {
        if (ch.type === "position" && ch.position != null) {
          pendingDragPos.current[ch.id] = { x: ch.position.x, y: ch.position.y };
          any = true;
        }
      }
      if (any && dragRaf.current == null) {
        dragRaf.current = requestAnimationFrame(() => {
          dragRaf.current = null;
          const pos = pendingDragPos.current;
          pendingDragPos.current = {};
          if (Object.keys(pos).length > 0) {
            setDragPos((prev) => ({ ...prev, ...pos }));
          }
        });
      }
    },
    [onNodesChange],
  );

  // Edge hover/selection are view-only state (never commands).
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  // Live label-slide drag { testId, connId, t } (one command on drop).
  const [labelDrag, setLabelDrag] = useState<{ testId: string; connId: string; t: number; t0: number } | null>(null);
  const showAllLabels = model.showAllLabels;

  // Live rects = persisted boxes overridden by in-flight drag positions.
  const liveRects = useMemo<Record<string, Rect>>(() => {
    const v = view;
    if (v == null) return {};
    const out: Record<string, Rect> = {};
    for (const [id, r] of Object.entries(v.diagram.boxes)) {
      const p = dragPos[id];
      out[id] = p ? { x: p.x, y: p.y, w: r.w, h: r.h } : { ...r };
    }
    return out;
  }, [view, dragPos]);

  // Live scope frame: bounding box of the LIVE rects + padding, recomputed
  // every render so it grows/shrinks while a box is dragged past its edge.
  const liveFrame = useMemo<FlowRect | null>(
    () => frameRectOf(Object.values(liveRects)),
    [liveRects],
  );
  const liveFrameRef = useRef<FlowRect | null>(null);
  liveFrameRef.current = liveFrame;
  const liveRectsRef = useRef<Record<string, Rect>>({});
  liveRectsRef.current = liveRects;

  // Mirror live frame + zoom + sublinks into the debug API for checks.
  // (No scope frame on unscoped diagrams, so the frame rect is null there.)
  // The frame NODE is resized imperatively (not via the nodes prop) so
  // React Flow's drag math never sees node churn mid-gesture.
  useEffect(() => {
    const fr = view?.scope != null ? liveFrame : null;
    setDebugFrameRect(fr);
    try {
      const host = canvasRef.current
        ?.querySelector('[data-testid="scope-frame"]')
        ?.closest(".react-flow__node") as HTMLElement | null;
      if (host != null) {
        if (fr != null) {
          host.style.width = `${Math.max(fr.w, 40)}px`;
          host.style.height = `${Math.max(fr.h, 40)}px`;
          host.style.transform = `translate(${fr.x}px, ${fr.y}px)`;
        } else {
          host.style.width = "";
          host.style.height = "";
          host.style.transform = "";
        }
      }
    } catch {
      /* measuring must never break the canvas */
    }
  }, [liveFrame, view?.scope]);
  useEffect(() => {
    setDebugZoom(zoom);
  }, [zoom]);
  useEffect(() => {
    setDebugHoverEdge(hoveredEdge);
  }, [hoveredEdge]);
  useEffect(() => {
    setDebugSelectedEdges(selectedEdges);
  }, [selectedEdges]);

  // Programmatic zoom for checks (instant, keeps the current center).
  useEffect(() => {
    const api = (window as unknown as Record<string, unknown>).__speculum as
      | Record<string, unknown>
      | undefined;
    if (api != null) {
      api["setZoom"] = (z: number) => {
        try {
          const vp = instance.getViewport();
          void instance.setViewport({ x: vp.x, y: vp.y, zoom: z });
        } catch {
          /* canvas not ready */
        }
      };
    }
    return () => {
      try {
        const a = (window as unknown as Record<string, unknown>).__speculum as
          | Record<string, unknown>
          | undefined;
        if (a != null) delete a["setZoom"];
      } catch {
        /* ignore */
      }
    };
  }, [instance]);

  // Rebuild from the view when the diagram or backend rev changes.
  // Skipped while a pointer is held: swapping the node DOM mid-gesture
  // breaks React Flow's drag math (multiplied drops). A held-press flush
  // on pointer-up applies whatever was skipped.
  const pointerDownRef = useRef(false);
  const ctxSig = view
    ? (view.contextTrays ?? [])
        .map((t) => `${t.objectId}[${t.children.map((c) => c.objectId).join(",")}]`)
        .join(";")
    : "";
  // NOTE: selection + edge selection are NOT part of the rebuild key:
  // they are applied as a cheap identity-preserving overlay (below) and
  // as direct DOM highlight, so select/hover never rebuild node/edge
  // arrays, never re-run layout, and never recompute edge geometry.
  // SPEED part 3: ctxReady is ignored when the level has no trays (perf
  // docs) so the deferred second paint does not rebuild 500 nodes twice.
  // The drill camera state is also excluded: the zoom-in beat runs on the
  // old level (DOM-direct fade, no rebuild) and the new level mounts once
  // from the view (including it rebuilt all 500 nodes before navigation).
  const hasCtxTrays = (view?.contextTrays?.length ?? 0) > 0;
  const viewKey = view
    ? `${view.diagram.id}:${model.rev}:${renamingId}:${tier}:${hasCtxTrays && ctxReady ? "ctx1" : "ctx0"}:${model.connectMode == null ? "" : `${model.connectMode.source ?? ""}>${model.connectMode.candidate ?? ""}`}:${ctxSig}`
    : "none";
  const lastKey = useRef("");
  const viewKeyRef = useRef(viewKey);
  viewKeyRef.current = viewKey;
  useEffect(() => {
    if (draggingRef.current || pointerDownRef.current) return;
    if (lastKey.current === viewKey) return;
    const incomingId = viewRef.current?.diagram.id ?? null;
    lastKey.current = viewKey;
    const prevId = renderedDiagramRef.current;
    const navigated = incomingId != null && prevId != null && incomingId !== prevId;
    if (navigated) {
      // View-only edge/box highlights belong to the old level.
      setSelectedEdges([]);
      setHoveredEdge(null);
      if (hoverTimer.current != null) {
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
      }
      setHover(null);
    }
    // Concurrent swap: the new level renders without blocking input or the
    // running camera animation. Single-level DOM: the old level unmounts
    // inside the animation window; drill-back remounts from caches.
    // SPEED part 3: skip the write when the build is ref-identical (wheel
    // tier crossings with a canonicalized LOD key): handing React Flow a
    // new array of identical refs still re-rendered ~130 boxes per tick.
    startTransition(() => {
      const built = buildNodes();
      setBaseNodes((prev) => {
        if (
          prev.length === built.length &&
          prev.every((n, i) => n === built[i])
        ) {
          return prev;
        }
        return built;
      });
      if (incomingId != null) renderedDiagramRef.current = incomingId;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);
  useEffect(() => {
    const dn = () => {
      pointerDownRef.current = true;
    };
    const up = () => {
      pointerDownRef.current = false;
      const key = viewKeyRef.current;
      if (lastKey.current !== key) {
        lastKey.current = key;
        startTransition(() => {
          setBaseNodes(buildNodes());
        });
      }
    };
    window.addEventListener("mousedown", dn, true);
    window.addEventListener("mouseup", up, true);
    return () => {
      window.removeEventListener("mousedown", dn, true);
      window.removeEventListener("mouseup", up, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selection overlay: applies the `selected` flag without rebuilding data
  // (identity-preserving map: only boxes whose flag actually flips get a new
  // object, so a select touches at most two nodes and never edge geometry).
  const selSig = selection.join(",");
  useEffect(() => {
    const wanted = new Set(selection);
    setBaseNodes((prev) => {
      let changed = false;
      const next = prev.map((n) => {
        if (n.type !== "specBox") return n;
        const want = wanted.has(n.id);
        if ((n.selected ?? false) === want) return n;
        changed = true;
        return { ...n, selected: want };
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selSig]);

  // ---- drill camera transition (spec 4.7) ------------------------------------
  // Replaces the cloned-box overlay: the camera zooms centred on the box
  // (setCenter, eased) while other boxes/links fade; the child view swaps
  // in with its viewport preset so the new frame's screen rect equals the
  // zoomed box's screen rect; the tray morphs box->tray, children fade+scale
  // in with stagger, then the view eases to fit (or the saved viewport).
  // Drill-up is the exact reverse. Reduced motion is a 120ms cross-fade.
  // The store's animating timer (200/200/120ms) is untouched so history,
  // keyboard and restore timing keep working; input is ignored while it
  // runs (see the --anim/--zooming CSS + the key guard below).

  const animating = model.animating;

  const runProgrammatic = useCallback(
    (ms: number) => {
      programmaticRef.current = true;
      if (progTimer.current != null) window.clearTimeout(progTimer.current);
      progTimer.current = window.setTimeout(() => {
        programmaticRef.current = false;
        progTimer.current = null;
      }, ms);
    },
    [],
  );

  const clearDrillTimers = useCallback(() => {
    for (const t of drillTimers.current) window.clearTimeout(t);
    drillTimers.current = [];
  }, []);

  /** User input cancels the running camera sequence (navigation stands). */
  const cancelDrillVisual = useCallback(() => {
    clearDrillTimers();
    swapRef.current = null;
    swappedRef.current = false;
    setZoomKeep(null);
    setDrillPhase("idle");
    try {
      canvasRef.current?.classList.remove("flow-canvas--swap");
      const kids = canvasRef.current?.querySelectorAll(".react-flow__node");
      kids?.forEach((el) => {
        (el as HTMLElement).style.animationDelay = "";
      });
    } catch {
      /* ignore */
    }
  }, [clearDrillTimers]);

  useEffect(() => () => {
    clearDrillTimers();
    if (progTimer.current != null) window.clearTimeout(progTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drill cleared before the swap (Esc / error during zoom): drop visual
  // state. After the swap the settle/done timers own the rest even though
  // the store clears `drill` at 200/200ms.
  useEffect(() => {
    if (drill == null && !swappedRef.current) {
      clearDrillTimers();
      swapRef.current = null;
      setZoomKeep(null);
      try {
        canvasRef.current?.classList.remove("flow-canvas--swap");
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill]);

  // Drill start: camera zoom on the CURRENT view + capture swap bookkeeping.
  useEffect(() => {
    if (!ready || drill == null || drill.reduced) return;
    const key = `${drill.dir}:${drill.boxId ?? ""}:${viewRef.current?.diagram.id ?? ""}`;
    const g = zoomGuardRef.current;
    if (g != null && g.key === key && Date.now() - g.at < 800) return;
    zoomGuardRef.current = { key, at: Date.now() };
    const c = canvasRef.current?.getBoundingClientRect();
    if (c == null || c.width <= 0 || c.height <= 0) return;
    try {
      const vp = instance.getViewport();
      if (drill.dir === "in" && drill.boxId != null) {
        const r = viewRef.current?.diagram.boxes[drill.boxId];
        if (r == null) return;
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const boxScreenW = Math.max(r.w * vp.zoom, 1);
        const target = Math.min(
          4,
          Math.max(vp.zoom * 1.2, vp.zoom * ((0.85 * c.width) / boxScreenW)),
        );
        swapRef.current = { dir: "in", boxFlow: { ...r }, frameFlow: null };
        setZoomKeep(drill.boxId);
        runProgrammatic(220);
        void instance.setCenter(cx, cy, { zoom: target, duration: 180 });
      } else if (drill.dir === "up") {
        const fr = liveFrameRef.current;
        if (fr == null) {
          swapRef.current = null;
          return;
        }
        const cx = fr.x + fr.w / 2;
        const cy = fr.y + fr.h / 2;
        swapRef.current = { dir: "up", boxFlow: null, frameFlow: { ...fr } };
        setZoomKeep("__frame__");
        runProgrammatic(180);
        void instance.setCenter(cx, cy, {
          zoom: Math.max(0.1, vp.zoom * 0.55),
          duration: 140,
        });
      }
    } catch {
      /* measuring must never break navigation */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, drill]);

  const onDrillBadge = useCallback(
    (boxId: string, screenRect: ScreenRect | null) => {
      // Synchronous fade on the click frame (before the backend round-trip):
      // the camera zoom effect follows on the drill state commit.
      try {
        canvasRef.current?.querySelectorAll(".react-flow__node").forEach((el) => {
          (el as HTMLElement).classList.toggle(
            "spec-node--drill-fade",
            (el as HTMLElement).getAttribute("data-id") !== boxId,
          );
        });
      } catch {
        /* fade must never break navigation */
      }
      const c = canvasRef.current?.getBoundingClientRect() ?? null;
      const rect =
        screenRect && c
          ? {
              x: screenRect.x - c.x,
              y: screenRect.y - c.y,
              w: screenRect.w,
              h: screenRect.h,
            }
          : null;
      void zoomInto(boxId, rect);
    },
    [],
  );
  drillCbRef.current = onDrillBadge;

  /**
   * Swap/settle for a drill navigation, called from the open-diagram layout
   * effect when a camera drill is in flight. Presets the viewport so the
   * new frame's screen rect equals the zoomed box's (in) or the old frame's
   * rect lands on the scope box (up), morphs the tray, staggers children
   * in, then eases to the saved viewport (or fit). Returns true when it ran.
   */
  const applyDrillSwap = useCallback((): boolean => {
    const d = drillRef.current;
    const swap = swapRef.current;
    const v = viewRef.current;
    if (d == null || d.reduced || swap == null || v == null) return false;
    if (swap.dir !== d.dir) return false;
    try {
      const vp1 = instance.getViewport();
      const rects = Object.values(v.diagram.boxes);
      if (d.dir === "in" && swap.boxFlow != null && rects.length > 0) {
        const F = frameRectOf(rects);
        if (F == null) return false;
        const b = swap.boxFlow;
        const z2 = vp1.zoom * (b.w / F.w);
        const bcx = (b.x + b.w / 2) * vp1.zoom + vp1.x;
        const bcy = (b.y + b.h / 2) * vp1.zoom + vp1.y;
        const v2 = {
          x: bcx - (F.x + F.w / 2) * z2,
          y: bcy - (F.y + F.h / 2) * z2,
          zoom: z2,
        };
        runProgrammatic(120);
        instance.setViewport(v2);
        // SPEED part 3: the preset zoom stays frozen (stashed, no render)
        // so the new level keeps the mount-seeded LOD tier through the
        // transient preset; it syncs once at done. setZoom here rebuilt all
        // 500 nodes mid-animation.
        pendingZoomRef.current = v2.zoom;
      } else if (d.dir === "up" && swap.frameFlow != null) {
        // Reverse: land the old frame's screen rect on the box we came
        // from (drill.boxId = the previous scope, boxed on the parent).
        const scopeId = v.scope?.id ?? v.diagram.scopeObjectId ?? null;
        const targetBox = d.boxId ?? scopeId;
        const B = targetBox != null ? v.diagram.boxes[targetBox] : undefined;
        if (B == null) return false;
        const f = swap.frameFlow;
        const z2 = vp1.zoom * (f.w / B.w);
        const fcx = (f.x + f.w / 2) * vp1.zoom + vp1.x;
        const fcy = (f.y + f.h / 2) * vp1.zoom + vp1.y;
        const v2 = {
          x: fcx - (B.x + B.w / 2) * z2,
          y: fcy - (B.y + B.h / 2) * z2,
          zoom: z2,
        };
        runProgrammatic(120);
        instance.setViewport(v2);
        // SPEED part 3: frozen like the drill-in preset above.
        pendingZoomRef.current = v2.zoom;
      } else {
        return false;
      }
    } catch {
      return false;
    }
    setZoomKeep(null);
    setDrillPhase(d.dir === "in" ? "in-swap" : "up-swap");
    swappedRef.current = true;
    // Tray morph (box look -> tray look) + children fade+scale with stagger.
    try {
      const root = canvasRef.current;
      root?.classList.add("flow-canvas--swap");
      const kids = root?.querySelectorAll(
        ".react-flow__node:not(.spec-frame-node)",
      );
      kids?.forEach((el, i) => {
        (el as HTMLElement).style.animationDelay = `${Math.min(i, 24) * 12}ms`;
      });
    } catch {
      /* measuring must never break the canvas */
    }
    clearDrillTimers();
    const c = canvasRef.current?.getBoundingClientRect();
    const cw = c?.width ?? 800;
    const ch = c?.height ?? 600;
    const settle = window.setTimeout(() => {
      try {
        const vv = viewRef.current;
        const saved = vv?.diagram.viewport;
        setDrillPhase(d.dir === "in" ? "in-settle" : "up-settle");
        // Frozen through the settle flight too: the camera is programmatic
        // (onMove stashes), so no per-frame geometry builds; one sync at
        // done lands the settled tier.
        runProgrammatic(280);
        if (saved && saved.zoom > 0) {
          const cx = (cw / 2 - saved.x) / saved.zoom;
          const cy = (ch / 2 - saved.y) / saved.zoom;
          void instance.setCenter(cx, cy, { zoom: saved.zoom, duration: 220 });
        } else {
          void instance.fitView({ padding: 0.2, maxZoom: 1.25, duration: 220 });
        }
      } catch {
        /* measuring must never break the canvas */
      }
    }, 190);
    const done = window.setTimeout(() => {
      try {
        canvasRef.current?.classList.remove("flow-canvas--swap");
        const kids = canvasRef.current?.querySelectorAll(".react-flow__node");
        kids?.forEach((el) => {
          (el as HTMLElement).style.animationDelay = "";
        });
      } catch {
        /* ignore */
      }
      swapRef.current = null;
      swappedRef.current = false;
      setDrillPhase("idle");
      // Final camera sync (frozen during the flight) + persist the settled
      // viewport (full fit incl. context trays) so a later plain revisit
      // restores it instead of the main-only auto-fit.
      flushCameraZoom();
      try {
        const vp = instance.getViewport();
        if (viewRef.current != null) {
          setLiveViewport(viewRef.current.diagram.id, { ...vp });
          queueViewportSave({ ...vp });
        }
      } catch {
        /* measuring must never break the canvas */
      }
    }, 480);
    drillTimers.current.push(settle, done);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- hover sets from real edges ------------------------------------------

  /**
   * Links from inside the scope to context-tray children (spec 4.6): one
   * end maps to a box (or the scope frame), the other lives in a tray
   * child's subtree. Connections already rendered as normal edges are
   * skipped (no duplicates).
   */
  interface CtxLink {
    connId: string;
    name: string;
    direction: string;
    status: string;
    shape: "curved" | "straight" | "square";
    boxKey: string;
    ctxKey: string;
    /** Which end is the tray child ("from" when origin is outside). */
    ctxEnd: "from" | "to";
  }

  const ctxLinks = useMemo<CtxLink[]>(() => {
    const v = view;
    if (v == null) return [];
    const trays = v.contextTrays ?? [];
    if (trays.length === 0) return [];
    const doc = model.doc;
    const scopeId = v.scope?.id ?? v.diagram.scopeObjectId ?? null;
    // Tray child subtree membership: child id -> subtree set.
    const subOf = new Map<string, Set<string>>();
    for (const t of trays) {
      for (const c of t.children) {
        const seen = new Set<string>([c.objectId]);
        const stack = [c.objectId];
        while (stack.length > 0) {
          const cur = stack.pop()!;
          for (const o of Object.values(doc.model.objects)) {
            if ((o.parentId ?? null) === cur && !seen.has(o.id)) {
              seen.add(o.id);
              stack.push(o.id);
            }
          }
        }
        subOf.set(`ctxc-${c.objectId}`, seen);
      }
    }
    const resolveBox = (oid: string): string | null => {
      if (v.diagram.boxes[oid] != null) return oid;
      if (scopeId != null && oid === scopeId) return "__frame__";
      return null;
    };
    const resolveCtx = (oid: string): string | null => {
      for (const [key, sub] of subOf) {
        if (sub.has(oid)) return key;
      }
      return null;
    };
    // Connections already drawn as normal (possibly rolled-up) edges.
    const drawn = new Set<string>();
    for (const e of v.edges) {
      for (const cid of e.connectionIds) drawn.add(cid);
    }
    const out: CtxLink[] = [];
    const cids = Object.keys(doc.model.connections).sort();
    for (const cid of cids) {
      if (drawn.has(cid)) continue;
      const c = doc.model.connections[cid];
      const fb = resolveBox(c.originId);
      const tb = resolveBox(c.targetId);
      const fc = resolveCtx(c.originId);
      const tc = resolveCtx(c.targetId);
      if (fb != null && tc != null && fc == null) {
        out.push({
          connId: cid, name: c.name, direction: c.direction, status: c.status,
          shape: c.lineShape, boxKey: fb, ctxKey: tc, ctxEnd: "to",
        });
      } else if (tb != null && fc != null && tc == null) {
        out.push({
          connId: cid, name: c.name, direction: c.direction, status: c.status,
          shape: c.lineShape, boxKey: tb, ctxKey: fc, ctxEnd: "from",
        });
      }
    }
    return out;
  }, [view, model.doc]);

  /** Adjacency for hover/selection highlight incl. tray children + trays. */
  const ctxAdj = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    };
    for (const l of ctxLinks) link(l.boxKey, l.ctxKey);
    const v = view;
    if (v != null) {
      for (const t of v.contextTrays ?? []) {
        const trayKey = `ctxt-${t.objectId}`;
        for (const c of t.children) link(trayKey, `ctxc-${c.objectId}`);
      }
    }
    return adj;
  }, [ctxLinks, view]);

  const ctxNodeIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of view?.contextTrays ?? []) {
      s.add(`ctxt-${t.objectId}`);
      for (const c of t.children) s.add(`ctxc-${c.objectId}`);
    }
    return s;
  }, [view]);

  /** Persisted flow rects of tray children (edge geometry; stable mid-drag). */
  const ctxChildRects = useMemo<Record<string, FlowRect>>(() => {
    const out: Record<string, FlowRect> = {};
    if (view == null) return out;
    for (const t of ctxPlanFor(view.diagram.boxes, view.contextTrays ?? [])) {
      for (const c of t.children) out[c.id] = { x: c.x, y: c.y, w: c.w, h: c.h };
    }
    return out;
  }, [view]);

  useEffect(() => {
    setDebugCtxRects(ctxChildRects);
  }, [ctxChildRects]);
  const ctxRectsRef = useRef<Record<string, FlowRect>>({});
  ctxRectsRef.current = ctxChildRects;

  const focus = useMemo(() => {
    const v = view;
    if (v == null) return null;
    const hov = hover ?? ((): string | null => {
      try {
        return new URLSearchParams(window.location.search).get("hover");
      } catch {
        return null;
      }
    })();
    if (hov == null) return null;
    // Resolve to a boxed id, a context-tray node, or the scope frame.
    const hovered = v.diagram.boxes[hov] ? hov : ctxNodeIds.has(hov) ? hov : null;
    if (hovered == null) return null;
    const boxes = new Set<string>([hovered]);
    for (const rel of ctxAdj.get(hovered) ?? []) boxes.add(rel);
    const edgesIn = new Set<number>();
    const edgesOut = new Set<number>();
    v.edges.forEach((e, i) => {
      const f = endpointBox(e.from);
      const t = endpointBox(e.to);
      if (f !== hovered && t !== hovered) return;
      const other = f === hovered ? t : f;
      if (other) boxes.add(other);
      if (e.bidirectional) {
        edgesOut.add(i);
        edgesIn.add(i);
      } else {
        if (f === hovered) edgesOut.add(i);
        if (t === hovered) edgesIn.add(i);
      }
    });
    return { hovered, boxes, edgesIn, edgesOut };
  }, [view, hover, ctxAdj, ctxNodeIds]);

  // Hover/selection highlight is applied directly on the DOM (see the
  // highlight effect below), never through this array: hovering touches
  // only the affected elements and never re-renders nodes or edges.
  // SPEED part 3: the drill-target fade is DOM-direct too (see the
  // zoomKeep effect below). Mapping 500 nodes to append one class on every
  // drill beat cost ~500 re-renders + a long frame; the visual is identical.
  const nodes = useMemo<AnyNode[]>(
    () =>
      baseNodes.map((n) => {
        const cls = n.className ?? "";
        // Pan tool: boxes are not draggable (left-drag pans instead).
        const noDrag = tool === "pan" && n.type === "specBox" ? { draggable: false } : null;
        if (n.id === "__frame__") {
          return noDrag != null ? { ...n, ...(noDrag ?? {}) } : n;
        }
        if (n.type === "ctxChild") {
          const want = " spec-node--ctx";
          if (cls.includes("spec-node--ctx")) {
            return noDrag != null ? { ...n, ...(noDrag ?? {}) } : n;
          }
          return { ...n, className: cls + want, ...(noDrag ?? {}) };
        }
        if (n.type === "ctxTray") {
          return noDrag != null ? { ...n, ...(noDrag ?? {}) } : n;
        }
        if (noDrag != null) return { ...n, ...(noDrag ?? {}) };
        return n;
      }),
    [baseNodes, tool],
  );

  // Drill fade (spec 4.7): the camera keeps the drill target full-strength
  // while the rest fades. DOM-direct single pass (no React re-render); the
  // root .flow-canvas--zooming class (cheap parent render) fades the edges
  // via CSS, this pass fades the boxes. Synchronous with the zoomKeep state
  // commit, so the animation still starts on the click frame.
  useEffect(() => {
    const root = canvasRef.current;
    if (root == null) return;
    try {
      const els = root.querySelectorAll(".react-flow__node");
      if (zoomKeep == null) {
        els.forEach((el) => (el as HTMLElement).classList.remove("spec-node--drill-fade"));
        return;
      }
      els.forEach((el) => {
        const id = (el as HTMLElement).getAttribute("data-id");
        (el as HTMLElement).classList.toggle("spec-node--drill-fade", id !== zoomKeep);
      });
    } catch {
      /* fade must never break the canvas */
    }
  }, [zoomKeep, baseNodes]);

  // Direct-DOM hover/selection highlight lives after the edge memo (it
  // needs the sublink list); see HIGHLIGHT_EFFECT below.

  // ---- specEdge building (floating anchors, fan, via, status) ---------------
  //
  // Each grouped ViewEdge expands to one sub-link per connection when the
  // links run side by side (parallel fan), or a single rolled-up path when
  // the edge is lower. Geometry is computed from the LIVE rects so edges
  // track boxes mid-drag and arrowheads always touch box/frame borders.

  function arrowPoints(tip: Pt, tan: Pt, size: number): string {
    const bx = tip.x - tan.x * size;
    const by = tip.y - tan.y * size;
    const px = -tan.y * size * 0.45;
    const py = tan.x * size * 0.45;
    const f = (n: number) => String(Math.round(n * 100) / 100);
    return `${f(tip.x)},${f(tip.y)} ${f(bx + px)},${f(by + py)} ${f(bx - px)},${f(by - py)}`;
  }

  interface SubLink {
    edgeIndex: number;
    subIndex: number;
    testId: string;
    connId: string;
    connIds: string[];
    fromKey: string;
    toKey: string;
    lower: boolean;
    isFrame: boolean;
  }

  /** Selection-independent geometry for one sub-link (heavy part). */
  interface GeomItem {
    testId: string;
    edgeIndex: number;
    subIndex: number;
    connId: string;
    connIds: string[];
    fromKey: string;
    toKey: string;
    lower: boolean;
    isFrame: boolean;
    d: string;
    startArrow: string | null;
    endArrow: string | null;
    startArrowHi: string | null;
    endArrowHi: string | null;
    arrowD: string;
    arrowDHi: string;
    labelFull: SpecEdgeData["label"];
    badgeFull: SpecEdgeData["badge"];
    viaFull: SpecEdgeData["via"];
    tooltip: string;
    pathTestId: string;
    statusMods: string;
    coords: { x1: number; y1: number; x2: number; y2: number };
    arrowheads: number;
    parentPort: boolean;
    viaRouted: boolean;
    hx1: number;
    hy1: number;
    hx2: number;
    hy2: number;
    direction: string;
    status: string;
    lineShape: "curved" | "straight" | "square";
    viaId: string | null;
    labelPosition: number;
    labelVisibleNear: boolean;
  }

  /** Triangle point-list ("x,y x,y x,y") as a filled path. */
  function arrowPathOf(points: string): string {
    const p = points.split(" ");
    if (p.length !== 3) return "";
    return `M${p[0]}L${p[1]}L${p[2]}Z`;
  }

  // Drill LRU: geometry results keyed by content (diagram+rev+tier+mode),
  // so drilling back to a level swaps the cached arrays instead of
  // re-routing hundreds of edges. Capped small; evicted FIFO.
  const edgeGeomCacheRef = useRef(
    new Map<string, { items: GeomItem[]; infos: SublinkInfo[]; geoms: Map<string, { at: (t: number) => Pt }> }>(),
  );
  // Per-edge geometry cache: during box drags only incident edges recompute
  // (750 → a handful per frame); the rest reuse the previous item by ref,
  // so presentation and React skip them too. Epoch-busted on any content,
  // tier, mode or label-pass change.
  const perEdgeCacheRef = useRef(new Map<string, {
    item: GeomItem;
    info: SublinkInfo;
    geom: { at: (t: number) => Pt };
    labelRect: { x: number; y: number; w: number; h: number } | null;
  }>());
  const perEdgeEpochRef = useRef("");

  const { edgeGeom, sublinkInfos, geoms: edgeGeoms } = useMemo<{
    edgeGeom: GeomItem[];
    sublinkInfos: SublinkInfo[];
    geoms: Map<string, { at: (t: number) => Pt }>;
  }>(() => {
    const v = view;
    if (v == null) return { edgeGeom: [], sublinkInfos: [], geoms: new Map() };
    const batch = tier !== "near" && Object.keys(v.diagram.boxes).length > PERF_REGIME_NODES;
    const labelsOn = labelsReady && !batch;
    const dragN = Object.keys(dragPos).length;
    // In batch mode pills never render, so the labels pass must not bust
    // the drill cache (its flip would re-route all edges for nothing).
    const gkey = `${v.diagram.id}:${model.rev}:${tier}:${batch ? "b1" : "b0"}:${batch || !labelsReady ? "x" : "l1"}:${dragN === 0 ? "d0" : "d1"}:${boxesHashOf(v.diagram.boxes)}`;
    const cached = edgeGeomCacheRef.current.get(gkey);
    if (cached != null) {
      // Refresh recency.
      edgeGeomCacheRef.current.delete(gkey);
      edgeGeomCacheRef.current.set(gkey, cached);
      return { edgeGeom: cached.items, sublinkInfos: cached.infos, geoms: cached.geoms };
    }
    let markedGeom = false;
    try {
      performance.mark("speculum:geom-start");
      markedGeom = true;
    } catch {
      /* ignore */
    }
    const doc = model.doc;
    const scopeId = v.scope?.id ?? v.diagram.scopeObjectId ?? null;

    // Expand grouped edges into sub-links.
    const subs: SubLink[] = [];
    v.edges.forEach((e, i) => {
      const fromKey = endpointBox(e.from) ?? "__frame__";
      const toKey = endpointBox(e.to) ?? "__frame__";
      const isFrame = fromKey === "__frame__" || toKey === "__frame__";
      if (e.lower || e.connectionIds.length <= 1) {
        subs.push({
          edgeIndex: i,
          subIndex: 0,
          testId: `e-${i}`,
          connId: e.connectionIds[0] ?? "",
          connIds: [...e.connectionIds],
          fromKey,
          toKey,
          lower: e.lower,
          isFrame,
        });
      } else {
        e.connectionIds.forEach((cid, j) => {
          subs.push({
            edgeIndex: i,
            subIndex: j,
            testId: `e-${i}-${j}`,
            connId: cid,
            connIds: [...e.connectionIds],
            fromKey,
            toKey,
            lower: e.lower,
            isFrame,
          });
        });
      }
    });

    // Context-tray links (spec 4.6): exactly one end in a tray child.
    // Dedicated `ctxe-` ids keep the older `spec-e-` checks untouched.
    ctxLinks.forEach((l, k) => {
      subs.push({
        edgeIndex: -1,
        subIndex: k,
        testId: `ctxe-${k}`,
        connId: l.connId,
        connIds: [l.connId],
        fromKey: l.ctxEnd === "from" ? l.ctxKey : l.boxKey,
        toKey: l.ctxEnd === "from" ? l.boxKey : l.ctxKey,
        lower: false,
        isFrame: false,
      });
    });

    // Symmetric fan offsets per unordered pair (A->B and B->A fan together).
    const pairOf = (s: SubLink) =>
      [s.fromKey, s.toKey].sort().join("\n");
    const groups = new Map<string, SubLink[]>();
    for (const s of subs) {
      const k = pairOf(s);
      const g = groups.get(k);
      if (g) g.push(s);
      else groups.set(k, [s]);
    }
    const fanOf = new Map<string, number>();
    for (const g of groups.values()) {
      const offs = fanOffsets(g.length);
      const ordered = [...g].sort((a, b) =>
        a.edgeIndex === b.edgeIndex
          ? a.subIndex - b.subIndex
          : a.edgeIndex - b.edgeIndex,
      );
      ordered.forEach((s, k) => fanOf.set(s.testId, g.length > 1 ? offs[k] : 0));
    }

    const items: GeomItem[] = [];
    const infos: SublinkInfo[] = [];
    const geoms = new Map<string, { at: (t: number) => Pt }>();
    // Label collision avoidance: pills slide along their path clear of
    // boxes and earlier labels (manual labelPosition always wins).
    const boxRects = [...Object.values(liveRects), ...Object.values(ctxChildRects)];
    const placedLabels: { x: number; y: number; w: number; h: number }[] = [];
    for (const s of subs) {
      const conn =
        s.connId !== "" ? (doc.model.connections[s.connId] as unknown as
          | {
              name: string;
              direction: string;
              status: string;
              lineShape: string;
              labelPosition?: number | null;
              viaId?: string | null;
              originId: string;
              targetId: string;
            }
          | undefined) : undefined;
      const fromRect: FlowRect | null =
        s.fromKey === "__frame__"
          ? liveFrame
          : (liveRects[s.fromKey] ?? ctxChildRects[s.fromKey] ?? null);
      const toRect: FlowRect | null =
        s.toKey === "__frame__"
          ? liveFrame
          : (liveRects[s.toKey] ?? ctxChildRects[s.toKey] ?? null);
      if (fromRect == null || toRect == null) continue;

      // Per-edge cache key from every live input (endpoint rects, via and
      // frame rects, fan, manual/live label slots). A box drag changes only
      // its incident edges' keys; everything else reuses the cached item.
      const fanPre = fanOf.get(s.testId) ?? 0;
      const layoutPre =
        s.connId !== "" ? (v.diagram.connections[s.connId] as unknown as
          | { labelPosition?: number | null; waypoints?: { x: number; y: number }[] }
          | undefined) : undefined;
      const manualTPre = layoutPre?.labelPosition ?? conn?.labelPosition ?? null;
      const liveTPre = labelDrag?.testId === s.testId ? labelDrag.t : null;
      const viaRectPre = conn?.viaId != null ? (liveRects[conn.viaId] ?? null) : null;
      const rsigPre = (r: FlowRect | null) =>
        r == null ? "-" : `${r.x},${r.y},${r.w},${r.h}`;
      const frameSigPre =
        (s.fromKey === "__frame__" || s.toKey === "__frame__") && liveFrame != null
          ? rsigPre(liveFrame)
          : "-";
      // SPEED part 3: in batch mode pills never render, so the labels
      // pass must not bust the per-edge cache (its flip re-routed all 750
      // edges for an identical result: ~90ms build on every drill).
      const epochPre = `${v.diagram.id}:${model.rev}:${tier}:${batch ? "b1" : "b0"}:${batch ? "x" : labelsReady ? "l1" : "l0"}`;
      if (perEdgeEpochRef.current !== epochPre) {
        perEdgeEpochRef.current = epochPre;
        perEdgeCacheRef.current.clear();
      }
      const ekeyPre =
        `${s.testId}|${rsigPre(fromRect)}|${rsigPre(toRect)}|${viaRectPre ? rsigPre(viaRectPre) : "-"}|${frameSigPre}|${fanPre}|${manualTPre ?? ""}|${liveTPre ?? ""}`;
      const edgeHit = perEdgeCacheRef.current.get(ekeyPre);
      if (edgeHit != null) {
        items.push(edgeHit.item);
        infos.push(edgeHit.info);
        geoms.set(s.testId, edgeHit.geom);
        if (edgeHit.labelRect != null) placedLabels.push(edgeHit.labelRect);
        continue;
      }

      // Context-tray links never use the parent port (spec 4.6): the tray
      // child is not a model child, so both ends anchor on borders.
      const isCtx = s.edgeIndex === -1;
      // Parent->child links touch the scope object: anchor that end on the
      // small parent port on the frame header instead of the border.
      const port = liveFrame != null ? parentPortOf(liveFrame) : null;
      const fromIsParent =
        !isCtx &&
        s.fromKey === "__frame__" &&
        port != null &&
        conn != null &&
        scopeId != null &&
        conn.originId === scopeId;
      const toIsParent =
        !isCtx &&
        s.toKey === "__frame__" &&
        port != null &&
        conn != null &&
        scopeId != null &&
        conn.targetId === scopeId;

      const fromCenter = centerOf(fromRect);
      const toCenter = centerOf(toRect);
      let p1: Pt;
      let a1: { side: "top" | "right" | "bottom" | "left" };
      if (fromIsParent && port != null) {
        p1 = { ...port };
        a1 = { side: "top" as const };
      } else {
        const toward = toIsParent && port != null ? port : toCenter;
        const a = anchorOnRect(fromRect, toward);
        p1 = { x: a.x, y: a.y };
        a1 = a;
      }
      let p2: Pt;
      let a2: { side: "top" | "right" | "bottom" | "left" };
      if (toIsParent && port != null) {
        p2 = { ...port };
        a2 = { side: "top" as const };
      } else {
        const toward = fromIsParent && port != null ? port : fromCenter;
        const a = anchorOnRect(toRect, toward);
        p2 = { x: a.x, y: a.y };
        a2 = a;
      }

      const direction = conn?.direction ?? "outgoing";
      const status = conn?.status ?? "live";
      const shape = (conn?.lineShape ?? "curved") as "curved" | "straight" | "square";
      const fan = fanPre;
      const layout = layoutPre;
      const waypoints = (layout?.waypoints ?? []).map((w) => ({ x: w.x, y: w.y }));
      const manualT = manualTPre;

      // Via object: pill at the midpoint when not boxed; two segments
      // through the box (arrowhead only at the final target) when boxed.
      const viaId = conn?.viaId ?? null;
      const viaObj =
        viaId != null
          ? (doc.model.objects[viaId] as unknown as
              | { name: string; type: string }
              | undefined)
          : undefined;
      const viaRect = viaRectPre;
      const viaRouted = viaId != null && viaRect != null;

      // Parent-port links leave straight from the tray edge into the tray
      // (normal points down, inside) so they never loop outside the frame.
      const n1 = fromIsParent ? { x: 0, y: 1 } : sideNormal(a1.side);
      const n2 = toIsParent ? { x: 0, y: 1 } : sideNormal(a2.side);
      let geom = edgePath({
        shape,
        p1,
        n1,
        s1: a1.side,
        p2,
        n2,
        s2: a2.side,
        fan,
        waypoints,
      });
      if (viaRouted && viaRect != null) {
        const entry = anchorOnRect(viaRect, fromCenter);
        const exit = anchorOnRect(viaRect, toCenter);
        const g1 = edgePath({
          shape, p1, n1, s1: a1.side,
          p2: { x: entry.x, y: entry.y }, n2: sideNormal(entry.side), s2: entry.side,
          fan: 0, waypoints: [],
        });
        const g2 = edgePath({
          shape, p1: { x: exit.x, y: exit.y }, n1: sideNormal(exit.side), s1: exit.side,
          p2, n2, s2: a2.side,
          fan: 0, waypoints: [],
        });
        geom = {
          d: `${g1.d} ${g2.d}`,
          endTangent: g2.endTangent,
          startTangent: g1.startTangent,
          at: (t: number) => (t < 0.5 ? g1.at(t * 2) : g2.at((t - 0.5) * 2)),
        };
      }

      // Highlight (hover/selection/focus) is applied directly on the DOM
      // by the highlight effect; geometry here depends only on rects, the
      // edge set and the LOD tier — never on hover or selection, and wheel
      // ticks within a tier reuse the cached arrays.
      void isCtx;
      void showAllLabels;
      const strokeW = EDGE_TOKENS.stroke;
      const strokeWHi = EDGE_TOKENS.strokeHi;
      const arrowSize = Math.max(EDGE_TOKENS.arrowMin / Math.max(tierZoom, 0.05), 4 * strokeW);
      const arrowSizeHi = Math.max(EDGE_TOKENS.arrowMin / Math.max(tierZoom, 0.05), 4 * strokeWHi);
      const arrowheads = direction === "bidirectional" ? 2 : direction === "none" ? 0 : 1;

      const labelText =
        conn?.name ??
        (s.connIds.length > 1 ? `${s.connIds.length} links` : "");
      // Labels/badges/via pills join on the second paint (labelsReady) and
      // are skipped entirely in batch mode (mid/far perf regime renders one
      // combined path with no pills). Near-tier look is untouched.
      const wantPills = labelsOn && labelText !== "";
      // Live label-drag position wins while dragging; otherwise the manual
      // position wins, else the first collision-free slot along the path.
      const liveT = liveTPre;
      const placed =
        wantPills
          ? placeLabelAvoiding(
              geom.at,
              labelText,
              liveT ?? manualT,
              boxRects,
              placedLabels,
            )
          : null;
      if (placed != null) {
        placedLabels.push({ x: placed.x - placed.w / 2, y: placed.y - placed.h / 2, w: placed.w, h: placed.h });
      }
      const labelPos = placed?.t ?? 0.5;
      const labelPt = placed ?? geom.at(0.5);
      const midPt = geom.at(0.5);
      geoms.set(s.testId, geom);

      const names = s.connIds.map((cid) => doc.model.connections[cid]?.name ?? "");
      const tooltip =
        names.filter((n) => n !== "").join(", ") +
        (s.lower && s.connIds.length > 1 ? ` (${s.connIds.length} links)` : "");
      const showBadge = labelsOn && s.lower && s.connIds.length > 1 && s.subIndex === 0;
      const badgePt = showBadge ? geom.at(0.85) : null;

      let statusMods = "";
      if (status !== "live") statusMods += ` spec-edge--status-${status}`;
      if (s.lower) statusMods += " spec-edge--lower";

      const startPt = arrowheads === 2 ? arrowPoints(p1, { x: -geom.startTangent.x, y: -geom.startTangent.y }, arrowSize) : null;
      const endPt = arrowheads >= 1 ? arrowPoints(p2, geom.endTangent, arrowSize) : null;
      const startPtHi = arrowheads === 2 ? arrowPoints(p1, { x: -geom.startTangent.x, y: -geom.startTangent.y }, arrowSizeHi) : null;
      const endPtHi = arrowheads >= 1 ? arrowPoints(p2, geom.endTangent, arrowSizeHi) : null;
      items.push({
        testId: s.testId,
        edgeIndex: s.edgeIndex,
        subIndex: s.subIndex,
        connId: s.connId,
        connIds: [...s.connIds],
        fromKey: s.fromKey,
        toKey: s.toKey,
        lower: s.lower,
        isFrame: s.isFrame,
        d: geom.d,
        startArrow: startPt,
        endArrow: endPt,
        startArrowHi: startPtHi,
        endArrowHi: endPtHi,
        arrowD: `${startPt != null ? arrowPathOf(startPt) : ""}${endPt != null ? arrowPathOf(endPt) : ""}`,
        arrowDHi: `${startPtHi != null ? arrowPathOf(startPtHi) : ""}${endPtHi != null ? arrowPathOf(endPtHi) : ""}`,
        labelFull: placed != null
          ? {
              x: labelPt.x,
              y: labelPt.y,
              text: labelText,
              meta: s.lower && s.connIds.length > 1 ? "[rolled up]" : null,
              testId: "spec-edge-label",
            }
          : null,
        badgeFull: showBadge && badgePt
          ? {
              x: badgePt.x,
              y: badgePt.y,
              text: `${s.connIds.length}`,
              title: names.filter((n) => n !== "").join(", "),
              testId: "spec-edge-badge",
            }
          : null,
        viaFull:
          labelsOn && viaId != null && !viaRouted && viaObj != null
            ? {
                x: midPt.x,
                y: midPt.y,
                name: viaObj.name,
                kind: viaObj.type,
                testId: "via-pill",
              }
            : null,
        tooltip,
        pathTestId: isCtx
          ? `spec-ctx-edge-path-${s.subIndex}`
          : `spec-edge-path-${s.edgeIndex}${s.subIndex > 0 ? `-${s.subIndex}` : ""}`,
        statusMods,
        coords: { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y },
        arrowheads,
        parentPort: fromIsParent || toIsParent,
        viaRouted,
        hx1: p1.x + n1.x * 14,
        hy1: p1.y + n1.y * 14,
        hx2: p2.x + n2.x * 14,
        hy2: p2.y + n2.y * 14,
        direction,
        status,
        lineShape: shape,
        viaId,
        labelPosition: labelPos,
        labelVisibleNear: labelText !== "",
      });
      const info: SublinkInfo = {
        testId: `spec-${s.testId}`,
        edgeIndex: s.edgeIndex,
        subIndex: s.subIndex,
        connId: s.connId,
        connIds: [...s.connIds],
        name: conn?.name ?? "",
        direction,
        arrowheads,
        status,
        lineShape: shape,
        lower: s.lower,
        viaId,
        viaRouted,
        labelPosition: labelPos,
        fromKey: s.fromKey,
        toKey: s.toKey,
        parentPort: fromIsParent || toIsParent,
        // Visibility is decided per render (tier/labels/selection); the
        // geometry pass only reports whether the link carries a label.
        labelVisible: labelText !== "",
      };
      infos.push(info);
      perEdgeCacheRef.current.set(ekeyPre, {
        item: items[items.length - 1],
        info,
        geom,
        labelRect:
          placed != null
            ? { x: placed.x - placed.w / 2, y: placed.y - placed.h / 2, w: placed.w, h: placed.h }
            : null,
      });
    }
    const result = { items, infos, geoms };
    try {
      if (markedGeom) {
        performance.mark("speculum:geom-end");
        performance.measure("speculum:geom", "speculum:geom-start", "speculum:geom-end");
      }
    } catch {
      /* ignore */
    }
    edgeGeomCacheRef.current.set(gkey, result);
    if (edgeGeomCacheRef.current.size > 4) {
      const first = edgeGeomCacheRef.current.keys().next().value;
      if (first != null) edgeGeomCacheRef.current.delete(first);
    }
    return { edgeGeom: items, sublinkInfos: infos, geoms };
    // NOTE: selection/hover are presentation-only (next memo); geometry
    // keys on the tier so pan/zoom within a tier is zero React work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, model.doc, model.rev, liveRects, liveFrame, ctxLinks, ctxChildRects, tier, labelDrag, labelsReady, dragPos, batchEdges]);

  // Presentation: selection + label-threshold applied onto cached
  // geometry (cheap map, no re-routing). In batch mode React Flow gets no
  // per-edge components. Label visibility keys on the zoom bucket (not the
  // tier) so the 60% label rule stays exact; crossing buckets only rebuilds
  // objects whose visibility actually flips (stable cache refs otherwise),
  // so wheel ticks within a tier still cause zero box/edge re-renders.
  const edges = useMemo<FlowEdge[]>(() => {
    if (batchEdges) return [];
    const list: FlowEdge[] = [];
    for (const it of edgeGeom) {
      const selected = selectedEdges.includes(it.testId);
      const labelVisible =
        it.labelFull != null &&
        (tier !== "near"
          ? showAllLabels || selected
          : zoomB >= EDGE_TOKENS.labelZoomThreshold || showAllLabels || selected);
      let mods = it.statusMods;
      if (selected) mods += " spec-edge--hi spec-edge--hi-out spec-edge--selected";
      // Signature first: unchanged edges reuse the cached object without
      // allocating the presentation copies below (750 small allocs saved
      // on every select/hover-bucket pass).
      const startArrow = selected ? it.startArrowHi : it.startArrow;
      const endArrow = selected ? it.endArrowHi : it.endArrow;
      const edgeSig = [
        it.fromKey, it.toKey, it.d, startArrow ?? "", endArrow ?? "",
        labelVisible && it.labelFull ? `${it.labelFull.x},${it.labelFull.y}:${it.labelFull.text}:${it.labelFull.meta ?? ""}` : "-",
        it.badgeFull ? `${it.badgeFull.x},${it.badgeFull.y}:${it.badgeFull.text}` : "-",
        it.viaFull ? `${it.viaFull.x},${it.viaFull.y}:${it.viaFull.name}` : "-",
        it.tooltip, mods,
        `${it.coords.x1},${it.coords.y1},${it.coords.x2},${it.coords.y2}`,
        it.connIds.join(","), String(it.arrowheads),
        String(it.parentPort), String(it.viaRouted), String(selected),
        `${it.hx1},${it.hy1},${it.hx2},${it.hy2}`,
        it.lower ? "L" : "", it.isFrame ? "F" : "",
      ].join("|");
      const prevEdge = edgeCacheRef.current.get(it.testId);
      if (prevEdge != null && prevEdge.sig === edgeSig) {
        list.push(prevEdge.edge);
      } else {
        const data: SpecEdgeData = {
          d: it.d,
          startArrow,
          endArrow,
          label: labelVisible ? it.labelFull : null,
          badge: it.badgeFull,
          via: it.viaFull,
          tooltip: it.tooltip,
          testId: `spec-${it.testId}`,
          pathTestId: it.pathTestId,
          mods,
          coords: { ...it.coords },
          fromKey: it.fromKey,
          toKey: it.toKey,
          connIds: [...it.connIds],
          arrowheads: it.arrowheads,
          parentPort: it.parentPort,
          viaRouted: it.viaRouted,
          selected,
          hx1: it.hx1,
          hy1: it.hy1,
          hx2: it.hx2,
          hy2: it.hy2,
        };
        const built: FlowEdge = {
          id: it.testId,
          source: it.fromKey,
          target: it.toKey,
          type: "specEdge",
          data,
          selectable: true,
          selected,
          className:
            "flow-edge" +
            (selected ? " flow-edge--hi flow-edge--out" : "") +
            (it.lower ? " flow-edge--lower" : "") +
            (it.isFrame ? " flow-edge--frame" : ""),
        };
        edgeCacheRef.current.set(it.testId, { sig: edgeSig, edge: built });
        list.push(built);
      }
    }
    const order = (e: FlowEdge) => (e.className?.includes("flow-edge--hi") ? 1 : 0);
    list.sort((a, b) => order(a) - order(b));
    const live = new Set(list.map((e) => e.id));
    for (const key of [...edgeCacheRef.current.keys()]) {
      if (!live.has(key)) edgeCacheRef.current.delete(key);
    }
    return list;
  }, [edgeGeom, selectedEdges, showAllLabels, tier, zoomB, batchEdges]);
  const edgesMirror = useRef<FlowEdge[]>([]);
  edgesMirror.current = edges;

  // Highlighted sub-links (hover focus, edge hover, selection): drawn as
  // one overlay path above the combined layer in batch mode, and as the
  // edge part of the hover overlay layer in the perf-regime veil mode.
  const batchHi = useMemo(() => {
    const hot = focus?.boxes ?? null;
    const out = new Set<number>(focus?.edgesOut ?? []);
    const inn = new Set<number>(focus?.edgesIn ?? []);
    const hits: GeomItem[] = [];
    for (const it of edgeGeom) {
      if (selectedEdges.includes(it.testId) || hoveredEdge === it.testId) {
        hits.push(it);
        continue;
      }
      if (hot != null && (out.has(it.edgeIndex) || inn.has(it.edgeIndex))) {
        if (it.edgeIndex >= 0) {
          hits.push(it);
          continue;
        }
      }
      if (
        hot != null &&
        it.edgeIndex === -1 &&
        hot.has(it.fromKey) &&
        hot.has(it.toKey)
      ) {
        hits.push(it);
      }
    }
    return hits;
  }, [edgeGeom, focus, hoveredEdge, selectedEdges]);

  // Combined layer, split so hover/selection never rebuild the static
  // paths: base groups memo on geometry only; the highlight overlay (a few
  // edges) rebuilds alone. Without the split every hover re-concatenated
  // ~1MB of path strings and re-rendered the whole layer (~50ms).
  const batchGroups = useMemo<BatchGroup[]>(() => {
    if (!batchEdges) return [];
    const groups = new Map<string, BatchGroup>();
    for (const it of edgeGeom) {
      const cls = `edge-batch__group${it.statusMods}${it.lower ? " edge-batch__group--lower" : ""}`;
      let g = groups.get(cls);
      if (g == null) {
        g = { cls, d: "", arrowD: "" };
        groups.set(cls, g);
      }
      g.d += `${it.d} `;
      g.arrowD += it.arrowD;
    }
    return [...groups.values()];
  }, [batchEdges, edgeGeom]);

  const batchHiGroups = useMemo<BatchGroup[]>(() => {
    if (!batchEdges) return [];
    const g: BatchGroup = { cls: "edge-batch__group--hi", d: "", arrowD: "" };
    for (const it of batchHi) {
      g.d += `${it.d} `;
      g.arrowD += it.arrowDHi;
    }
    return g.d === "" && g.arrowD === "" ? [] : [g];
  }, [batchEdges, batchHi]);

  // The combined layer node: positioned over the content box so viewport
  // culling keeps it mounted exactly while any box is visible.
  const batchNode = useMemo<BatchNodeType | null>(() => {
    if (!batchEdges || view == null) return null;
    const rects = Object.values(liveRects);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const r of rects) {
      if (r.x < x0) x0 = r.x;
      if (r.y < y0) y0 = r.y;
      if (r.x + r.w > x1) x1 = r.x + r.w;
      if (r.y + r.h > y1) y1 = r.y + r.h;
    }
    if (!Number.isFinite(x0)) {
      x0 = 0;
      y0 = 0;
      x1 = 1;
      y1 = 1;
    }
    return {
      id: "__batchedges__",
      type: "batchEdges",
      position: { x: x0, y: y0 },
      style: { width: Math.max(x1 - x0, 1), height: Math.max(y1 - y0, 1) },
      className: "edge-batch-node",
      data: {
        groups: batchGroups,
        hi: batchHiGroups,
        ox: x0,
        oy: y0,
      },
      selectable: false,
      draggable: false,
    };
  }, [batchEdges, view, batchGroups, batchHiGroups, liveRects]);

  // VEIL HOVER (perf regime, >150 boxes): a single translucent layer dims
  // everything at once instead of toggling opacity on hundreds of elements
  // (in headless software rendering each toggle repaints the whole canvas);
  // the highlighted subset (hot boxes + hot links) renders into an overlay
  // layer above it. Same visual dim level (canvas bg at 75% reads as content
  // at 0.25 over the canvas). Small diagrams keep the per-element dim
  // classes the checks assert. The overlay follows the camera through a ref
  // (transform set imperatively), so pan/zoom during hover cost no renders.
  const veilOn = nodeCount > PERF_REGIME_NODES && (focus?.boxes ?? null) != null;
  const overlayRef = useRef<HTMLDivElement>(null);
  const overlayBoxes = useMemo(() => {
    if (!veilOn) return [];
    const hot = focus?.boxes;
    if (hot == null) return [];
    const byId = new Map(baseNodes.map((n) => [n.id, n]));
    const out: { id: string; x: number; y: number; w: number; h: number; data: SpecBoxData }[] = [];
    for (const id of hot) {
      const n = byId.get(id);
      if (n == null || n.type !== "specBox") continue;
      const d = n.data as unknown as SpecBoxData;
      const w = typeof n.style?.width === "number" ? n.style.width : 120;
      const h = typeof n.style?.height === "number" ? n.style.height : 120;
      out.push({ id, x: n.position.x, y: n.position.y, w, h, data: { ...d, bare: true } });
    }
    return out;
  }, [veilOn, focus, baseNodes]);
  const syncOverlayTransform = useCallback(() => {
    const el = overlayRef.current;
    if (el == null) return;
    try {
      const vp = instance.getViewport();
      el.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
    } catch {
      /* canvas not ready */
    }
  }, [instance]);
  useEffect(() => {
    if (veilOn) syncOverlayTransform();
  }, [veilOn, overlayBoxes, batchHi, syncOverlayTransform]);

  // Batch layer sorts right behind the boxes (after the scope frame).
  // Typed as AnyNode for the React Flow props (the runtime only needs
  // id/position/style/data; the batch node is never draggable/selectable).
  const rfNodes = useMemo<AnyNode[]>(() => {
    if (batchNode == null) return nodes;
    const at = nodes.length > 0 && nodes[0].id === "__frame__" ? 1 : 0;
    const out = nodes.slice();
    out.splice(at, 0, batchNode as unknown as AnyNode);
    return out;
  }, [nodes, batchNode]);
  const rfEdges = edges;

  const geomRef = useRef<Map<string, { at: (t: number) => Pt }>>(new Map());
  geomRef.current = edgeGeoms;
  const sublinkRef = useRef<SublinkInfo[]>([]);
  sublinkRef.current = sublinkInfos;

  useEffect(() => {
    setDebugSublinks(sublinkInfos);
  }, [sublinkInfos]);

  // HIGHLIGHT_EFFECT: direct-DOM hover/selection highlight. Toggles the
  // exact classes the checks assert (spec-node--dim, flow-edge--hi/in/out,
  // flow-edge--dim, spec-edge--hi/in/out, spec-node--ctx-hot): no node/edge
  // array rebuild, no layout, no edge re-routing, so hover/selection land
  // in the next painted frame. Single native pass over the node/edge
  // collections (no per-id querySelector: that cost ~150ms at 500 boxes);
  // in batch mode there is no per-edge DOM — the overlay path in the
  // batch node carries the highlight instead.
  useEffect(() => {
    const root = canvasRef.current;
    if (root == null) return;
    try {
      if (hover != null) root.setAttribute("data-hover-id", hover);
      else root.removeAttribute("data-hover-id");
      const hotBoxes = focus?.boxes ?? null;
      // Perf regime: the veil + overlay carry the highlight; touching
      // hundreds of elements is skipped (and none were dimmed on the way
      // in, so there is nothing to clean on the way out either).
      if (nodeCount > PERF_REGIME_NODES && hotBoxes != null) return;
      const nodeEls = root.querySelectorAll(".react-flow__node");
      nodeEls.forEach((el) => {
        if ((el as HTMLElement).classList.contains("kept-node")) return;
        const id = (el as HTMLElement).getAttribute("data-id");
        if (id == null || id === "__frame__" || id === "__batchedges__") return;
        const hot = hotBoxes == null ? true : hotBoxes.has(id);
        (el as HTMLElement).classList.toggle("spec-node--dim", !hot);
        if (id.startsWith("ctxc-") || id.startsWith("ctxt-")) {
          (el as HTMLElement).classList.toggle("spec-node--ctx-hot", hot && hotBoxes != null);
        }
      });
      if (batchEdges) return;
      const edgeOut = focus?.edgesOut ?? null;
      const edgeIn = focus?.edgesIn ?? null;
      const infos = sublinkRef.current;
      const wantEdgeHi = new Map<string, "out" | "in">();
      for (const s of infos) {
        const id = s.testId.replace(/^spec-/, "");
        const isOut = edgeOut?.has(s.edgeIndex) ?? false;
        const isIn = edgeIn?.has(s.edgeIndex) ?? false;
        const touchesCtx =
          s.edgeIndex === -1 &&
          hotBoxes != null &&
          hotBoxes.has(s.fromKey) &&
          hotBoxes.has(s.toKey);
        const hov = hoveredEdge === id;
        const sel = selectedEdges.includes(id);
        const hi = isOut || isIn || touchesCtx || hov || sel;
        if (hi) wantEdgeHi.set(id, isOut || hov || sel || !isIn ? "out" : "in");
      }
      const dimAll = hotBoxes != null;
      const edgeEls = root.querySelectorAll(".react-flow__edge");
      edgeEls.forEach((el) => {
        const id = (el as HTMLElement).getAttribute("data-id");
        if (id == null) return;
        const dir = wantEdgeHi.get(id) ?? null;
        const w = el as HTMLElement;
        w.classList.toggle("flow-edge--hi", dir != null);
        w.classList.toggle("flow-edge--out", dir === "out");
        w.classList.toggle("flow-edge--in", dir === "in");
        w.classList.toggle("flow-edge--dim", dir == null && dimAll);
        const g = w.querySelector("g.spec-edge");
        if (g != null) {
          g.classList.toggle("spec-edge--hi", dir != null);
          g.classList.toggle("spec-edge--hi-out", dir === "out");
          g.classList.toggle("spec-edge--hi-in", dir === "in");
        }
      });
    } catch {
      /* highlight must never break the canvas */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, hover, hoveredEdge, selectedEdges, rfNodes, rfEdges, batchEdges]);

  // ---- viewport restore / persist ------------------------------------------
  // The saved viewport is applied in a layout effect (before paint) so the
  // target view never pops at the end of a drill animation.

  // Restore the saved viewport (or fit) whenever a new diagram opens.
  // During a camera drill the swap preset runs instead (the tray morphs
  // from the zoomed box), then eases to the saved viewport or fit.
  const openedRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!ready || view == null) return;
    if (openedRef.current === view.diagram.id) return;
    openedRef.current = view.diagram.id;
    if (!applyDrillSwap()) {
      // No camera sequence (or it could not run): settle visual state so
      // the phase never sticks and input stays live. The reduced-motion
      // fade belongs to the store timer (120ms), not the canvas. Pending
      // timers of an older drill die here so their settle/done writes
      // (phases, viewport persists) can never land on the new level.
      clearDrillTimers();
      setZoomKeep(null);
      if (drillRef.current == null || !drillRef.current.reduced) setDrillPhase("idle");
    } else {
      return;
    }
    const vp = view.diagram.viewport;
    if (vp && vp.zoom > 0) {
      void instance.setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom });
      setLiveViewport(view.diagram.id, { x: vp.x, y: vp.y, zoom: vp.zoom });
      setZoom(vp.zoom);
      onZoom(vp.zoom);
    } else {
      // Fresh level: fit + centre the MAIN tray synchronously (before
      // paint, from the persisted rects). The mount already seeded this
      // framing, so this is usually a same-tier nudge (free).
      const c = canvasRef.current?.getBoundingClientRect();
      const rects: Rect[] = Object.values(view.diagram.boxes);
      if (c != null && c.width > 0 && c.height > 0 && rects.length > 0) {
        const fit = fitViewportFor(rects, c.width, c.height);
        if (fit == null) {
          void instance.fitView({ padding: 0.2, maxZoom: 1.25 });
          return;
        }
        const z = fit.zoom;
        void instance.setViewport(fit);
        setLiveViewport(view.diagram.id, { ...fit });
        setZoom(z);
        onZoom(z);
      } else {
        void instance.fitView({ padding: 0.2, maxZoom: 1.25 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, view?.diagram.id]);

  // A pending debounced save belongs to the previous diagram: cancel it on
  // navigation so a stale viewport can never overwrite the new view.
  useEffect(() => {
    if (saveTimer.current != null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, [view?.diagram.id]);

  const queueViewportSave = useCallback(
    (vp: { x: number; y: number; zoom: number }) => {
      // Camera moves during a drill never persist (no layout writes).
      if (animatingRef.current) return;
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        const id = viewRef.current?.diagram.id;
        if (id) void saveViewport(id, vp);
      }, 600);
    },
    [],
  );

  useEffect(
    () => () => {
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  // ---- Fit to screen (zoom group, Shift+1, Ctrl+0) ---------------------------
  // Zooms + pans so every box + the scope frame + neighbour trays fit with
  // 48px padding; ~200ms ease-out (instant under reduced motion); clamped
  // to 0.1..4; the resulting viewport is saved like any pan/zoom.
  const fitToScreen = useCallback(() => {
    const v = viewRef.current;
    const c = canvasRef.current?.getBoundingClientRect();
    if (v == null || c == null || c.width <= 0 || c.height <= 0) return;
    const rects: FlowRect[] = [...Object.values(liveRectsRef.current)];
    const fr = liveFrameRef.current;
    if (fr != null) rects.push({ ...fr });
    for (const r of Object.values(ctxRectsRef.current)) rects.push({ ...r });
    // Tray frames themselves (children bounds already cover most, but the
    // frame chrome adds a margin — include the plan boxes exactly).
    try {
      for (const t of ctxPlanFor(v.diagram.boxes, v.contextTrays ?? [])) {
        rects.push({ x: t.x, y: t.y, w: t.w, h: t.h });
      }
    } catch {
      /* measuring must never break fit */
    }
    if (rects.length === 0) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const r of rects) {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    const pad = 48;
    const bw = Math.max(x1 - x0, 1);
    const bh = Math.max(y1 - y0, 1);
    const reduced = prefersReducedMotion();
    const z = Math.min(Math.max(Math.min((c.width - pad * 2) / bw, (c.height - pad * 2) / bh), 0.1), 4);
    const cx = x0 + bw / 2;
    const cy = y0 + bh / 2;
    // SPEED part 3: no-op when already fitted (repeated Shift+1 / the
    // perf-check refit after a symmetric wheel sweep ran a full 200ms
    // camera flight + viewport save for an identical viewport).
    try {
      const cur = instance.getViewport();
      const tx = c.width / 2 - cx * z;
      const ty = c.height / 2 - cy * z;
      if (
        Math.abs(cur.zoom - z) < 0.005 &&
        Math.abs(cur.x - tx) < 2 &&
        Math.abs(cur.y - ty) < 2
      ) {
        return;
      }
    } catch {
      /* fall through to the flight */
    }
    try {
      runProgrammatic(reduced ? 60 : 300);
      if (reduced) {
        instance.setViewport({ x: c.width / 2 - cx * z, y: c.height / 2 - cy * z, zoom: z });
      } else {
        void instance.setCenter(cx, cy, { zoom: z, duration: 200 });
      }
      setZoom(z);
      onZoomRef.current(z);
      window.setTimeout(
        () => {
          flushCameraZoom();
          try {
            const vp = instance.getViewport();
            const id = viewRef.current?.diagram.id;
            if (id) {
              setLiveViewport(id, { ...vp });
              queueViewportSave({ ...vp });
            }
          } catch {
            /* ignore */
          }
        },
        reduced ? 60 : 300,
      );
    } catch {
      /* canvas not ready */
    }
  }, [instance, queueViewportSave, runProgrammatic]);

  // ---- drag: local during drag, ONE MoveBoxes on stop -----------------------

  const onNodeDragStart = useCallback(() => {
    draggingRef.current = true;
  }, []);

  const onNodeDragStop = useCallback(
    (e: MouseEvent | TouchEvent, _node: unknown, all: AnyNode[]) => {
      draggingRef.current = false;
      // Drop any coalesced-but-unflushed drag positions first: a pending
      // rAF flush firing after the drop would resurrect a stale offset and
      // corrupt the live rects (frame/undo checks caught this).
      if (dragRaf.current != null) {
        cancelAnimationFrame(dragRaf.current);
        dragRaf.current = null;
      }
      pendingDragPos.current = {};
      // Live positions are flushed into the persisted move below.
      setDragPos({});
      const v = viewRef.current;
      if (v == null) return;
      const alt =
        "altKey" in e && typeof e.altKey === "boolean" ? e.altKey : false;
      const moves: Record<string, { x: number; y: number; w: number; h: number }> = {};
      for (const n of all) {
        if (n.id === "__frame__") continue;
        const prev = v.diagram.boxes[n.id];
        if (!prev) continue;
        let { x, y } = n.position;
        if (!alt) {
          x = snap8(x);
          y = snap8(y);
        }
        if (x !== prev.x || y !== prev.y) {
          moves[n.id] = { x, y, w: prev.w, h: prev.h };
        }
      }
      if (Object.keys(moves).length > 0) {
        // Snap the local state too so boxes don't jump back before refresh.
        setBaseNodes((nds) =>
          nds.map((n) => {
            const m = moves[n.id];
            return m ? { ...n, position: { x: m.x, y: m.y } } : n;
          }),
        );
        void moveBoxes(v.diagram.id, moves);
      }
    },
    [setBaseNodes],
  );

  // ---- connect drag: dots / parent port -> box / frame / empty canvas -----
  // Dragging from a connection dot draws a live preview line (with
  // arrowhead). Dropping on a box/frame opens the inline name field
  // (Enter commits, Esc cancels; unnamed links are never saved).
  // Dropping on empty canvas opens quick-add; confirming there creates the
  // object + box + link as ONE undo step.

  interface DragLinkState {
    sourceKey: string;
    fromX: number;
    fromY: number;
    curX: number;
    curY: number;
    repoint?: { connId: string; end: "from" | "to" };
  }

  const [dragLink, setDragLink] = useState<DragLinkState | null>(null);  const [repointAsk, setRepointAsk] = useState<{
    connId: string;
    connName: string;
    end: "from" | "to";
    newKey: string;
    targetName: string;
    screenX: number;
    screenY: number;
  } | null>(null);
  const dragRef = useRef<DragLinkState | null>(null);
  dragRef.current = dragLink;
  const labelDragRef = useRef<{ testId: string; connId: string; t: number; t0: number } | null>(null);
  labelDragRef.current = labelDrag;

  const stripSpec = (t: string): string => (t.startsWith("spec-") ? t.slice(5) : t);

  const findSublink = useCallback((testId: string): SublinkInfo | undefined => {
    const full = testId.startsWith("spec-") ? testId : `spec-${testId}`;
    return sublinkRef.current.find((s) => s.testId === full);
  }, []);

  // Label pill drag: slide along the path; one command on drop.

  useEffect(() => {
    if (labelDrag == null) return;
    const onMove = (e: MouseEvent) => {
      const geom = geomRef.current.get(stripSpec(labelDrag.testId));
      if (!geom) return;
      const p = instance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      let best = 0.5;
      let bd = Number.POSITIVE_INFINITY;
      for (let i = 0; i <= 50; i++) {
        const t = i / 50;
        const q = geom.at(t);
        const dd = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y);
        if (dd < bd) {
          bd = dd;
          best = t;
        }
      }
      const tid = labelDrag.testId;
      setLabelDrag((d) => (d != null && d.testId === tid ? { ...d, t: best } : d));
    };
    const onUp = () => {
      const d = labelDragRef.current;
      setLabelDrag(null);
      const v = viewRef.current;
      // A plain click (no slide) selects without writing a command.
      // (Runs on window mouseup, after React Flow's own selection-clear,
      // so a pill click that lands off the halo still resolves.)
      if (d != null && v != null) {
        if (Math.abs(d.t - d.t0) > 0.005) {
          void setEdgeLabelPosition(v.diagram.id, d.connId, d.t);
        } else {
          const full = d.testId.startsWith("spec-") ? d.testId : `spec-${d.testId}`;
          const info = sublinkRef.current.find((s) => s.testId === full);
          if (info && info.connId !== "") {
            const rfId = full.startsWith("spec-") ? full.slice(5) : full;
            const payload = {
              connId: info.connId,
              connIds: [...info.connIds],
              lower: info.lower,
              fromKey: info.fromKey,
              toKey: info.toKey,
            };
            // Deferred past React Flow's click/selection-clear so the
            // pill click wins (mirrors the quick-add defer pattern).
            window.setTimeout(() => {
              setSelectedEdges([rfId]);
              setSelectedEdge(payload);
            }, 0);
          }
        }
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLabelDrag(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [labelDrag != null, instance]);

  // React Flow's screenToFlowPosition takes raw client coords (it
  // subtracts the container bounds itself): never pre-subtract here.
  const toFlow = useCallback(
    (clientX: number, clientY: number): Pt =>
      instance.screenToFlowPosition({ x: clientX, y: clientY }),
    [instance],
  );

  const startConnectDrag = useCallback(
    (sourceKey: string, e: React.MouseEvent) => {
      const p = toFlow(e.clientX, e.clientY);
      setDragLink({ sourceKey, fromX: p.x, fromY: p.y, curX: p.x, curY: p.y });
    },
    [toFlow],
  );
  connectStartRef.current = startConnectDrag;
  frameConnectRef.current = (e: React.MouseEvent) => startConnectDrag("__frame__", e);

  // Native capture fallback for the parent port: React Flow's pointer
  // handling can swallow the span's synthetic mousedown (the port sits
  // under edge paths), but the native event demonstrably reaches the
  // window. Capture on pointerdown AND mousedown (d3 starts its pan
  // gesture from the compat mousedown too) and stop propagation so RF
  // never starts a pan mid-gesture. A later double start via the span
  // handler is harmless (idempotent).
  useEffect(() => {
    const onDown = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-testid="parent-port"]') != null) {
        e.stopPropagation();
        startConnectDrag("__frame__", e as unknown as React.MouseEvent);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [startConnectDrag]);

  const startRepointDrag = useCallback(
    (testId: string, end: "from" | "to", e: React.MouseEvent) => {
      const info = sublinkRef.current.find(
        (s) => s.testId === testId || `spec-${s.testId}` === testId,
      );
      if (!info || info.connId === "") return;
      const p = toFlow(e.clientX, e.clientY);
      setDragLink({
        sourceKey: end === "from" ? info.toKey : info.fromKey,
        fromX: p.x,
        fromY: p.y,
        curX: p.x,
        curY: p.y,
        repoint: { connId: info.connId, end },
      });
    },
    [toFlow],
  );

  // Window-level move/up so the preview tracks + drops anywhere.
  const finishConnectDrag = useCallback(
    (e: MouseEvent) => {
      const d = dragRef.current;
      setDragLink(null);
      if (d == null) return;
      const v = viewRef.current;
      if (v == null) return;
      // Drop target: live-sampled during the moves when the pointer
      // actually traveled; a press-and-release without moves falls back
      // to a live query (hit-testing at mouseup time is unreliable).
      const moved = d.curX !== d.fromX || d.curY !== d.fromY;
      let id = "";
      let frame = false;
      if (moved) {
        id = dropTargetRef.current.boxId ?? "";
        frame = dropTargetRef.current.frame;
      } else {
        try {
          const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
          const boxEl = el?.closest?.('[data-testid^="box-"]:not([data-testid^="box-name-"])') as HTMLElement | null;
          if (boxEl != null) {
            const raw = boxEl.getAttribute("data-testid") ?? "";
            id = raw.startsWith("box-") ? raw.slice(4) : "";
          } else {
            frame =
              (el?.closest?.(
                '[data-testid="parent-port"],[data-testid="scope-frame"]',
              ) as HTMLElement | null) != null;
          }
        } catch {
          /* measuring must never break the gesture */
        }
      }
      const nameOf = (key: string): string =>
        key === "__frame__"
          ? (v.scope?.name ?? "Parent")
          : (docRef.current.model.objects[key]?.name ?? key);
      if (id !== "") {
        if (id === "__frame__") return;
        if (d.repoint) {
          if (id === d.sourceKey) return;
          const conn = docRef.current.model.connections[d.repoint.connId];
          setRepointAsk({
            connId: d.repoint.connId,
            connName: conn?.name ?? "link",
            end: d.repoint.end,
            newKey: id,
            targetName: nameOf(id),
            screenX: e.clientX,
            screenY: e.clientY,
          });
          return;
        }
        if (id === d.sourceKey) return;
        setPendingLink({ sourceKey: d.sourceKey, targetKey: id, screenX: e.clientX, screenY: e.clientY });
        return;
      }
      if (frame) {
        if (d.sourceKey === "__frame__") return;
        if (v.scope == null) return;
        if (d.repoint) {
          const conn = docRef.current.model.connections[d.repoint.connId];
          setRepointAsk({
            connId: d.repoint.connId,
            connName: conn?.name ?? "link",
            end: d.repoint.end,
            newKey: "__frame__",
            targetName: nameOf("__frame__"),
            screenX: e.clientX,
            screenY: e.clientY,
          });
          return;
        }
        setPendingLink({ sourceKey: d.sourceKey, targetKey: "__frame__", screenX: e.clientX, screenY: e.clientY });
        return;
      }
      // Frame body (pointer-events pass through it, so elementFromPoint
      // rarely reports it): a drop inside the live frame on a scoped
      // diagram targets the parent, per spec A.1. Outside the frame is
      // empty canvas. (Re-point drops on empty canvas just cancel.)
      {
        const f0 = toFlow(e.clientX, e.clientY);
        const fr = liveFrameRef.current;
        if (v.scope != null && fr != null && f0.x >= fr.x && f0.x <= fr.x + fr.w && f0.y >= fr.y && f0.y <= fr.y + fr.h) {
          if (d.sourceKey === "__frame__") return;
          if (d.repoint) {
            const conn = docRef.current.model.connections[d.repoint.connId];
            setRepointAsk({
              connId: d.repoint.connId,
              connName: conn?.name ?? "link",
              end: d.repoint.end,
              newKey: "__frame__",
              targetName: nameOf("__frame__"),
              screenX: e.clientX,
              screenY: e.clientY,
            });
            return;
          }
          setPendingLink({ sourceKey: d.sourceKey, targetKey: "__frame__", screenX: e.clientX, screenY: e.clientY });
          return;
        }
      }
      // Empty canvas: open quick-add; confirming creates the object + link
      // as one undo step. (Re-point drops on empty canvas just cancel.)
      // Deferred past the click event: React Flow fires a pane click on
      // the same press, which would instantly dismiss the popover.
      if (d.repoint) return;
      const f = toFlow(e.clientX, e.clientY);
      const sx = e.clientX;
      const sy = e.clientY;
      const src = d.sourceKey;
      window.setTimeout(() => {
        setQuickAdd({
          screenX: sx,
          screenY: sy,
          flowX: f.x,
          flowY: f.y,
          pendingLink: { sourceKey: src },
        });
      }, 0);
    },
    [toFlow],
  );

  // Drop target sampled live during the drag (button held): hit-testing
  // inside the mouseup dispatch itself is unreliable after a port-started
  // drag (the box under the cursor transiently misses), so the drop uses
  // the last sampled target instead of re-querying at mouseup time.
  const dropTargetRef = useRef<{ boxId: string | null; frame: boolean }>({
    boxId: null,
    frame: false,
  });

  function sampleDropTarget(clientX: number, clientY: number): void {
    let boxId: string | null = null;
    let frame = false;
    try {
      const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      const boxEl = el?.closest?.('[data-testid^="box-"]:not([data-testid^="box-name-"])') as HTMLElement | null;
      if (boxEl != null) {
        const raw = boxEl.getAttribute("data-testid") ?? "";
        boxId = raw.startsWith("box-") ? raw.slice(4) : null;
      } else {
        const frameEl = el?.closest?.(
          '[data-testid="parent-port"],[data-testid="scope-frame"]',
        ) as HTMLElement | null;
        frame = frameEl != null;
      }
    } catch {
      /* measuring must never break the gesture */
    }
    dropTargetRef.current = { boxId, frame };
  }

  useEffect(() => {
    if (dragLink == null) return;
    const onMove = (e: MouseEvent) => {
      const p = instance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      setDragLink((d) => (d == null ? d : { ...d, curX: p.x, curY: p.y }));
      sampleDropTarget(e.clientX, e.clientY);
    };
    const onUp = (e: MouseEvent) => {
      finishConnectDrag(e);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDragLink(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [dragLink != null, instance, finishConnectDrag]);

  // Canvas mousedown delegation: re-point handles + label pills.
  // (e) Robust link hit-testing at tight packing: a label/badge/via click
  // always selects its own link, and a halo/path/arrow click selects the
  // NEAREST path (sampled live geometry) instead of whatever the topmost
  // SVG element happens to be.
  const haloPickRef = useRef<{ id: string; t: number } | null>(null);
  const onCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const t = e.target as HTMLElement | null;
      // Connect tool: drag from anywhere on a box starts a link drag.
      if (toolRef.current === "connect") {
        const boxEl = t?.closest?.('[data-testid^="box-"]:not([data-testid^="box-name-"])') as HTMLElement | null;
        const inField =
          t?.closest?.("input, textarea, button, [data-testid^=\"conn-dot-\"], [data-testid^=\"drill-\"]") != null;
        if (boxEl != null && !inField) {
          const raw = boxEl.getAttribute("data-testid") ?? "";
          const id = raw.startsWith("box-") ? raw.slice(4) : "";
          // box-name testids also start with box-; strip the -name suffix form.
          const clean = id.startsWith("name-") ? "" : id;
          if (clean !== "" && viewRef.current?.diagram.boxes[clean] != null) {
            e.stopPropagation();
            e.preventDefault();
            startConnectDrag(clean, e);
            return;
          }
        }
      }
      const rep = t?.closest?.("[data-repoint]") as HTMLElement | null;
      if (rep != null) {
        e.stopPropagation();
        const end = rep.getAttribute("data-repoint") === "from" ? "from" : "to";
        startRepointDrag(rep.getAttribute("data-sub") ?? "", end, e);
        return;
      }
      const selectSublink = (rfId: string) => {
        setSelectedEdges([rfId]);
        const match = findSublink(rfId);
        if (match && match.connId !== "") {
          setSelectedEdge({
            connId: match.connId,
            connIds: [...match.connIds],
            lower: match.lower,
            fromKey: match.fromKey,
            toKey: match.toKey,
          });
        } else {
          setSelectedEdge(null);
        }
      };
      // Label/badge/via click always selects its own link first (the drag
      // arming below still runs for label slides).
      const pill = t?.closest?.(
        ".spec-edge__label, .spec-edge__badge, .spec-edge__via",
      ) as HTMLElement | null;
      if (pill != null) {
        const g = pill.closest?.("g[data-testid]") as HTMLElement | null;
        const tid = g?.getAttribute("data-testid") ?? "";
        const rf = tid.startsWith("spec-") ? tid.slice(5) : tid;
        if (rf !== "") {
          selectSublink(rf);
          haloPickRef.current = { id: rf, t: Date.now() };
        }
      }
      // Halo/path/arrow click picks the nearest live path.
      const halo = t?.closest?.(
        ".spec-edge__halo, .spec-edge__path, .spec-edge__arrow",
      ) as HTMLElement | null;
      if (halo != null && pill == null) {
        try {
          const p = toFlow(e.clientX, e.clientY);
          let best: string | null = null;
          let bd = Number.POSITIVE_INFINITY;
          let gsize = 0;
          for (const [tid, geom] of geomRef.current) {
            gsize += 1;
            for (let i = 0; i <= 24; i++) {
              const q = geom.at(i / 24);
              const dd = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y);
              if (dd < bd) {
                bd = dd;
                best = tid;
              }
            }
          }
          if (best != null && Math.sqrt(bd) <= 24) {
            selectSublink(best);
            haloPickRef.current = { id: best, t: Date.now() };
            return;
          }
        } catch {
          /* measuring must never break selection */
        }
      }
      const lab = t?.closest?.(".spec-edge__label--drag") as HTMLElement | null;
      if (lab != null) {
        const info = findSublink(lab.getAttribute("data-sub") ?? "");
        if (info && info.connId !== "") {
          const t0 = info.labelPosition ?? 0.5;
          setLabelDrag({ testId: info.testId, connId: info.connId, t: t0, t0 });
        }
      }
    },
    [findSublink, startRepointDrag, toFlow],
  );

  // ---- selection ------------------------------------------------------------
  // Box selection stays model-backed; edge selection is view-only (it only
  // drives the details panel + label visibility + highlight, never commands).
  // (React Flow can't own edge selection here — edges are derived — so
  // edge clicks select explicitly via onEdgeClick below.)

  const selectEdgeById = useCallback(
    (id: string) => {
      // A halo nearest-path pick from this press wins over React Flow's
      // topmost-edge click (crowded parallel links at tight packing).
      const hp = haloPickRef.current;
      if (hp != null && Date.now() - hp.t < 500 && hp.id !== id) return;
      setSelectedEdges([id]);
      const match = findSublink(id);
      if (match && match.connId !== "") {
        setSelectedEdge({
          connId: match.connId,
          connIds: [...match.connIds],
          lower: match.lower,
          fromKey: match.fromKey,
          toKey: match.toKey,
        });
      } else {
        setSelectedEdge(null);
      }
    },
    [findSublink],
  );
  const onSelectionChange = useCallback(
    ({
      nodes: sel,
      edges: selEdges,
    }: {
      nodes: { id: string }[];
      edges: { id: string }[];
    }) => {
      try {
        performance.mark("speculum:select-start");
      } catch {
        /* measuring never breaks selection */
      }
      const v = viewRef.current;
      const boxes = v?.diagram.boxes ?? {};
      select(
        sel.map((n) => n.id).filter((id) => id !== "__frame__" && boxes[id] != null),
      );
      try {
        requestAnimationFrame(() => {
          try {
            performance.mark("speculum:select-painted");
            performance.measure("speculum:select", "speculum:select-start", "speculum:select-painted");
          } catch {
            /* ignore */
          }
        });
      } catch {
        /* ignore */
      }
      const edgeIds = selEdges.map((e) => e.id);
      setSelectedEdges(edgeIds);
      // Resolve the first selected sub-link to its model link for the panel.
      // (RF only reports node selection here; edge clicks select explicitly.)
      const first = edgeIds.length > 0 ? edgeIds[0] : null;
      if (first != null) {
        const match = findSublink(first);
        if (match && match.connId !== "") {
          setSelectedEdge({
            connId: match.connId,
            connIds: [...match.connIds],
            lower: match.lower,
            fromKey: match.fromKey,
            toKey: match.toKey,
          });
        } else {
          setSelectedEdge(null);
        }
      } else {
        setSelectedEdge(null);
      }
    },
    [findSublink],
  );

  // Escape-clear is programmatic (React Flow would keep its own flags):
  // clear the store selection and mirror it into the node array directly
  // (rare path; the click path flows through React Flow itself).
  const clearSelection = useCallback(() => {
    select([]);
    setBaseNodes((prev) => {
      let changed = false;
      const next = prev.map((n) =>
        n.selected === true ? ((changed = true), { ...n, selected: false }) : n,
      );
      return changed ? next : prev;
    });
  }, []);

  // ---- connect mode clicks (C, then source, then target) --------------------
  const firstOtherBox = useCallback((src: string): string | null => {
    const ids = Object.keys(viewRef.current?.diagram.boxes ?? {}).sort();
    return ids.find((b) => b !== src) ?? null;
  }, []);

  const onNodeClick = useCallback(
    (e: React.MouseEvent, node: { id: string }) => {
      // Context-tray child: navigate to the diagram where it lives, with
      // the drill transition (view-only, never saved).
      if (node.id.startsWith("ctxc-")) {
        const objectId = node.id.slice("ctxc-".length);
        if (objectId !== "") {
          const el = document.querySelector(
            `[data-testid="ctx-child-${CSS.escape(objectId)}"]`,
          );
          const c = canvasRef.current?.getBoundingClientRect() ?? null;
          let rect: ScreenRect | null = null;
          if (el != null && c != null) {
            const r = el.getBoundingClientRect();
            rect = { x: r.x - c.x, y: r.y - c.y, w: r.width, h: r.height };
          }
          void goToObjectDiagram(objectId, rect);
        }
        return;
      }
      if (node.id === "__frame__" || node.id.startsWith("ctxt-")) return;
      const cm = connectRef.current;
      if (cm == null) return;
      if (cm.source == null) {
        setConnectMode({ source: node.id, candidate: firstOtherBox(node.id) });
      } else if (node.id !== cm.source) {
        setPendingLink({
          sourceKey: cm.source,
          targetKey: node.id,
          screenX: e.clientX,
          screenY: e.clientY,
        });
        // Draw-connection tool stays active until Esc/V (re-arm on the
        // same source for rapid linking).
        if (toolRef.current === "connect") {
          setConnectMode({ source: cm.source, candidate: firstOtherBox(cm.source) });
        } else {
          setConnectMode(null);
        }
      }
    },
    [firstOtherBox],
  );

  // ---- pane interactions ----------------------------------------------------

  const placeAddToolAt = useCallback(
    (id: ToolId, clientX: number, clientY: number) => {
      const kind = kindOfAddTool(id);
      if (kind == null) return;
      const flow = instance.screenToFlowPosition({ x: clientX, y: clientY });
      const label = KIND_LABELS[kind];
      // Snapped to 8px inside createBox; one Batch = one undo step.
      void createBox(kind, `New ${label}`, { x: flow.x - 120, y: flow.y - 60 });
      setTool("select");
      setGhost(null);
    },
    [instance],
  );

  const onPaneClick = useCallback(
    (e: React.MouseEvent) => {
      // Placement mode: click-to-place creates exactly one object.
      const cur = toolRef.current;
      if (cur != null && isAddTool(cur)) {
        placeAddToolAt(cur, e.clientX, e.clientY);
        return;
      }
      const detail = (e as unknown as { detail?: number }).detail ?? 1;
      if (detail === 2) {
        // Double-click empty canvas -> quick-add popover.
        const flow = instance.screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        });
        setQuickAdd({
          screenX: e.clientX,
          screenY: e.clientY,
          flowX: flow.x,
          flowY: flow.y,
        });
      } else {
        setQuickAdd(null);
        // Background click also clears edge selection.
        setSelectedEdges([]);
        setSelectedEdge(null);
      }
    },
    [instance, placeAddToolAt],
  );

  const onNodeDoubleClick = useCallback(
    (e: React.MouseEvent, node: { id: string }) => {
      if (node.id === "__frame__" || node.id.startsWith("ctx")) return;
      const t = e.target as HTMLElement | null;
      // Double-clicking the NAME starts inline rename; double-clicking the
      // body drills in (zoomable boxes only); empty canvas keeps quick-add.
      if (t?.closest?.(".spec-box__title, .spec-box__rename") != null) {
        setRenaming(node.id);
        return;
      }
      const doc = docRef.current;
      const obj = doc.model.objects[node.id];
      const kids = Object.values(doc.model.objects).filter((o) => o.parentId === node.id).length;
      const zoomable = obj != null && (canContain(obj.type) || kids > 0);
      if (!zoomable) return;
      const el = document.querySelector(`[data-testid="box-${CSS.escape(node.id)}"]`);
      const c = canvasRef.current?.getBoundingClientRect() ?? null;
      let rect: ScreenRect | null = null;
      if (el != null && c != null) {
        const r = el.getBoundingClientRect();
        rect = { x: r.x - c.x, y: r.y - c.y, w: r.width, h: r.height };
      }
      void zoomInto(node.id, rect);
    },
    [],
  );

  // ---- keyboard + mouse buttons ----------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc during an animation finishes it immediately.
      if (e.key === "Escape" && (model.animating || model.drill != null)) {
        e.preventDefault();
        finishDrill();
        return;
      }
      const target = e.target as HTMLElement | null;
      const inField =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      // Undo/redo live here (canvas owns the document store).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        if (inField) return;
        e.preventDefault();
        void undoModel();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "y" ||
          (e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
        if (inField) return;
        e.preventDefault();
        void redoModel();
        return;
      }
      // Alt+Left / Alt+Right = back / forward through the nav stack.
      // (Ignored mid-animation, like all other drill input. The guard keys
      // on the store animation only: lingering camera-settle phases must
      // never swallow the next gesture — user input cancels the visuals.)
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowLeft") {
        if (model.animating) return;
        e.preventDefault();
        void goBack();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowRight") {
        if (model.animating) return;
        e.preventDefault();
        void goForward();
        return;
      }
      if (e.key === " " && !inField) e.preventDefault();
      if (inField) return;
      // Input is ignored while a drill animation runs (Esc still finishes).
      if (model.animating) return;
      const cm = connectRef.current;
      if (e.key === "Escape") {
        if (repointAsk != null) {
          setRepointAsk(null);
          return;
        }
        if (labelDrag != null) {
          setLabelDrag(null);
          return;
        }
        if (dragRef.current != null) {
          setDragLink(null);
          return;
        }
        // Placement / connect tools return to Select on Esc.
        if (toolRef.current != null && toolRef.current !== "select") {
          setTool("select");
          setGhost(null);
          if (cm != null) setConnectMode(null);
          return;
        }
        if (cm != null) {
          setConnectMode(null);
          return;
        }
        if (renamingId != null) setRenaming(null);
        else {
          setQuickAdd(null);
          clearSelection();
        }
        return;
      }
      // Connect mode: arrows move the target candidate, Enter picks it.
      if (cm != null && cm.source != null) {
        const ids = Object.keys(viewRef.current?.diagram.boxes ?? {}).sort().filter((b) => b !== cm.source);
        if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          if (ids.length === 0) return;
          const cur = ids.indexOf(cm.candidate ?? "");
          const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
          const next = ids[((cur < 0 ? (dir > 0 ? -1 : 0) : cur) + dir + ids.length) % ids.length] ?? ids[0];
          setConnectMode({ source: cm.source, candidate: next });
          return;
        }
        if (e.key === "Enter" && cm.candidate != null) {
          e.preventDefault();
          const el = document.querySelector(
            `[data-testid="box-${CSS.escape(cm.candidate)}"]`,
          );
          const r = el?.getBoundingClientRect();
          setPendingLink({
            sourceKey: cm.source,
            targetKey: cm.candidate,
            screenX: r ? r.x + r.width / 2 : window.innerWidth / 2,
            screenY: r ? r.y : window.innerHeight / 2,
          });
          if (toolRef.current !== "connect") setConnectMode(null);
          return;
        }
      }
      // Space-held temporary pan (returns to the previous tool on keyup).
      // (keydown is handled here; keyup in the paired effect below.)
      // Tools: V select, H pan, C connect, N/F stubs. From tools.ts.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        setTool("select");
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === "h" || e.key === "H")) {
        e.preventDefault();
        setTool("pan");
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        setTool("connect");
        const selNow = selRef.current;
        if (selNow.length === 1) {
          setConnectMode({ source: selNow[0], candidate: firstOtherBox(selNow[0]) });
        } else {
          setConnectMode({ source: null, candidate: null });
        }
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        showToast("Sticky notes arrive in a later update", false);
        setTool("select");
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        showToast("Flows arrive in the next update", false);
        setTool("select");
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        void toggleShowAllLabels();
        return;
      }
      // F2 on the selected box starts inline rename.
      if (e.key === "F2" && selRef.current.length === 1 && !inField) {
        e.preventDefault();
        setRenaming(selRef.current[0]);
        return;
      }
      // Enter on the selected box drills in.
      if (e.key === "Enter" && selRef.current.length === 1 && renamingId == null) {
        const id = selRef.current[0];
        e.preventDefault();
        const el = document.querySelector(
          `[data-testid="box-${CSS.escape(id)}"]`,
        );
        const c = canvasRef.current?.getBoundingClientRect() ?? null;
        let rect: ScreenRect | null = null;
        if (el && c) {
          const r = el.getBoundingClientRect();
          rect = { x: r.x - c.x, y: r.y - c.y, w: r.width, h: r.height };
        }
        void zoomInto(id, rect);
        return;
      }
      // Delete/Backspace on a selected edge = Hide from this diagram
      // (toast offers Undo); the model keeps the link.
      if ((e.key === "Delete" || e.key === "Backspace") && selection.length === 0 && selectedEdges.length > 0) {
        e.preventDefault();
        const info = findSublink(selectedEdges[0]);
        const v = viewRef.current;
        if (info && info.connId !== "" && v != null) {
          void hideConnection(v.diagram.id, info.connId);
        }
        return;
      }
      // Backspace goes up one level; Delete removes from the diagram only.
      if (e.key === "Backspace") {
        e.preventDefault();
        void goUp();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        fitToScreen();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "1") {
        e.preventDefault();
        try {
          if (prefersReducedMotion()) {
            const vp = instance.getViewport();
            void instance.setViewport({ x: vp.x, y: vp.y, zoom: 1 });
          } else {
            void instance.zoomTo(1, { duration: 200 });
          }
        } catch {
          /* canvas not ready */
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        try {
          void instance.zoomIn({ duration: prefersReducedMotion() ? 0 : 200 });
        } catch {
          /* canvas not ready */
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        try {
          void instance.zoomOut({ duration: prefersReducedMotion() ? 0 : 200 });
        } catch {
          /* canvas not ready */
        }
        return;
      }
      // Fit to screen: Shift+1 (Ctrl+0 also fits, above).
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "!" || e.key === "1")) {
        e.preventDefault();
        fitToScreen();
        return;
      }
      // Delete removes FROM THE DIAGRAM ONLY (model keeps it).
      if (e.key === "Delete" && selRef.current.length > 0) {
        e.preventDefault();
        void removeFromDiagram(selRef.current);
        return;
      }
      // Add-object placement hotkeys (match M4 tooltips exactly):
      // Shift+S/A/X/D/P/G enter placement (ghost follows cursor).
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        const ADD_OF: Record<string, ToolId> = {
          s: "add-system",
          a: "add-app",
          x: "add-component",
          d: "add-store",
          p: "add-actor",
          g: "add-group",
        };
        const addId = ADD_OF[k];
        if (addId) {
          e.preventDefault();
          setTool(addId);
          return;
        }
        if (k === "n") {
          e.preventDefault();
          const el = document.querySelector(".flow-canvas");
          const r = el?.getBoundingClientRect();
          const cx = (r?.left ?? 0) + (r?.width ?? 800) / 2;
          const cy = (r?.top ?? 0) + (r?.height ?? 600) / 2;
          const flow = instance.screenToFlowPosition({ x: cx, y: cy });
          void openDiagramAtCenterFallback(flow, cx, cy);
          return;
        }
      }
    };
    // Mouse buttons 3/4 (X1/X2): back / forward (ignored mid-animation).
    const onMouse = (e: MouseEvent) => {
      if (model.animating) return;
      if (e.button === 3) {
        e.preventDefault();
        void goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        void goForward();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouse);
    };
  }, [instance, renamingId, clearSelection, model.animating, model.drill, model.drillAnim, selectedEdges, repointAsk, labelDrag, findSublink, firstOtherBox, fitToScreen]);

  // Space-held temporary pan: holding Space pans, release returns.
  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t != null &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      )
        return;
      if (e.code === "Space" && !e.repeat && spacePrevRef.current == null) {
        spacePrevRef.current = toolRef.current;
        if (toolRef.current !== "pan") setTool("pan");
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && spacePrevRef.current != null) {
        const prev = spacePrevRef.current;
        spacePrevRef.current = null;
        setTool(prev);
      }
    };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
    };
  }, []);

  async function openDiagramAtCenterFallback(
    flow: { x: number; y: number },
    cx: number,
    cy: number,
  ): Promise<void> {
    setQuickAdd({ screenX: cx, screenY: cy, flowX: flow.x, flowY: flow.y });
  }

  // Track the cursor in flow coords for create-at-cursor hotkeys + ghost.
  const onPaneMouseMove = useCallback(
    (e: React.MouseEvent) => {
      cursorFlow.current = instance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      const cur = toolRef.current;
      if (cur != null && isAddTool(cur)) {
        const c = canvasRef.current?.getBoundingClientRect();
        if (c != null) {
          const kind = kindOfAddTool(cur);
          setGhost({ kind: kind ?? "", x: e.clientX - c.left, y: e.clientY - c.top });
        }
      } else if (ghost != null) {
        setGhost(null);
      }
    },
    [instance, ghost],
  );

  // Drag-to-place: palette buttons drag a kind onto the canvas.
  const onCanvasDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-speculum-kind")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);
  const onCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      const kind = e.dataTransfer.getData("application/x-speculum-kind") as
        | "system"
        | "app"
        | "component"
        | "store"
        | "actor"
        | "group"
        | "";
      if (kind === "") return;
      e.preventDefault();
      const flow = instance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const label = KIND_LABELS[kind];
      void createBox(kind, `New ${label}`, { x: flow.x - 120, y: flow.y - 60 });
      setTool("select");
      setGhost(null);
    },
    [instance],
  );

  // ---- render ---------------------------------------------------------------

  // Keep the .flow-canvas flex space even when there is no view so the side
  // panel stays on the right; a failed get_diagram_view/ensure_layout load
  // shows a small error inside the canvas area instead of blank nothing.
  if (view == null || diagramId == null) {
    const showError = error != null || status === "error";
    return (
      <div
        className="flow-canvas"
        data-testid="canvas"
        onMouseMove={onPaneMouseMove}
      >
        {showError ? (
          <div
            data-testid="canvas-load-error"
            role="alert"
            className="flow-canvas__error"
          >
            Failed to load diagram{error ? `: ${error}` : ""}
          </div>
        ) : null}
      </div>
    );
  }

  const incomingClass =
    drill != null
      ? drill.reduced
        ? " flow-canvas__view--incoming-fade"
        : " flow-canvas__view--incoming"
      : "";

  const toolCursor =
    tool === "pan" ? " flow-canvas--tool-pan" : tool === "select" ? " flow-canvas--tool-select" : " flow-canvas--tool-add";
  return (
    <div
      className={
        "flow-canvas" + (animating && drill ? " flow-canvas--anim" : "") + (zoomKeep != null ? " flow-canvas--zooming" : "") + (model.connectMode != null || tool === "connect" ? " flow-canvas--connect" : "") + (tier !== "near" && nodeCount > PERF_REGIME_NODES ? " flow-canvas--lod" : "") + toolCursor
      }
      data-testid="canvas"
      ref={canvasRef}
      onMouseMove={onPaneMouseMove}
      onMouseDownCapture={onCanvasMouseDown}
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
    >
      <div className={`flow-canvas__view${incomingClass}`}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultViewport={defaultViewport}
          colorMode={resolved}
          attributionPosition="bottom-right"
          onInit={() => {
            try {
              performance.mark("speculum:rf-init");
            } catch {
              /* ignore */
            }
            setReady(true);
          }}
          onNodesChange={handleNodesChange}
          onSelectionChange={onSelectionChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onNodeMouseEnter={(_, node) => {
            if (node.id !== "__frame__") queueHover(node.id);
          }}
          onNodeMouseLeave={() => queueHover(null)}
          onNodeClick={onNodeClick}
          onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)}
          onEdgeMouseLeave={() => setHoveredEdge(null)}
          onEdgeClick={(_, edge) => selectEdgeById(edge.id)}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          onMove={(_, viewport) => {
            // Hover overlay follows the camera with zero React work.
            if (overlayRef.current != null) {
              overlayRef.current.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
            }
            // Programmatic camera moves never touch React state: geometry
            // (edges) and LOD tier stay frozen for the whole camera flight
            // and sync once when it settles, so a drill causes one geometry
            // build instead of one per animation frame.
            if (programmaticRef.current) {
              pendingZoomRef.current = viewport.zoom;
              return;
            }
            // Zero React work per pan/zoom frame: state (and the tree above
            // the canvas) updates only when the bucket or LOD tier changes;
            // the exact zoom syncs on move end. Pan frames (zoom identical)
            // and wheel ticks within a bucket never re-render.
            const b = zoomBucketOf(viewport.zoom);
            const t = tierOf(viewport.zoom);
            if (b !== lastZoomBucketRef.current || t !== tierRef.current) {
              lastZoomBucketRef.current = b;
              setZoom(viewport.zoom);
              onZoom(viewport.zoom);
            }
            // Programmatic camera moves are not input: they neither cancel
            // the visual sequence nor persist the viewport.
            if (zoomKeep != null || (model.drillAnim !== "idle" && model.drillAnim !== "fade")) {
              cancelDrillVisual();
            }
            if (animatingRef.current) return;
            if (viewRef.current != null)
              setLiveViewport(viewRef.current.diagram.id, { ...viewport });
          }}
          onMoveEnd={(_, viewport) => {
            if (programmaticRef.current) return;
            // Exact zoom sync after the gesture (display + parent).
            lastZoomBucketRef.current = zoomBucketOf(viewport.zoom);
            setZoom(viewport.zoom);
            onZoomRef.current(viewport.zoom);
            queueViewportSave(viewport);
          }}
          minZoom={0.1}
          maxZoom={4}
          zoomOnScroll
          panOnScroll={false}
          // No auto-pan while dragging a box: near the canvas edge the
          // viewport would chase the pointer and multiply drop positions.
          autoPanOnNodeDrag={false}
          // Plain drag on empty canvas pans (default panOnDrag); Shift+drag
          // draws a marquee via the default selectionKeyCode ('Shift').
          // Space+drag pans via the default panActivationKeyCode ('Space'),
          // and the middle mouse button pans via the d3 filter.
          // Pan tool: boxes are not draggable (nodes carry draggable=false).
          nodesDraggable={tool !== "pan"}
          panOnDrag
          selectionOnDrag={tool !== "pan"}
          multiSelectionKeyCode="Shift"
          deleteKeyCode={null}
          nodesConnectable={false}
          // SPEED part 3: culling stays on for pan/zoom but off through the
          // drill camera flight. The zoom/preset/settle sweep otherwise
          // mounts/unmounts hundreds of culled boxes per animation frame
          // (~450 extra box renders + the longest frame on every drill).
          onlyRenderVisibleElements={
            nodeCount > 150 &&
            !animating &&
            drill == null &&
            model.drillAnim !== "in-swap" &&
            model.drillAnim !== "up-swap" &&
            model.drillAnim !== "in-settle" &&
            model.drillAnim !== "up-settle"
          }
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.25}
            color="var(--sp-color-bg-canvas-dot)"
          />
        </ReactFlow>
      </div>
      {veilOn && (
        <div className="hover-veil" data-testid="hover-veil" aria-hidden="true" />
      )}
      {veilOn && (
        <div
          ref={overlayRef}
          className="hover-overlay"
          data-testid="hover-overlay"
          aria-hidden="true"
        >
          {batchHi.length > 0 && (
            <svg
              className="hover-overlay__edges"
              width={1}
              height={1}
              aria-hidden="true"
            >
              {batchHi.map((it) => (
                <g key={it.testId}>
                  <path
                    className="edge-batch__path edge-batch__path--hi"
                    d={it.d}
                  />
                  {it.arrowDHi !== "" && (
                    <path
                      className="edge-batch__arrow edge-batch__arrow--hi"
                      d={it.arrowDHi}
                    />
                  )}
                </g>
              ))}
            </svg>
          )}
          {overlayBoxes.map((b) => (
            <div
              key={b.id}
              className="hover-overlay__box"
              style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
            >
              <SpecBox
                {...{
                  id: b.id,
                  type: "specBox",
                  data: b.data,
                  selected: false,
                  dragging: false,
                } as unknown as NodeProps}
              />
            </div>
          ))}
        </div>
      )}
      {/* Left tool palette + breadcrumb (offset right of the bar) + zoom. */}
      <ToolPalette />
      <BreadcrumbCard />
      <ZoomGroup zoom={zoom} onFit={fitToScreen} />
      <div className="canvas-toolbar canvas-toolbar--labels" role="toolbar" aria-label="Canvas options">
        <button
          type="button"
          data-testid="labels-toggle"
          className={
            "canvas-toolbar__btn" + (showAllLabels ? " canvas-toolbar__btn--on" : "")
          }
          aria-pressed={showAllLabels}
          title="Show all edge labels"
          onClick={() => void toggleShowAllLabels()}
        >
          Labels
        </button>
      </div>
      {ghost != null && tool != null && isAddTool(tool) && (
        <div
          className="tool-ghost"
          data-testid="tool-ghost"
          style={{ left: ghost.x - 110, top: ghost.y - 55 }}
        >
          {KIND_LABELS[kindOfAddTool(tool) ?? "system"]}
        </div>
      )}
      {dragLink != null && (
        <ConnectPreview from={{ x: dragLink.fromX, y: dragLink.fromY }} to={{ x: dragLink.curX, y: dragLink.curY }} />
      )}
      <ConnectDialog />
      {repointAsk != null && (
        <RepointDialog
          info={repointAsk}
          onChoice={(mode) => {
            const ask = repointAsk;
            setRepointAsk(null);
            if (mode != null && view != null) {
              void repointConnection(view.diagram.id, ask.connId, ask.end, ask.newKey, mode);
            }
          }}
        />
      )}
      {error != null ? (
        <div
          data-testid="canvas-load-error"
          role="alert"
          className="flow-canvas__error"
        >
          Failed to load diagram: {error}
        </div>
      ) : null}
    </div>
  );
}

export default function FlowCanvas({ onZoom }: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner onZoom={onZoom} />
    </ReactFlowProvider>
  );
}
