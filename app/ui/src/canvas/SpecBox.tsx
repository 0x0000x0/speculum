import { memo, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ObjectKind, Status } from "../model/types";
import { KIND_LABELS, perfNoteRender } from "../model/store";
import type { TagColor } from "../components/TagPill";
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
  /** Wide 220x110 landscape variant (caption + [Kind: tech] footer). */
  wide?: boolean;
  /** First technology string for the wide-variant footer. */
  tech?: string;
  /** Full description (tooltip + details panel only, never in the box). */
  description?: string;
  onDrill?: (boxId: string, rect: { x: number; y: number; w: number; h: number } | null) => void;
  tier: ZoomTier;
  /** Perf regime (many boxes, zoomed out): single-element DOM, no icons/handles. */
  lite?: boolean;
  /** Static hover-overlay clone: visuals only, no handles/dots (they must
   *  not register with React Flow twice). */
  bare?: boolean;
  renaming?: boolean;
  onRename?: (name: string) => void;
  onCancelRename?: () => void;
  /** Ring highlight as the keyboard connect-mode target candidate. */
  candidate?: boolean;
  onConnectStart?: (boxId: string, e: ReactMouseEvent) => void;
}

function PersonGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
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

function WindowGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1.6" y="2.4" width="10.8" height="9.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.6 5.2h10.8" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="3.6" cy="3.8" r="0.7" fill="currentColor" />
      <circle cx="5.6" cy="3.8" r="0.7" fill="currentColor" />
      <circle cx="7.6" cy="3.8" r="0.7" fill="currentColor" />
    </svg>
  );
}

function CylinderGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
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

function ComponentGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
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

function GroupGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1.6" y="3.4" width="10.8" height="8.2" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.6 3.4 3 1.8h4l1.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function SystemGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1.6" y="2" width="10.8" height="10" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.6 5h10.8" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** Hand-drawn expand glyph for the drill badge (four outward arrows). */
function ExpandGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M6 5V1.8M6 5 4.4 3.4M6 5l1.6-1.6M6 7v3.2M6 7 4.4 8.6M6 7l1.6 1.6M5 6H1.8M5 6 3.4 4.4M5 6l-1.6 1.6M7 6h3.2M7 6l1.6-1.6M7 6l1.6 1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function KindGlyph({ kind, size = 14 }: { kind: ObjectKind; size?: number }) {
  switch (kind) {
    case "actor":
      return <PersonGlyph size={size} />;
    case "app":
      return <WindowGlyph size={size} />;
    case "store":
      return <CylinderGlyph size={size} />;
    case "component":
      return <ComponentGlyph size={size} />;
    case "group":
      return <GroupGlyph size={size} />;
    case "system":
      return <SystemGlyph size={size} />;
  }
}

const STATUS_LABEL: Record<string, string> = {
  future: "Future",
  deprecated: "Deprecated",
  removed: "Removed",
};

type DotSide = "top" | "right" | "bottom" | "left";

interface DotSpec {
  side: DotSide;
  frac: number;
  index: number;
}

/** At most one small handle per side (4 total): busy 12-dot rings retired. */
function dotsFor(kind: ObjectKind): DotSpec[] {
  void kind;
  return (["top", "right", "bottom", "left"] as DotSide[]).map((side, index) => ({
    side,
    frac: 0.5,
    index,
  }));
}

function dotStyle(side: DotSide, frac: number): CSSProperties {
  const pct = `${frac * 100}%`;
  switch (side) {
    case "top":
      return { left: pct, top: 0 };
    case "bottom":
      return { left: pct, top: "100%" };
    case "left":
      return { left: 0, top: pct };
    case "right":
      return { left: "100%", top: pct };
  }
}

