import { useReactFlow } from "@xyflow/react";
import { ZOOM_TOOLS, zoomTitle } from "./tools";
import { prefersReducedMotion } from "../model/store";
import "./ToolPalette.css";

function MinusGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function FitGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M1.8 4V1.8H4M8 1.8h2.2V4M10.2 8v2.2H8M4 10.2H1.8V8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ZoomGroup({
  zoom,
  onFit,
}: {
  zoom: number;
  onFit: () => void;
}) {
  const instance = useReactFlow();
  const pct = `${Math.round(zoom * 100)}%`;

  const reset = () => {
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
  };

  return (
    <div className="zoom-group" data-testid="zoom-group" role="group" aria-label="Zoom">
      <button
        type="button"
        data-testid="zoom-out"
        className="zoom-group__btn"
        aria-label={zoomTitle("zoom-out")}
        title={zoomTitle("zoom-out")}
        onClick={() => {
          try {
            void instance.zoomOut({ duration: prefersReducedMotion() ? 0 : 200 });
          } catch {
            /* canvas not ready */
          }
        }}
      >
        <MinusGlyph />
        <span className="zoom-group__tip" aria-hidden="true">
          {ZOOM_TOOLS[0].label} <span className="zoom-group__tip-key">{ZOOM_TOOLS[0].shortcut}</span>
        </span>
      </button>
      <button
        type="button"
        data-testid="zoom-pct"
        className="zoom-group__btn"
        aria-label={zoomTitle("zoom-pct")}
        title={zoomTitle("zoom-pct")}
        onClick={reset}
      >
        {pct}
        <span className="zoom-group__tip" aria-hidden="true">
          {ZOOM_TOOLS[1].label} <span className="zoom-group__tip-key">{ZOOM_TOOLS[1].shortcut}</span>
        </span>
      </button>
      <button
        type="button"
        data-testid="zoom-in"
        className="zoom-group__btn"
        aria-label={zoomTitle("zoom-in")}
        title={zoomTitle("zoom-in")}
        onClick={() => {
          try {
            void instance.zoomIn({ duration: prefersReducedMotion() ? 0 : 200 });
          } catch {
            /* canvas not ready */
          }
        }}
      >
        <PlusGlyph />
        <span className="zoom-group__tip" aria-hidden="true">
          {ZOOM_TOOLS[2].label} <span className="zoom-group__tip-key">{ZOOM_TOOLS[2].shortcut}</span>
        </span>
      </button>
      <button
        type="button"
        data-testid="fit-screen"
        className="zoom-group__btn"
        aria-label={zoomTitle("fit-screen")}
        title={zoomTitle("fit-screen")}
        onClick={onFit}
      >
        <FitGlyph />
        <span className="zoom-group__tip" aria-hidden="true">
          {ZOOM_TOOLS[3].label} <span className="zoom-group__tip-key">{ZOOM_TOOLS[3].shortcut}</span>
        </span>
      </button>
    </div>
  );
}
