import { KindGlyph } from "./SpecBox";
import { TOOLS, toolTitle, type ToolId } from "./tools";
import { setTool, showToast, useModel } from "../model/store";
import "./ToolPalette.css";

function SelectGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M6 3.2 14.8 10l-5.4.7-1.9 5L6 3.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PanGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M7 9.5V5.2a1.2 1.2 0 0 1 2.4 0v3.6V4.4a1.2 1.2 0 0 1 2.4 0v4.4V6a1.2 1.2 0 0 1 2.4 0v5.4c0 3-1.8 5.4-4.8 5.4-2.2 0-3.4-1-4.4-2.8L3 10.6c-.5-.9.6-1.8 1.4-1l1.6 1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ConnectGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.6" y="7" width="5.4" height="5.4" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="12" y="7.6" width="5.4" height="5.4" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 9.7h4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.6 8.2 12.2 9.7l-1.6 1.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NoteGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.5 3.5h9l2.5 2.5v10.5h-11.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M13.5 3.5V6.5H16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M7 10h6M7 12.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function FlowGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="4.6" cy="10" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15.4" cy="5.4" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15.4" cy="14.6" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.6 9.2 13 6.2M6.6 10.8l6.4 3" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function glyphFor(id: ToolId) {
  switch (id) {
    case "select":
      return <SelectGlyph />;
    case "pan":
      return <PanGlyph />;
    case "connect":
      return <ConnectGlyph />;
    case "note":
      return <NoteGlyph />;
    case "flow":
      return <FlowGlyph />;
    case "add-system":
      return <KindGlyph kind="system" size={20} />;
    case "add-app":
      return <KindGlyph kind="app" size={20} />;
    case "add-component":
      return <KindGlyph kind="component" size={20} />;
    case "add-store":
      return <KindGlyph kind="store" size={20} />;
    case "add-actor":
      return <KindGlyph kind="actor" size={20} />;
    case "add-group":
      return <KindGlyph kind="group" size={20} />;
  }
}

const GROUPS: ToolId[][] = [
  ["select"],
  ["pan"],
  ["add-system", "add-app", "add-component", "add-store", "add-actor", "add-group"],
  ["connect"],
  ["note"],
  ["flow"],
];

export default function ToolPalette() {
  const tool = useModel().tool;

  const activate = (id: ToolId) => {
    if (id === "note") {
      showToast("Sticky notes arrive in a later update", false);
      setTool("select");
      return;
    }
    if (id === "flow") {
      showToast("Flows arrive in the next update", false);
      setTool("select");
      return;
    }
    setTool(id);
  };

  return (
    <div className="tool-bar" data-testid="toolbar" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {GROUPS.map((g, i) => (
        <div key={i}>
          {i > 0 && <span className="tool-bar__divider" aria-hidden="true" />}
          <div className="tool-bar__group" role="group">
            {g.map((id) => {
              const def = TOOLS.find((t) => t.id === id)!;
              const active = tool === id;
              const title = toolTitle(id);
              const addKind = def.kind;
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`tool-${id}`}
                  className={`tool-bar__btn${active ? " tool-bar__btn--active" : ""}`}
                  aria-pressed={active}
                  aria-label={title}
                  title={title}
                  draggable={addKind != null}
                  onDragStart={
                    addKind != null
                      ? (e) => {
                          e.dataTransfer.setData("application/x-speculum-kind", addKind);
                          e.dataTransfer.effectAllowed = "copy";
                        }
                      : undefined
                  }
                  onClick={() => activate(id)}
                >
                  <span className="tool-bar__glyph" aria-hidden="true">
                    {glyphFor(id)}
                  </span>
                  <span className="tool-bar__tip" aria-hidden="true">
                    <span className="tool-bar__tip-name">{def.label}</span>
                    <span className="tool-bar__tip-key">{def.shortcut}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
