import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  setQuickAdd,
  setRenaming,
  setSelectedEdge,
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

const nodeTypes = { specBox: SpecBox, scopeFrame: MemoScopeFrame, ctxTray: MemoCtxTray, ctxChild: MemoCtxChild };
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
  if (zoom < 0.2) return "far";
  if (zoom < 0.4) return "mid";
  return "near";
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

  // ---- node building -------------------------------------------------------
  // All inputs are mirrored into refs so the builder never closes over
  // stale data (it runs from an effect keyed on a revision string).

  const docRef = useRef(model.doc);
  docRef.current = model.doc;
  const selRef = useRef(selection);
  selRef.current = selection;
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

  const buildNodes = useCallback((): AnyNode[] => {
    const v = viewRef.current;
    const doc = docRef.current;
    const sel = selRef.current;
    const ren = renRef.current;
    const tr = tierRef.current;
    const cm = connectRef.current;
    if (v == null) return [];
    const out: AnyNode[] = [];
    const ids = Object.keys(v.diagram.boxes).sort();
    // Scope frame: wraps all boxes + frame padding, behind everything.
    // (Geometry helper shared with the live-drag frame below.)
    const scope = v.scope ?? null;
    if (scope != null && ids.length > 0) {
      const rects = ids.map((id) => v.diagram.boxes[id]).filter((r) => r != null);
      const frame = frameRectOf(rects);
      if (frame != null) {
        out.push({
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
            sub: scopeSub(docRef.current, scope),
            onConnectStart: (e: React.MouseEvent) => frameConnectRef.current(e),
          },
          selectable: false,
          draggable: false,
        });
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
      out.push({
        id,
        type: "specBox",
        position: { x: r.x, y: r.y },
        style: { width: Math.max(r.w, 40), height: Math.max(r.h, 40) },
        zIndex: o.type === "group" ? -1 : undefined,
        selected: sel.includes(id),
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
          zoomable: canContain(o.type) || kids > 0,
          wide: r.w > 150,
          tech: obj?.technologies?.[0] ?? "",
          description: obj?.description ?? "",
          onDrill: (boxId: string, rect: ScreenRect | null) =>
            drillCbRef.current(boxId, rect),
          renaming: ren === id,
          onRename: (name: string) => {
            void renameObject(id, name);
          },
          onCancelRename: () => setRenaming(null),
          candidate: cm?.candidate === id,
          onConnectStart: (boxId: string, e: React.MouseEvent) =>
            connectStartRef.current(boxId, e),
        },
      });
    }
    // Faint neighbour trays (spec 4.6): placed outside the main tray from
    // the PERSISTED boxes (stable mid-drag, like the frame node which the
    // canvas resizes imperatively during drags).
    appendCtxNodes(out, v, doc);
    return out;
  }, []);

  const [baseNodes, setBaseNodes, onNodesChange] = useNodesState<AnyNode>([]);

  // Live drag positions (flow coords) keyed by box id. Updated from every
  // position change so the scope frame + edges follow the drag each frame;
  // cleared on drop (the persisted MoveBoxes refresh takes over).
  const [dragPos, setDragPos] = useState<Record<string, { x: number; y: number }>>({});
  const handleNodesChange = useCallback(
    (changes: NodeChange<AnyNode>[]) => {
      onNodesChange(changes);
      const pos: Record<string, { x: number; y: number }> = {};
      for (const ch of changes) {
        if (ch.type === "position" && ch.position != null) {
          pos[ch.id] = { x: ch.position.x, y: ch.position.y };
        }
      }
      if (Object.keys(pos).length > 0) {
        setDragPos((prev) => ({ ...prev, ...pos }));
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
  const viewKey = view
    ? `${view.diagram.id}:${model.rev}:${selection.join(",")}:${renamingId}:${tier}:${selectedEdges.join(",")}:${model.connectMode == null ? "" : `${model.connectMode.source ?? ""}>${model.connectMode.candidate ?? ""}`}:${ctxSig}:${model.drill != null ? `${model.drill.dir}:${model.drill.boxId ?? ""}` : ""}`
    : "none";
  const lastKey = useRef("");
  const viewKeyRef = useRef(viewKey);
  viewKeyRef.current = viewKey;
  useEffect(() => {
    if (draggingRef.current || pointerDownRef.current) return;
    if (lastKey.current === viewKey) return;
    lastKey.current = viewKey;
    setBaseNodes(buildNodes());
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
        setBaseNodes(buildNodes());
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
        setZoom(v2.zoom);
        onZoomRef.current(v2.zoom);
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
        setZoom(v2.zoom);
        onZoomRef.current(v2.zoom);
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
      // Persist the settled viewport (full fit incl. context trays) so a
      // later plain revisit restores it instead of the main-only auto-fit.
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

  const nodes = useMemo<AnyNode[]>(
    () =>
      baseNodes.map((n) => {
        let cls = n.className ?? "";
        // Camera zoom keeps the drill target full-strength while the rest
        // fades (spec 4.7); hover dimming otherwise.
        const faded =
          zoomKeep != null && n.id !== zoomKeep ? " spec-node--drill-fade" : "";
        // Pan tool: boxes are not draggable (left-drag pans instead).
        const noDrag = tool === "pan" && n.type === "specBox" ? { draggable: false } : null;
        if (n.id === "__frame__") {
          return faded ? { ...n, className: cls + faded } : n;
        }
        if (n.type === "ctxChild") {
          cls += " spec-node--ctx";
          if (focus != null && focus.boxes.has(n.id)) cls += " spec-node--ctx-hot";
          return cls !== (n.className ?? "") || faded !== ""
            ? { ...n, className: cls + faded }
            : n;
        }
        if (n.type === "ctxTray") {
          return faded ? { ...n, className: cls + faded } : n;
        }
        const dim =
          focus != null && !focus.boxes.has(n.id) ? " spec-node--dim" : undefined;
        const next = cls + (dim ?? "") + faded;
        if (next !== (n.className ?? "") || noDrag != null) return { ...n, className: next, ...(noDrag ?? {}) };
        return n;
      }),
    [baseNodes, focus, zoomKeep, tool],
  );

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

  const { edges, sublinkInfos, geoms: edgeGeoms } = useMemo<{
    edges: FlowEdge[];
    sublinkInfos: SublinkInfo[];
    geoms: Map<string, { at: (t: number) => Pt }>;
  }>(() => {
    const v = view;
    if (v == null) return { edges: [], sublinkInfos: [], geoms: new Map() };
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

    const list: FlowEdge[] = [];
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
      const fan = fanOf.get(s.testId) ?? 0;
      const layout =
        s.connId !== "" ? (v.diagram.connections[s.connId] as unknown as
          | { labelPosition?: number | null; waypoints?: { x: number; y: number }[] }
          | undefined) : undefined;
      const waypoints = (layout?.waypoints ?? []).map((w) => ({ x: w.x, y: w.y }));
      const manualT =
        layout?.labelPosition ?? conn?.labelPosition ?? null;

      // Via object: pill at the midpoint when not boxed; two segments
      // through the box (arrowhead only at the final target) when boxed.
      const viaId = conn?.viaId ?? null;
      const viaObj =
        viaId != null
          ? (doc.model.objects[viaId] as unknown as
              | { name: string; type: string }
              | undefined)
          : undefined;
      const viaRect = viaId != null ? (liveRects[viaId] ?? null) : null;
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

      const isOut = focus != null && focus.edgesOut.has(s.edgeIndex);
      const isIn = focus != null && focus.edgesIn.has(s.edgeIndex);
      const touchesCtx =
        isCtx &&
        focus != null &&
        focus.boxes.has(s.fromKey) &&
        focus.boxes.has(s.toKey);
      const touches = isOut || isIn || touchesCtx;
      const dim = focus != null && !touches && hoveredEdge !== s.testId;
      const hovered = hoveredEdge === s.testId;
      const selected = selectedEdges.includes(s.testId);
      const hi = touches || hovered || selected;
      const strokeW = hi ? EDGE_TOKENS.strokeHi : EDGE_TOKENS.stroke;
      const arrowSize = Math.max(EDGE_TOKENS.arrowMin / Math.max(zoom, 0.05), 4 * strokeW);
      const arrowheads = direction === "bidirectional" ? 2 : direction === "none" ? 0 : 1;

      const labelText =
        conn?.name ??
        (s.connIds.length > 1 ? `${s.connIds.length} links` : "");
      const labelVisible =
        labelText !== "" &&
        (zoom >= EDGE_TOKENS.labelZoomThreshold ||
          showAllLabels ||
          hovered ||
          selected ||
          touches);
      // Live label-drag position wins while dragging; otherwise the manual
      // position wins, else the first collision-free slot along the path.
      const liveT = labelDrag?.testId === s.testId ? labelDrag.t : null;
      const placed =
        labelVisible && labelText !== ""
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
      const showBadge = s.lower && s.connIds.length > 1 && s.subIndex === 0;
      const badgePt = showBadge ? geom.at(0.85) : null;

      let mods = "";
      if (status !== "live") mods += ` spec-edge--status-${status}`;
      if (s.lower) mods += " spec-edge--lower";
      if (hi) mods += ` spec-edge--hi spec-edge--hi-${isOut || hovered || selected ? "out" : "in"}`;
      if (selected) mods += " spec-edge--selected";

      const data: SpecEdgeData = {
        d: geom.d,
        startArrow: arrowheads === 2 ? arrowPoints(p1, { x: -geom.startTangent.x, y: -geom.startTangent.y }, arrowSize) : null,
        endArrow: arrowheads >= 1 ? arrowPoints(p2, geom.endTangent, arrowSize) : null,
        label: labelVisible
          ? {
              x: labelPt.x,
              y: labelPt.y,
              text: labelText,
              meta: s.lower && s.connIds.length > 1 ? "[rolled up]" : null,
              testId: "spec-edge-label",
            }
          : null,
        badge: showBadge && badgePt
          ? {
              x: badgePt.x,
              y: badgePt.y,
              text: `${s.connIds.length}`,
              title: names.filter((n) => n !== "").join(", "),
              testId: "spec-edge-badge",
            }
          : null,
        via:
          viaId != null && !viaRouted && viaObj != null
            ? {
                x: midPt.x,
                y: midPt.y,
                name: viaObj.name,
                kind: viaObj.type,
                testId: "via-pill",
              }
            : null,
        tooltip,
        testId: `spec-${s.testId}`,
        pathTestId: isCtx
          ? `spec-ctx-edge-path-${s.subIndex}`
          : `spec-edge-path-${s.edgeIndex}${s.subIndex > 0 ? `-${s.subIndex}` : ""}`,
        mods,
        coords: { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y },
        fromKey: s.fromKey,
        toKey: s.toKey,
        connIds: [...s.connIds],
        arrowheads,
        parentPort: fromIsParent || toIsParent,
        viaRouted,
        selected,
        hx1: p1.x + n1.x * 14,
        hy1: p1.y + n1.y * 14,
        hx2: p2.x + n2.x * 14,
        hy2: p2.y + n2.y * 14,
      };

      list.push({
        id: s.testId,
        source: s.fromKey,
        target: s.toKey,
        type: "specEdge",
        data,
        selectable: true,
        selected: selectedEdges.includes(s.testId),
        className:
          "flow-edge" +
          (touches || hovered || selected
            ? ` flow-edge--hi flow-edge--${isOut || (!isIn && (hovered || selected)) ? "out" : "in"}`
            : "") +
          (dim ? " flow-edge--dim" : "") +
          (s.lower ? " flow-edge--lower" : "") +
          (s.isFrame ? " flow-edge--frame" : ""),
      });
      infos.push({
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
        labelVisible,
      });
    }
    // Highlighted edges render last (on top).
    const order = (e: FlowEdge) => (e.className?.includes("flow-edge--hi") ? 1 : 0);
    list.sort((a, b) => order(a) - order(b));
    return { edges: list, sublinkInfos: infos, geoms };
  }, [view, focus, model.doc, liveRects, liveFrame, ctxLinks, ctxChildRects, zoom, showAllLabels, hoveredEdge, selectedEdges, labelDrag]);

  const geomRef = useRef<Map<string, { at: (t: number) => Pt }>>(new Map());
  geomRef.current = edgeGeoms;
  const sublinkRef = useRef<SublinkInfo[]>([]);
  sublinkRef.current = sublinkInfos;

  useEffect(() => {
    setDebugSublinks(sublinkInfos);
  }, [sublinkInfos]);

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
      // fade belongs to the store timer (120ms), not the canvas.
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
      // Fresh level: fit + centre the MAIN tray with padding, capped at
      // 1.25. Context trays stay out of the auto-fit (they join manual
      // Fit); this keeps first-open zoom stable.
      const mainIds = [
        ...Object.keys(view.diagram.boxes).map((id) => ({ id })),
        ...(view.scope != null ? [{ id: "__frame__" }] : []),
      ];
      if (mainIds.length > 0) {
        void instance.fitView({ nodes: mainIds, padding: 0.2, maxZoom: 1.25 });
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
      const v = viewRef.current;
      const boxes = v?.diagram.boxes ?? {};
      select(
        sel.map((n) => n.id).filter((id) => id !== "__frame__" && boxes[id] != null),
      );
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

  const clearSelection = useCallback(() => select([]), []);

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
      // (Ignored mid-animation, like all other drill input.)
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowLeft") {
        if (model.animating || model.drillAnim !== "idle") return;
        e.preventDefault();
        void goBack();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowRight") {
        if (model.animating || model.drillAnim !== "idle") return;
        e.preventDefault();
        void goForward();
        return;
      }
      if (e.key === " " && !inField) e.preventDefault();
      if (inField) return;
      // Input is ignored while a drill animation runs (Esc still finishes).
      if (model.animating || model.drillAnim !== "idle") return;
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
        if (selection.length === 1) {
          setConnectMode({ source: selection[0], candidate: firstOtherBox(selection[0]) });
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
      if (e.key === "F2" && selection.length === 1 && !inField) {
        e.preventDefault();
        setRenaming(selection[0]);
        return;
      }
      // Enter on the selected box drills in.
      if (e.key === "Enter" && selection.length === 1 && renamingId == null) {
        const id = selection[0];
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
      if (e.key === "Delete" && selection.length > 0) {
        e.preventDefault();
        void removeFromDiagram(selection);
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
      if (model.animating || model.drillAnim !== "idle") return;
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
  }, [instance, selection, renamingId, clearSelection, model.animating, model.drill, model.drillAnim, selectedEdges, repointAsk, labelDrag, findSublink, firstOtherBox, fitToScreen]);

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

  const nodeCount = Object.keys(view.diagram.boxes).length;
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
        "flow-canvas" + (animating && drill ? " flow-canvas--anim" : "") + (zoomKeep != null ? " flow-canvas--zooming" : "") + (model.connectMode != null || tool === "connect" ? " flow-canvas--connect" : "") + toolCursor
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
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={resolved}
          attributionPosition="bottom-right"
          onInit={() => setReady(true)}
          onNodesChange={handleNodesChange}
          onSelectionChange={onSelectionChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onNodeMouseEnter={(_, node) =>
            node.id !== "__frame__" && setHover(node.id)
          }
          onNodeMouseLeave={() => setHover(null)}
          onNodeClick={onNodeClick}
          onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)}
          onEdgeMouseLeave={() => setHoveredEdge(null)}
          onEdgeClick={(_, edge) => selectEdgeById(edge.id)}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          onMove={(_, viewport) => {
            setZoom(viewport.zoom);
            onZoom(viewport.zoom);
            // Programmatic camera moves are not input: they neither cancel
            // the visual sequence nor persist the viewport.
            if (programmaticRef.current) return;
            if (zoomKeep != null || (model.drillAnim !== "idle" && model.drillAnim !== "fade")) {
              cancelDrillVisual();
            }
            if (animatingRef.current) return;
            if (viewRef.current != null)
              setLiveViewport(viewRef.current.diagram.id, { ...viewport });
          }}
          onMoveEnd={(_, viewport) => {
            if (programmaticRef.current) return;
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
          onlyRenderVisibleElements={nodeCount > 300}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.25}
            color="var(--sp-color-bg-canvas-dot)"
          />
        </ReactFlow>
      </div>
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
