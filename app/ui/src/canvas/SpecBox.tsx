import { memo, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ObjectKind, Status } from "../model/types";
import { KIND_LABELS } from "../model/store";
import TagPill, { type TagColor } from "../components/TagPill";
import "./SpecBox.css";

export type ZoomTier = "near" | "mid" | "far";

export interface SpecBoxTag {
  label: string;
  color: TagColor;
}

export interface SpecBoxData extends Record<string, unknown> {
  boxId: string;
  kind: ObjectKind;
  name: string;
  caption: string;
  tags: SpecBoxTag[];
  external?: boolean;
  status?: Status;
  childCount?: number;
  /** True when "Open inside" can create or open a lower diagram. */
  zoomable?: boolean;
  onDrill?: (boxId: string, rect: { x: number; y: number; w: number; h: number } | null) => void;
  tier: ZoomTier;
  renaming?: boolean;
  onRename?: (name: string) => void;
  onCancelRename?: () => void;
}

function PersonGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="4.4" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M2.4 12.2c.6-2.6 2.4-4 4.6-4s4 1.4 4.6 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WindowGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1.6" y="2.4" width="10.8" height="9.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.6 5.2h10.8" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="3.6" cy="3.8" r="0.7" fill="currentColor" />
      <circle cx="5.6" cy="3.8" r="0.7" fill="currentColor" />
      <circle cx="7.6" cy="3.8" r="0.7" fill="currentColor" />
    </svg>
  );
}

function CylinderGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <ellipse cx="7" cy="3.6" rx="4.4" ry="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M2.6 3.6v6.8c0 1 2 1.8 4.4 1.8s4.4-.8 4.4-1.8V3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function ComponentGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M2 3.5 3.5 2h7L12 3.5v7L10.5 12h-7L2 10.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="7" r="1.4" fill="currentColor" />
    </svg>
  );
}

function GroupGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1.6" y="3.4" width="10.8" height="8.2" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.4 1.8" />
      <path d="M1.6 3.4 3 1.8h4l1.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function SystemGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1.6" y="2" width="10.8" height="10" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.6 5h10.8" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** Hand-drawn zoom-in glyph for the drill badge (magnifier + plus). */
function ZoomInGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M7.6 7.6 10.8 10.8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M5 3.4v3.2M3.4 5h3.2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function KindGlyph({ kind }: { kind: ObjectKind }) {
  switch (kind) {
    case "actor":
      return <PersonGlyph />;
    case "app":
      return <WindowGlyph />;
    case "store":
      return <CylinderGlyph />;
    case "component":
      return <ComponentGlyph />;
    case "group":
      return <GroupGlyph />;
    case "system":
      return <SystemGlyph />;
  }
}

const STATUS_LABEL: Record<string, string> = {
  future: "Future",
  deprecated: "Deprecated",
  removed: "Removed",
};

function SpecBoxInner({ data }: NodeProps) {
  const d = data as unknown as SpecBoxData;
  const [draft, setDraft] = useState(d.name);

  useEffect(() => {
    if (d.renaming) setDraft(d.name);
  }, [d.renaming, d.name]);

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (d.renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [d.renaming]);

  if (d.tier === "far") {
    return (
      <div
        className={`spec-box spec-box--far spec-box--kind-${d.kind}`}
        data-testid={`box-${(data as Record<string, unknown>).__boxId as string}`}
      >
        <Handle type="target" position={Position.Top} id="in-top" className="spec-box__handle" aria-label="Input top" />
        <Handle type="source" position={Position.Bottom} id="out-bottom" className="spec-box__handle" aria-label="Output bottom" />
      </div>
    );
  }

  const cls = [
    "spec-box",
    `spec-box--kind-${d.kind}`,
    d.external ? "spec-box--external" : "",
    d.status && d.status !== "live" ? `spec-box--status-${d.status}` : "",
    d.tier === "mid" ? "spec-box--mid" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} data-testid={`box-${(data as Record<string, unknown>).__boxId as string}`}>
      <Handle type="target" position={Position.Top} id="in-top" className="spec-box__handle" aria-label="Input top" />
      <Handle type="target" position={Position.Left} id="in-left" className="spec-box__handle" aria-label="Input left" />
      <Handle type="target" position={Position.Bottom} id="in-bottom" className="spec-box__handle" aria-label="Input bottom" />
      <Handle type="target" position={Position.Right} id="in-right" className="spec-box__handle" aria-label="Input right" />
      {d.kind === "system" && <div className="spec-box__accent-bar" aria-hidden="true" />}
      {d.kind === "group" && (
        <div className="spec-box__tab" aria-hidden="true">
          <span className="spec-box__tab-glyph">
            <GroupGlyph />
          </span>
        </div>
      )}
      <div className="spec-box__top">
        <span className="spec-box__kind">
          <span className="spec-box__glyph" aria-hidden="true">
            <KindGlyph kind={d.kind} />
          </span>
          {KIND_LABELS[d.kind]}
        </span>
        <span className="spec-box__top-right">
          {d.zoomable && (
            <button
              type="button"
              data-testid={`drill-${d.boxId}`}
              className={
                "spec-box__drill nodrag" +
                (typeof d.childCount === "number" && d.childCount > 0
                  ? ""
                  : " spec-box__drill--faint")
              }
              aria-label={`Open inside ${d.name}`}
              onClick={(e) => {
                e.stopPropagation();
                const node = (e.currentTarget as HTMLElement).closest(
                  ".react-flow__node",
                );
                const r = node?.getBoundingClientRect() ?? null;
                d.onDrill?.(
                  d.boxId,
                  r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
                );
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <span className="spec-box__drill-glyph" aria-hidden="true">
                <ZoomInGlyph />
              </span>
              {typeof d.childCount === "number" && d.childCount > 0 && (
                <span className="spec-box__drill-count">{d.childCount}</span>
              )}
            </button>
          )}
          {d.status != null && d.status !== "live" && (
            <span className={`spec-box__status spec-box__status--${d.status}`}>
              {STATUS_LABEL[d.status]}
            </span>
          )}
        </span>
      </div>
      {d.renaming ? (
        <input
          ref={inputRef}
          className="spec-box__rename nodrag"
          value={draft}
          aria-label="Rename box"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") d.onRename?.(draft);
            else if (e.key === "Escape") d.onCancelRename?.();
          }}
          onBlur={() => d.onRename?.(draft)}
        />
      ) : (
        <div className="spec-box__title">{d.name}</div>
      )}
      {d.tier === "near" && d.caption !== "" && (
        <div className="spec-box__caption">{d.caption}</div>
      )}
      {d.external && <span className="spec-box__external-chip">External</span>}
      {d.tier === "near" && d.tags.length > 0 && (
        <div className="spec-box__tags">
          {d.tags.slice(0, 3).map((t) => (
            <TagPill key={t.label} label={t.label} color={t.color} />
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Top} id="out-top" className="spec-box__handle" aria-label="Output top" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="spec-box__handle" aria-label="Output bottom" />
      <Handle type="source" position={Position.Left} id="out-left" className="spec-box__handle" aria-label="Output left" />
      <Handle type="source" position={Position.Right} id="out-right" className="spec-box__handle" aria-label="Output right" />
    </div>
  );
}

const SpecBox = memo(SpecBoxInner);
export default SpecBox;
