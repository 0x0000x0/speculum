import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  useNodesState,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { SAMPLE_EDGES, SAMPLE_NODES } from "../data/sample";
import { useTheme } from "../theme/ThemeProvider";
// Single source of truth, read at build time: marker fills need concrete
// colours (SVG <marker> attributes can't use var()), so we take them from
// tokens.json for the active theme instead of hard-coding hex values.
import tokenData from "../../../../tokens/tokens.json";
import SpecBox, { type SpecBoxData } from "./SpecBox";
import "./FlowCanvas.css";

const nodeTypes = { spec: SpecBox };

type SpecNode = FlowNode<SpecBoxData, "spec">;

const BASE_NODES: SpecNode[] = SAMPLE_NODES.map((n) => ({
  id: n.id,
  type: "spec",
  position: { x: n.x, y: n.y },
  // M3 demo entry state: Payments API starts selected so the Details
  // panel and the canvas selection ring agree on first paint.
  selected: n.id === "payments",
  data: {
    kind: n.kind,
    title: n.title,
    caption: n.caption,
    tags: n.tags,
    external: n.external,
    children: n.children,
  },
}));

// Handle routing chosen for the M3 demo layout.
const EDGE_HANDLES: Record<string, { sourceHandle: string; targetHandle: string }> = {
  e1: { sourceHandle: "out-right", targetHandle: "in-left" },
  e2: { sourceHandle: "out-bottom", targetHandle: "in-top" },
  e3: { sourceHandle: "out-right", targetHandle: "in-left" },
  e4: { sourceHandle: "out-right", targetHandle: "in-top" },
};

interface FlowCanvasProps {
  onSelect: (id: string | null) => void;
  onZoom: (zoom: number) => void;
}

export default function FlowCanvas({ onSelect, onZoom }: FlowCanvasProps) {
  const { resolved } = useTheme();
  const [hovered, setHovered] = useState<string | null>(null);

  // ?hover=<nodeId> pins the hover-highlight state (screenshots).
  const forcedHover = useMemo(() => {
    try {
      const id = new URLSearchParams(window.location.search).get("hover");
      return id && SAMPLE_NODES.some((n) => n.id === id) ? id : null;
    } catch {
      return null;
    }
  }, []);
  const activeHover = forcedHover ?? hovered;

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of SAMPLE_EDGES) {
      if (!map.has(e.source)) map.set(e.source, new Set());
      if (!map.has(e.target)) map.set(e.target, new Set());
      map.get(e.source)!.add(e.target);
      map.get(e.target)!.add(e.source);
    }
    return map;
  }, []);

  const inFocus = useCallback(
    (id: string) =>
      activeHover !== null &&
      (id === activeHover || neighbours.get(activeHover)?.has(id) === true),
    [activeHover, neighbours],
  );

  const [baseNodes, , onNodesChange] = useNodesState(BASE_NODES);

  // Report node selection up for the Details panel (derived from node
  // state so canvas ring and panel can never disagree).
  const selectedId = baseNodes.find((n) => n.selected)?.id ?? null;
  const prevSelected = useRef<string | null>(selectedId);
  useEffect(() => {
    if (prevSelected.current !== selectedId) {
      prevSelected.current = selectedId;
      onSelect(selectedId);
    }
  }, [selectedId, onSelect]);

  const nodes = useMemo<SpecNode[]>(
    () =>
      baseNodes.map((n) => ({
        ...n,
        className:
          activeHover !== null && !inFocus(n.id)
            ? "spec-node--dim"
            : undefined,
      })),
    [baseNodes, activeHover, inFocus],
  );

  const edges = useMemo<FlowEdge[]>(() => {
    const palette = tokenData.color[resolved] as Record<string, string>;
    const accentPrimary = palette["accent.primary"];
    const accentSecondary = palette["accent.secondary"];
    // Base edges use the live CSS var so they follow the theme
    // without a re-render; markers use the build-time token value.

    const list = SAMPLE_EDGES.map((e) => {
      const touches =
        activeHover !== null &&
        (e.source === activeHover || e.target === activeHover);
      const outgoing = e.source === activeHover;
      const edge: FlowEdge = {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: EDGE_HANDLES[e.id]?.sourceHandle,
        targetHandle: EDGE_HANDLES[e.id]?.targetHandle,
        type: "smoothstep",
        label: e.label,
        labelBgPadding: [6, 4] as [number, number],
        labelBgBorderRadius: 999,
        selectable: true,
        className:
          activeHover === null
            ? "flow-edge"
            : touches
              ? `flow-edge flow-edge--hi flow-edge--${outgoing ? "out" : "in"}`
              : "flow-edge flow-edge--dim",
        style:
          activeHover === null
            ? { strokeWidth: 1.5, stroke: "var(--sp-color-text-tertiary)" }
            : touches
              ? {
                  strokeWidth: 2.5,
                  stroke: outgoing ? accentPrimary : accentSecondary,
                }
              : { strokeWidth: 1.5, stroke: "var(--sp-color-text-tertiary)" },
        markerEnd:
          touches && activeHover !== null
            ? {
                type: MarkerType.ArrowClosed,
                color: outgoing ? accentPrimary : accentSecondary,
                width: 16,
                height: 16,
              }
            : undefined,
      };
      return edge;
    });
    // Paint highlighted edges last so their label pills sit on top
    // (SVG has no z-index; document order is the stacking order).
    list.sort((a, b) => {
      const ha = a.className?.includes("flow-edge--hi") ? 1 : 0;
      const hb = b.className?.includes("flow-edge--hi") ? 1 : 0;
      return ha - hb;
    });
    return list;
  }, [activeHover, resolved]);

  return (
    <div className="flow-canvas" data-testid="flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={resolved}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesConnectable={false}
        onNodesChange={onNodesChange}
        onNodeMouseEnter={(_, node) => setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(null)}
        onMove={(_, viewport) => onZoom(viewport.zoom)}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="var(--sp-color-border-subtle)"
        />
      </ReactFlow>
    </div>
  );
}
