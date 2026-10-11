import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "../theme/ThemeProvider";
import SpecBox, { type SpecBoxData, type SpecBoxTag, type ZoomTier } from "./SpecBox";
import { toTagColor } from "../components/TagPill";
import {
  KIND_LABELS,
  canContain,
  createBox,
  finishDrill,
  goBack,
  goForward,
  goUp,
  moveBoxes,
  redoModel,
  removeFromDiagram,
  renameObject,
  select,
  setHover,
  setLiveViewport,
  setQuickAdd,
  setRenaming,
  saveViewport,
  snap8,
  undoModel,
  useModel,
  zoomInto,
} from "../model/store";
import type { ObjectKind, ScreenRect } from "../model/types";
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
function ScopeFrameNode({ data }: { data: { label: string } }) {
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
    </div>
  );
}
const MemoScopeFrame = memo(ScopeFrameNode);

const nodeTypes = { specBox: SpecBox, scopeFrame: MemoScopeFrame };

type SpecNode = FlowNode<SpecBoxData & { __boxId: string }, "specBox">;
type FrameNodeType = FlowNode<{ label: string }, "scopeFrame">;
type AnyNode = SpecNode | FrameNodeType;

const KIND_OF_KEY: Record<string, ObjectKind> = {
  s: "system",
  p: "actor",
  g: "group",
  a: "app",
  d: "store",
  x: "component",
};

