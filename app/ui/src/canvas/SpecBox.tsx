import { Handle, Position, type NodeProps } from "@xyflow/react";
import { KIND_LABELS, type SampleKind, type SampleTag } from "../data/sample";
import TagPill from "../components/TagPill";
import "./SpecBox.css";

export interface SpecBoxData extends Record<string, unknown> {
  kind: SampleKind;
  title: string;
  caption: string;
  tags: SampleTag[];
  external?: boolean;
  children?: number;
}

/**
 * C4-style box node for the M3 demo canvas.
 * Colours, radii and type all come from token variables (SpecBox.css).
 */
export default function SpecBox({ data }: NodeProps) {
  const d = data as unknown as SpecBoxData;

  return (
    <div className={`spec-box${d.external ? " spec-box--external" : ""}`}>
      <Handle
        type="target"
        position={Position.Top}
        id="in-top"
        className="spec-box__handle"
        aria-label="Input top"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="in-left"
        className="spec-box__handle"
        aria-label="Input left"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="in-bottom"
        className="spec-box__handle"
        aria-label="Input bottom"
      />
      <Handle
        type="target"
        position={Position.Right}
        id="in-right"
        className="spec-box__handle"
        aria-label="Input right"
      />
      <div className="spec-box__top">
        <span className="spec-box__kind">{KIND_LABELS[d.kind]}</span>
        {typeof d.children === "number" && (
          <span
            className="spec-box__badge"
            title={`${d.children} contained objects`}
            aria-label={`${d.children} contained objects`}
          >
            {d.children}
          </span>
        )}
      </div>
      <div className="spec-box__title">{d.title}</div>
      <div className="spec-box__caption">{d.caption}</div>
      {d.tags.length > 0 && (
        <div className="spec-box__tags">
          {d.tags.slice(0, 2).map((t) => (
            <TagPill key={t.label} label={t.label} color={t.color} />
          ))}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Top}
        id="out-top"
        className="spec-box__handle"
        aria-label="Output top"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="out-bottom"
        className="spec-box__handle"
        aria-label="Output bottom"
      />
      <Handle
        type="source"
        position={Position.Left}
        id="out-left"
        className="spec-box__handle"
        aria-label="Output left"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out-right"
        className="spec-box__handle"
        aria-label="Output right"
      />
    </div>
  );
}