function SpecBoxInner({ data }: NodeProps) {
  perfNoteRender("box");
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

  // LOD: far zoom draws the name only (no handles/dots/icons/badge) so
  // big fitted levels pan/zoom at ~16ms per frame. Mid zoom keeps the full
  // box (badge included: drills happen there) minus dots/caption/tech,
  // except in the perf regime (lite: >150 boxes) where mid is also a
  // single-element box — the drill badge stays so drills keep working.
  // Near zoom is untouched.
  // Perf regime (lite, any zoomed-out tier incl. far): single element, no
  // handles — the batch edge layer never needs React Flow handles (and
  // 1000 handle registrations doubled the 500-mount commit). The drill
  // badge stays so drills keep working. SPEED part 3.
  if (d.lite === true && d.tier !== "near") {
    const liteKids = typeof d.childCount === "number" && d.childCount > 0;
    return (
      <div
        className={`spec-box spec-box--lite spec-box--kind-${d.kind}`}
        data-testid={d.bare === true ? undefined : `box-${(data as Record<string, unknown>).__boxId as string}`}
        title={d.name}
      >
        {liteKids && (
          <button
            type="button"
            data-testid={d.bare === true ? undefined : `drill-${d.boxId}`}
            className="spec-box__drill spec-box__drill--lite nodrag"
            aria-label={`Open inside ${d.name}`}
            onClick={(e) => {
              e.stopPropagation();
              d.onDrill?.(d.boxId, null);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span className="spec-box__drill-count">{d.childCount}</span>
          </button>
        )}
        <div className="spec-box__title" data-testid={d.bare === true ? undefined : `box-name-${d.boxId}`}>{d.name}</div>
      </div>
    );
  }
  if (d.tier === "far") {
    return (
      <div
        className={`spec-box spec-box--far spec-box--kind-${d.kind}`}
        data-testid={d.bare === true ? undefined : `box-${(data as Record<string, unknown>).__boxId as string}`}
        title={d.name}
      >
        {d.bare !== true && (
          <>
            <Handle type="target" position={Position.Top} id="in-top" className="spec-box__handle" aria-label="Input top" />
            <Handle type="source" position={Position.Bottom} id="out-bottom" className="spec-box__handle" aria-label="Output bottom" />
          </>
        )}
        <div className="spec-box__title" data-testid={d.bare === true ? undefined : `box-name-${d.boxId}`}>{d.name}</div>
      </div>
    );
  }

  const wide = d.wide === true;
  const hasKids = typeof d.childCount === "number" && d.childCount > 0;
  const dotStatus = d.status ?? "live";
  const cls = [
    "spec-box",
    `spec-box--kind-${d.kind}`,
    wide ? "spec-box--wide" : "spec-box--square",
    d.external ? "spec-box--external" : "",
    d.status && d.status !== "live" ? `spec-box--status-${d.status}` : "",
    d.tier === "mid" ? "spec-box--mid" : "",
    d.candidate ? "spec-box--candidate" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Mid zoom: no connection dots (hover dots are hidden below ~0.45
  // zoom); near zoom is untouched.
  const dots = d.tier === "near" ? dotsFor(d.kind) : [];
  const tagStripColor = d.tags.length > 0 ? d.tags[0].color : null;

  const onDrillClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    const node = (e.currentTarget as HTMLElement).closest(
      ".react-flow__node",
    );
    const r = node?.getBoundingClientRect() ?? null;
    d.onDrill?.(
      d.boxId,
      r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
    );
  };

  const renameInput = (
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
  );

  return (
    <>
    <div
      className={cls}
      data-testid={d.bare === true ? undefined : `box-${(data as Record<string, unknown>).__boxId as string}`}
      title={d.description != null && d.description !== "" ? `${d.name} — ${d.description}` : undefined}
    >
      {d.bare !== true && (
        <>
          <Handle type="target" position={Position.Top} id="in-top" className="spec-box__handle" aria-label="Input top" />
          <Handle type="target" position={Position.Left} id="in-left" className="spec-box__handle" aria-label="Input left" />
          <Handle type="target" position={Position.Bottom} id="in-bottom" className="spec-box__handle" aria-label="Input bottom" />
          <Handle type="target" position={Position.Right} id="in-right" className="spec-box__handle" aria-label="Input right" />
        </>
      )}
      {tagStripColor != null && (
        <span
          className="spec-box__tagstrip"
          aria-hidden="true"
          style={{ background: `var(--sp-tag-${tagStripColor}-fg, var(--sp-color-border-strong))` }}
        />
      )}
      <div className="spec-box__top">
        <span className="spec-box__drill-slot">
          {hasKids && (
            <button
              type="button"
              data-testid={d.bare === true ? undefined : `drill-${d.boxId}`}
              className="spec-box__drill nodrag"
              aria-label={`Open inside ${d.name}`}
              onClick={onDrillClick}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <span className="spec-box__drill-glyph" aria-hidden="true">
                <ExpandGlyph />
              </span>
              <span className="spec-box__drill-count">{d.childCount}</span>
            </button>
          )}
        </span>
        <span
          className={`spec-box__dot spec-box__dot--${dotStatus}`}
          data-testid={d.bare === true ? undefined : `status-${d.boxId}`}
          title={STATUS_LABEL[dotStatus] ?? dotStatus}
          aria-label={`Status ${STATUS_LABEL[dotStatus] ?? dotStatus}`}
        />
      </div>
      <div className="spec-box__center">
        <span className="spec-box__icon" aria-hidden="true">
          <KindGlyph kind={d.kind} size={26} />
        </span>
        {d.renaming ? (
          renameInput
        ) : (
          <div className="spec-box__title" data-testid={d.bare === true ? undefined : `box-name-${d.boxId}`}>{d.name}</div>
        )}
      </div>
      {wide && d.tier === "near" && d.caption !== "" && (
        <div className="spec-box__caption">{d.caption}</div>
      )}
      <div className="spec-box__kind" data-testid={d.bare === true ? undefined : `box-kind-${d.boxId}`}>
        {KIND_LABELS[d.kind]}
      </div>
      {wide && d.tier === "near" && (
        <div className="spec-box__tech">
          {`[${KIND_LABELS[d.kind]}${d.tech ? `: ${d.tech}` : ""}]`}
        </div>
      )}
      {d.bare !== true && (
        <>
          <Handle type="source" position={Position.Top} id="out-top" className="spec-box__handle" aria-label="Output top" />
          <Handle type="source" position={Position.Bottom} id="out-bottom" className="spec-box__handle" aria-label="Output bottom" />
          <Handle type="source" position={Position.Left} id="out-left" className="spec-box__handle" aria-label="Output left" />
          <Handle type="source" position={Position.Right} id="out-right" className="spec-box__handle" aria-label="Output right" />
        </>
      )}
    </div>
    {d.bare !== true && dots.length > 0 && (
      <div className="spec-dots" aria-hidden="false">
        {dots.map((dot) => (
          <span
            key={`${dot.side}-${dot.index}`}
            className="spec-dots__dot nodrag"
            data-testid={`conn-dot-${d.boxId}-${dot.side}-${dot.index}`}
            data-dot-side={dot.side}
            data-dot-index={dot.index}
            data-dot-box={d.boxId}
            style={dotStyle(dot.side, dot.frac)}
            title="Drag to connect"
            onMouseDown={(e) => {
              e.stopPropagation();
              d.onConnectStart?.(d.boxId, e);
            }}
          />
        ))}
      </div>
    )}
    </>
  );
}

function specBoxEqual(
  prev: Readonly<NodeProps>,
  next: Readonly<NodeProps>,
): boolean {
  const a = prev.data as unknown as SpecBoxData;
  const b = next.data as unknown as SpecBoxData;
  if (prev.selected !== next.selected) return false;
  if (prev.dragging !== next.dragging) return false;
  if (a.boxId !== b.boxId) return false;
  if (a.kind !== b.kind) return false;
  if (a.name !== b.name) return false;
  if (a.caption !== b.caption) return false;
  if (a.external !== b.external) return false;
  if (a.status !== b.status) return false;
  if (a.childCount !== b.childCount) return false;
  // SPEED part 3: the lite DOM ignores far-vs-mid (single element in both),
  // so a tier flip there is not a render (wheel ticks stay at zero renders).
  const aLiteTier = (a.lite ?? false) && a.tier !== "near" ? "lite" : a.tier;
  const bLiteTier = (b.lite ?? false) && b.tier !== "near" ? "lite" : b.tier;
  if (aLiteTier !== bLiteTier) return false;
  if ((a.lite ?? false) !== (b.lite ?? false)) return false;
  if ((a.bare ?? false) !== (b.bare ?? false)) return false;
  if (a.zoomable !== b.zoomable) return false;
  if (a.wide !== b.wide) return false;
  if (a.tech !== b.tech) return false;
  if (a.description !== b.description) return false;
  if (a.renaming !== b.renaming) return false;
  if (a.candidate !== b.candidate) return false;
  if ((a.tags?.length ?? 0) !== (b.tags?.length ?? 0)) return false;
  for (let i = 0; i < (a.tags?.length ?? 0); i++) {
    if (a.tags[i].label !== b.tags[i].label) return false;
    if (a.tags[i].color !== b.tags[i].color) return false;
  }
  // Callbacks are stable refs looked up by id (never inline closures).
  return true;
}

const SpecBox = memo(SpecBoxInner, specBoxEqual);
export default SpecBox;