function tierOf(zoom: number): ZoomTier {
  if (zoom < 0.2) return "far";
  if (zoom < 0.4) return "mid";
  return "near";
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
  const drillCbRef = useRef(
    (_boxId: string, _rect: ScreenRect | null): void => {},
  );

  const buildNodes = useCallback((): AnyNode[] => {
    const v = viewRef.current;
    const doc = docRef.current;
    const sel = selRef.current;
    const ren = renRef.current;
    const tr = tierRef.current;
    if (v == null) return [];
    const out: AnyNode[] = [];
    const ids = Object.keys(v.diagram.boxes).sort();
    // Scope frame: wraps all boxes + 48px padding, behind everything.
    const scope = v.scope ?? null;
    if (scope != null && ids.length > 0) {
      const rects = ids.map((id) => v.diagram.boxes[id]).filter((r) => r != null);
      if (rects.length > 0) {
        const pad = 48;
        const minX = Math.min(...rects.map((r) => r.x)) - pad;
        const minY = Math.min(...rects.map((r) => r.y)) - pad;
        const maxX = Math.max(...rects.map((r) => r.x + r.w)) + pad;
        const maxY = Math.max(...rects.map((r) => r.y + r.h)) + pad;
        out.push({
          id: "__frame__",
          type: "scopeFrame",
          position: { x: minX, y: minY },
          style: {
            width: Math.max(maxX - minX, 40),
            height: Math.max(maxY - minY, 40),
          },
          zIndex: -5,
          data: { label: scope.name },
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
          onDrill: (boxId: string, rect: ScreenRect | null) =>
            drillCbRef.current(boxId, rect),
          renaming: ren === id,
          onRename: (name: string) => {
            void renameObject(id, name);
          },
          onCancelRename: () => setRenaming(null),
        },
      });
    }
    return out;
  }, []);

  const [baseNodes, setBaseNodes, onNodesChange] = useNodesState<AnyNode>([]);

  // Rebuild from the view when the diagram or backend rev changes.
  const viewKey = view
    ? `${view.diagram.id}:${model.rev}:${selection.join(",")}:${renamingId}:${tier}`
    : "none";
  const lastKey = useRef("");
  useEffect(() => {
    if (draggingRef.current) return;
    if (lastKey.current === viewKey) return;
    lastKey.current = viewKey;
    setBaseNodes(buildNodes());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  // ---- drill overlay ---------------------------------------------------------

  const drill = model.drill;
  const animating = model.animating;
  const [overlayGo, setOverlayGo] = useState(false);
  useEffect(() => {
    if (drill != null && !drill.reduced && drill.rect != null) {
      setOverlayGo(false);
      let alive = true;
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (alive) setOverlayGo(true);
        }),
      );
      return () => {
        alive = false;
        cancelAnimationFrame(raf);
      };
    }
    setOverlayGo(false);
    return undefined;
  }, [drill]);

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

  const overlayStyle = useMemo(() => {
    if (drill == null || drill.reduced || drill.rect == null) return null;
    const c = canvasRef.current?.getBoundingClientRect();
    if (c == null || c.width <= 0 || c.height <= 0) return null;
    const r = drill.rect;
    const sx = r.w / c.width;
    const sy = r.h / c.height;
    const from = `translate(${r.x}px, ${r.y}px) scale(${sx}, ${sy})`;
    return {
      transform: drill.dir === "in" ? (overlayGo ? "none" : from) : overlayGo ? from : "none",
    };
  }, [drill, overlayGo]);

  // ---- hover sets from real edges ------------------------------------------

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
    // Resolve to a boxed id (the hovered box itself if present).
    const hovered = v.diagram.boxes[hov] ? hov : null;
    if (hovered == null) return null;
    const boxes = new Set<string>([hovered]);
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
  }, [view, hover]);

  const nodes = useMemo<AnyNode[]>(
    () =>
      baseNodes.map((n) => {
        if (n.id === "__frame__") return n;
        const dim =
          focus != null && !focus.boxes.has(n.id) ? " spec-node--dim" : undefined;
        return dim ? { ...n, className: (n.className ?? "") + dim } : n;
      }),
    [baseNodes, focus],
  );

  const edges = useMemo<FlowEdge[]>(() => {
    const v = view;
    if (v == null) return [];
    // All colors via generated CSS vars (theme-aware, no hard-coded values).
    const accentPrimary = "var(--sp-color-accent-primary)";
    const accentSecondary = "var(--sp-color-accent-secondary)";
    const tertiary = "var(--sp-color-text-tertiary)";
    const doc = model.doc;
    const list: FlowEdge[] = v.edges.map((e, i) => {
      const src = endpointBox(e.from) ?? "__frame__";
      const tgt = endpointBox(e.to) ?? "__frame__";
      const isFrame = src === "__frame__" || tgt === "__frame__";
      const names = e.connectionIds.map(
        (cid) => doc.model.connections[cid]?.name ?? "",
      );
      const nonEmpty = names.filter((n) => n !== "");
      const total = e.connectionIds.length;
      const label =
        nonEmpty.length > 0
          ? nonEmpty[0] + (total > 1 ? ` +${total - 1}` : "")
          : total > 1
            ? `${total} links`
            : undefined;
      const isOut = focus != null && focus.edgesOut.has(i);
      const isIn = focus != null && focus.edgesIn.has(i);
      const touches = isOut || isIn;
      const dim = focus != null && !touches;
      return {
        id: `e-${i}`,
        source: src,
        target: tgt,
        type: "default",
        label,
        labelBgPadding: [6, 4] as [number, number],
        labelBgBorderRadius: 999,
        selectable: false,
        className:
          "flow-edge" +
          (touches ? ` flow-edge--hi flow-edge--${isOut ? "out" : "in"}` : "") +
          (dim ? " flow-edge--dim" : "") +
          (e.lower ? " flow-edge--lower" : "") +
          (isFrame ? " flow-edge--frame" : ""),
          style: {
            strokeWidth: 1.5,
            stroke: touches
              ? isOut
                ? accentPrimary
                : accentSecondary
              : tertiary,
            ...(e.lower ? { strokeDasharray: "5 5" } : {}),
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: touches
              ? isOut
                ? accentPrimary
                : accentSecondary
              : tertiary,
            width: 16,
            height: 16,
          },
          ...(e.bidirectional
            ? {
                markerStart: {
                  type: MarkerType.ArrowClosed,
                  color: touches ? accentSecondary : tertiary,
                  width: 16,
                  height: 16,
                },
              }
            : {}),
      };
    });
    list.sort((a, b) => {
      const ha = a.className?.includes("flow-edge--hi") ? 1 : 0;
      const hb = b.className?.includes("flow-edge--hi") ? 1 : 0;
      return ha - hb;
    });
    return list;
  }, [view, focus, model.doc]);

  // ---- viewport restore / persist ------------------------------------------
  // The saved viewport is applied in a layout effect (before paint) so the
  // target view never pops at the end of a drill animation.

  // Restore the saved viewport (or fit) whenever a new diagram opens.
  const openedRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!ready || view == null) return;
    if (openedRef.current === view.diagram.id) return;
    openedRef.current = view.diagram.id;
    const vp = view.diagram.viewport;
    if (vp && vp.zoom > 0) {
      void instance.setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom });
      setLiveViewport(view.diagram.id, { x: vp.x, y: vp.y, zoom: vp.zoom });
      setZoom(vp.zoom);
      onZoom(vp.zoom);
    } else {
      void instance.fitView({ padding: 0.2 });
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

  // ---- drag: local during drag, ONE MoveBoxes on stop -----------------------

  const onNodeDragStart = useCallback(() => {
    draggingRef.current = true;
  }, []);

  const onNodeDragStop = useCallback(
    (e: MouseEvent | TouchEvent, _node: unknown, all: AnyNode[]) => {
      draggingRef.current = false;
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

  // ---- selection ------------------------------------------------------------

  const onSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: { id: string }[] }) => {
      select(sel.map((n) => n.id).filter((id) => id !== "__frame__"));
    },
    [],
  );

  const clearSelection = useCallback(() => select([]), []);

  // ---- pane interactions ----------------------------------------------------

  const onPaneClick = useCallback(
    (e: React.MouseEvent) => {
      const detail = (e as unknown as { detail?: number }).detail ?? 1;
      if (detail === 2) {
        // Double-click empty canvas -> quick-add popover.
        const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const flow = instance.screenToFlowPosition({
          x: e.clientX - bounds.left,
          y: e.clientY - bounds.top,
        });
        setQuickAdd({
          screenX: e.clientX,
          screenY: e.clientY,
          flowX: flow.x,
          flowY: flow.y,
        });
      } else {
        setQuickAdd(null);
      }
    },
    [instance],
  );

  const onNodeDoubleClick = useCallback(
    (_e: React.MouseEvent, node: { id: string }) => {
      if (node.id !== "__frame__") setRenaming(node.id);
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
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowLeft") {
        e.preventDefault();
        void goBack();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowRight") {
        e.preventDefault();
        void goForward();
        return;
      }
      if (e.key === " " && !inField) e.preventDefault();
      if (inField) return;
      if (e.key === "Escape") {
        if (renamingId != null) setRenaming(null);
        else {
          setQuickAdd(null);
          clearSelection();
        }
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
      // Backspace goes up one level; Delete removes from the diagram only.
      if (e.key === "Backspace") {
        e.preventDefault();
        void goUp();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        void instance.fitView({ padding: 0.2 });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "1") {
        e.preventDefault();
        void instance.zoomTo(1);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        void instance.zoomIn();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        void instance.zoomOut();
        return;
      }
      if (e.shiftKey && (e.key === "C" || e.key === "c")) {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          void instance.fitView({ padding: 0.2 });
        } else if (selection.length > 0) {
          const picked = instance
            .getNodes()
            .filter((n) => selection.includes(n.id));
          if (picked.length > 0)
            void instance.fitView({ nodes: picked, padding: 0.2 });
        }
        return;
      }
      // Delete removes FROM THE DIAGRAM ONLY (model keeps it).
      if (e.key === "Delete" && selection.length > 0) {
        e.preventDefault();
        void removeFromDiagram(selection);
        return;
      }
      // Create hotkeys: Shift+<letter> (no Ctrl).
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "n") {
          e.preventDefault();
          const el = document.querySelector(".flow-canvas");
          const r = el?.getBoundingClientRect();
          const cx = (r?.left ?? 0) + (r?.width ?? 800) / 2;
          const cy = (r?.top ?? 0) + (r?.height ?? 600) / 2;
          const flow = instance.screenToFlowPosition({ x: cx - (r?.left ?? 0), y: cy - (r?.top ?? 0) });
          void openDiagramAtCenterFallback(flow, cx, cy);
          return;
        }
        const kind = KIND_OF_KEY[k];
        if (kind) {
          e.preventDefault();
          const label = KIND_LABELS[kind];
          void createBox(kind, `New ${label}`, {
            x: cursorFlow.current.x - 120,
            y: cursorFlow.current.y - 60,
          });
        }
      }
    };
    // Mouse buttons 3/4 (X1/X2): back / forward.
    const onMouse = (e: MouseEvent) => {
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
  }, [instance, selection, renamingId, clearSelection, model.animating, model.drill]);

  async function openDiagramAtCenterFallback(
    flow: { x: number; y: number },
    cx: number,
    cy: number,
  ): Promise<void> {
    setQuickAdd({ screenX: cx, screenY: cy, flowX: flow.x, flowY: flow.y });
  }

  // Track the cursor in flow coords for create-at-cursor hotkeys.
  const onPaneMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
      cursorFlow.current = instance.screenToFlowPosition({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      });
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
  const showOverlay = drill != null && !drill.reduced && drill.rect != null;
  const incomingClass =
    drill != null
      ? drill.reduced
        ? " flow-canvas__view--incoming-fade"
        : " flow-canvas__view--incoming"
      : "";

  return (
    <div
      className={
        "flow-canvas" + (animating && drill ? " flow-canvas--anim" : "")
      }
      data-testid="canvas"
      ref={canvasRef}
      onMouseMove={onPaneMouseMove}
    >
      <div className={`flow-canvas__view${incomingClass}`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode={resolved}
          attributionPosition="bottom-right"
          onInit={() => setReady(true)}
          onNodesChange={onNodesChange}
          onSelectionChange={onSelectionChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onNodeMouseEnter={(_, node) =>
            node.id !== "__frame__" && setHover(node.id)
          }
          onNodeMouseLeave={() => setHover(null)}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          onMove={(_, viewport) => {
            setZoom(viewport.zoom);
            onZoom(viewport.zoom);
            if (viewRef.current != null)
              setLiveViewport(viewRef.current.diagram.id, { ...viewport });
          }}
          onMoveEnd={(_, viewport) => queueViewportSave(viewport)}
          minZoom={0.1}
          maxZoom={4}
          zoomOnScroll
          panOnScroll={false}
          // Plain drag on empty canvas pans (default panOnDrag); Shift+drag
          // draws a marquee via the default selectionKeyCode ('Shift').
          // Space+drag pans via the default panActivationKeyCode ('Space'),
          // and the middle mouse button pans via the d3 filter.
          multiSelectionKeyCode="Shift"
          deleteKeyCode={null}
          nodesConnectable={false}
          onlyRenderVisibleElements={nodeCount > 300}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1.5}
            color="var(--sp-color-bg-canvas-dot)"
          />
        </ReactFlow>
      </div>
      {showOverlay && overlayStyle ? (
        <div
          className={
            "drill-overlay" + (drill.dir === "up" ? " drill-overlay--up" : "")
          }
          style={overlayStyle}
          aria-hidden="true"
        >
          <span className="drill-overlay__label">{drill.label}</span>
        </div>
      ) : null}
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
