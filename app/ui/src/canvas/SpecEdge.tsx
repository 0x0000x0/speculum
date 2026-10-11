import { memo } from "react";
import type { EdgeProps } from "@xyflow/react";
import { perfNoteRender } from "../model/store";
import "./SpecEdge.css";

export interface SpecEdgeBadge {
  x: number;
  y: number;
  text: string;
  title: string;
  testId: string;
}

export interface SpecEdgeLabel {
  x: number;
  y: number;
  text: string;
  meta: string | null;
  testId: string;
}

export interface SpecEdgeVia {
  x: number;
  y: number;
  name: string;
  kind: string;
  testId: string;
}

/** Everything FlowCanvas precomputes for one rendered sub-link. */
export interface SpecEdgeData extends Record<string, unknown> {
  d: string;
  startArrow: string | null;
  endArrow: string | null;
  label: SpecEdgeLabel | null;
  badge: SpecEdgeBadge | null;
  via: SpecEdgeVia | null;
  tooltip: string;
  testId: string;
  pathTestId: string;
  mods: string;
  coords: { x1: number; y1: number; x2: number; y2: number };
  fromKey: string;
  toKey: string;
  connIds: string[];
  arrowheads: number;
  parentPort: boolean;
  viaRouted: boolean;
  /** Selected edges show re-point handles at both ends. */
  selected: boolean;
  /** Re-point handle centers (offset outward so they sit clear of boxes). */
  hx1: number;
  hy1: number;
  hx2: number;
  hy2: number;
}

function StoreGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" aria-hidden="true">
      <ellipse cx="7" cy="3.6" rx="4.4" ry="1.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M2.6 3.6v6.8c0 1 2 1.8 4.4 1.8s4.4-.8 4.4-1.8V3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function QueueGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M2 4.5h10M2 7h10M2 9.5h10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ViaGlyph({ kind }: { kind: string }) {
  if (kind === "store") return <StoreGlyph />;
  return <QueueGlyph />;
}

