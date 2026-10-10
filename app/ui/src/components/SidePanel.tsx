import { KIND_LABELS, type SampleNode } from "../data/sample";
import { useSessionStatus } from "../session/status";
import TagPill from "./TagPill";
import "./SidePanel.css";

interface SidePanelProps {
  node: SampleNode | null;
  collapsed: boolean;
  onToggle: () => void;
}

export default function SidePanel({ node, collapsed, onToggle }: SidePanelProps) {
  const status = useSessionStatus();
  const shown: SampleNode | null = node;

  return (
    <aside
      className={`sidepanel${collapsed ? " sidepanel--collapsed" : ""}`}
      aria-label="Details panel"
      aria-expanded={!collapsed}
    >
      <div className="sidepanel__inner">
        <div className="sidepanel__header">
          <h2 className="sidepanel__title">Details</h2>
          <button
            type="button"
            className="sidepanel__collapse"
            onClick={onToggle}
            aria-label={collapsed ? "Expand details panel" : "Collapse details panel"}
            title="Toggle panel (Ctrl+B)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d={collapsed ? "M5 2.5 9.5 7 5 11.5" : "M9 2.5 4.5 7 9 11.5"}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {shown ? (
          <>
            <span className="sidepanel__kind">{KIND_LABELS[shown.kind]}</span>
            <h3 className="sidepanel__name">{shown.title}</h3>
            <p className="sidepanel__caption">{shown.caption}</p>

            {shown.tags.length > 0 && (
              <section className="sidepanel__section" aria-label="Tags">
                <h4 className="sidepanel__section-title">Tags</h4>
                <div className="sidepanel__tags">
                  {shown.tags.map((t) => (
                    <TagPill key={t.label} label={t.label} color={t.color} />
                  ))}
                </div>
              </section>
            )}

            <section className="sidepanel__section" aria-label="Description">
              <h4 className="sidepanel__section-title">Description</h4>
              <p className="sidepanel__text">{shown.description}</p>
            </section>
          </>
        ) : (
          <p className="sidepanel__text sidepanel__empty">
            Select an object on the canvas to inspect it.
          </p>
        )}

        <section className="sidepanel__section" aria-label="Model">
          <h4 className="sidepanel__section-title">Model</h4>
          <dl className="sidepanel__counts">
            <div className="sidepanel__count-row">
              <dt>Objects</dt>
              <dd>{status.objects}</dd>
            </div>
            <div className="sidepanel__count-row">
              <dt>Links</dt>
              <dd>{status.links}</dd>
            </div>
            <div className="sidepanel__count-row">
              <dt>Flows</dt>
              <dd>{status.flows}</dd>
            </div>
          </dl>
        </section>
      </div>
    </aside>
  );
}