function SpecEdgeInner({ data }: EdgeProps) {
  perfNoteRender("edge");
  const d = data as unknown as SpecEdgeData;
  const c = d.coords;
  return (
    <g
      className={`spec-edge${d.mods}`}
      data-testid={d.testId}
      data-edge={d.testId}
      data-from={d.fromKey}
      data-to={d.toKey}
      data-connections={d.connIds.join(",")}
      data-conn={d.connIds[0] ?? ""}
      data-arrowheads={d.arrowheads}
      data-parent-port={d.parentPort ? "true" : "false"}
      data-via-routed={d.viaRouted ? "true" : "false"}
      data-x1={c.x1}
      data-y1={c.y1}
      data-x2={c.x2}
      data-y2={c.y2}
    >
      {d.tooltip !== "" && <title>{d.tooltip}</title>}
      <path className="spec-edge__halo" d={d.d} />
      <path className="spec-edge__path" d={d.d} data-testid={d.pathTestId} />
      {d.startArrow != null && (
        <polygon
          className="spec-edge__arrow"
          points={d.startArrow}
          data-arrow="start"
          data-testid={`${d.testId}-arrow-start`}
        />
      )}
      {d.endArrow != null && (
        <polygon
          className="spec-edge__arrow"
          points={d.endArrow}
          data-arrow="end"
          data-testid={`${d.testId}-arrow-end`}
        />
      )}
      {d.selected && (
        <g className="spec-edge__handles">
          <circle
            className="spec-edge__handle nodrag"
            cx={d.hx1}
            cy={d.hy1}
            r={7}
            stroke="transparent"
            strokeWidth={8}
            data-testid={`repoint-from-${d.testId}`}
            data-repoint="from"
            data-sub={d.testId}
          />
          <circle
            className="spec-edge__handle nodrag"
            cx={d.hx2}
            cy={d.hy2}
            r={7}
            stroke="transparent"
            strokeWidth={8}
            data-testid={`repoint-to-${d.testId}`}
            data-repoint="to"
            data-sub={d.testId}
          />
        </g>
      )}
      {d.badge != null && (
        <foreignObject
          x={d.badge.x - 26}
          y={d.badge.y - 11}
          width={52}
          height={22}
          className="spec-edge__fo"
        >
          <div className="spec-edge__badgewrap">
            <span
              className="spec-edge__badge"
              data-testid={d.badge.testId}
              title={d.badge.title}
            >
              {d.badge.text}
            </span>
          </div>
        </foreignObject>
      )}
      {d.via != null && (
        <foreignObject
          x={d.via.x - 100}
          y={d.via.y - 13}
          width={200}
          height={26}
          className="spec-edge__fo"
        >
          <div className="spec-edge__viawrap">
            <span
              className="spec-edge__via"
              data-testid={d.via.testId}
              title={`via ${d.via.name}`}
            >
              <span className="spec-edge__via-glyph" aria-hidden="true">
                <ViaGlyph kind={d.via.kind} />
              </span>
              <span className="spec-edge__via-name">{d.via.name}</span>
            </span>
          </div>
        </foreignObject>
      )}
      {d.label != null && (
        <foreignObject
          x={d.label.x - 100}
          y={d.label.y - 20}
          width={200}
          height={40}
          className="spec-edge__fo"
        >
          <div className="spec-edge__labelwrap">
            <span
              className="spec-edge__label spec-edge__label--drag"
              data-testid={d.label.testId}
              data-sub={d.testId}
              title={d.label.text}
            >
              {d.label.text}
              {d.label.meta != null && d.label.meta !== "" && (
                <span className="spec-edge__label-meta">{d.label.meta}</span>
              )}
            </span>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

function specEdgeEqual(prev: Readonly<EdgeProps>, next: Readonly<EdgeProps>): boolean {
  const a = prev.data as unknown as SpecEdgeData;
  const b = next.data as unknown as SpecEdgeData;
  if (prev.selected !== next.selected) return false;
  if (a.d !== b.d) return false;
  if (a.startArrow !== b.startArrow) return false;
  if (a.endArrow !== b.endArrow) return false;
  if (a.mods !== b.mods) return false;
  if (a.tooltip !== b.tooltip) return false;
  if (a.testId !== b.testId) return false;
  if (a.pathTestId !== b.pathTestId) return false;
  if (a.fromKey !== b.fromKey) return false;
  if (a.toKey !== b.toKey) return false;
  if (a.arrowheads !== b.arrowheads) return false;
  if (a.parentPort !== b.parentPort) return false;
  if (a.viaRouted !== b.viaRouted) return false;
  if (a.selected !== b.selected) return false;
  if (a.hx1 !== b.hx1 || a.hy1 !== b.hy1 || a.hx2 !== b.hx2 || a.hy2 !== b.hy2) return false;
  if (a.coords.x1 !== b.coords.x1 || a.coords.y1 !== b.coords.y1 || a.coords.x2 !== b.coords.x2 || a.coords.y2 !== b.coords.y2) return false;
  if (a.connIds.length !== b.connIds.length) return false;
  for (let i = 0; i < a.connIds.length; i++) if (a.connIds[i] !== b.connIds[i]) return false;
  const la = a.label, lb = b.label;
  if ((la == null) !== (lb == null)) return false;
  if (la != null && lb != null && (la.x !== lb.x || la.y !== lb.y || la.text !== lb.text || la.meta !== lb.meta || la.testId !== lb.testId)) return false;
  const ba = a.badge, bb = b.badge;
  if ((ba == null) !== (bb == null)) return false;
  if (ba != null && bb != null && (ba.x !== bb.x || ba.y !== bb.y || ba.text !== bb.text || ba.title !== bb.title)) return false;
  const va = a.via, vb = b.via;
  if ((va == null) !== (vb == null)) return false;
  if (va != null && vb != null && (va.x !== vb.x || va.y !== vb.y || va.name !== vb.name || va.kind !== vb.kind)) return false;
  return true;
}

const SpecEdge = memo(SpecEdgeInner, specEdgeEqual);
export default SpecEdge;
