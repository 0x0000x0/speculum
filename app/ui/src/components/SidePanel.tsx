import { useState } from "react";
import { KIND_LABELS, canContain, deleteFromModel, useModel, zoomInto } from "../model/store";
import { useSessionStatus } from "../session/status";
import TagPill, { toTagColor } from "./TagPill";
import Modal from "./Modal";
import Button from "./Button";
import "./SidePanel.css";

interface SidePanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  live: "Live",
  future: "Future",
  deprecated: "Deprecated",
  removed: "Removed",
};

function flowsMentioning(doc: ReturnType<typeof useModel>["doc"], id: string): number {
  let n = 0;
  // Walk steps structurally (flows are opaque JSON to the canvas).
  const stepTouches = (s: unknown): boolean => {
    if (typeof s !== "object" || s === null) return false;
    const r = s as Record<string, unknown>;
    for (const k of ["originId", "targetId", "objectId", "viaConnectionId"]) {
      if (r[k] === id) return true;
    }
    const paths = r["paths"];
    if (Array.isArray(paths)) {
      for (const p of paths) {
        if (typeof p !== "object" || p === null) continue;
        const steps = (p as Record<string, unknown>)["steps"];
        if (Array.isArray(steps) && steps.some(stepTouches)) return true;
      }
    }
    return false;
  };
  for (const f of Object.values(doc.model.flows)) {
    if (Array.isArray(f.steps) && f.steps.some(stepTouches)) n += 1;
  }
  return n;
}

export default function SidePanel({ collapsed, onToggle }: SidePanelProps) {
  const status = useSessionStatus();
  const { doc, selection } = useModel();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selectedId = selection.length > 0 ? selection[0] : null;
  const obj = selectedId != null ? doc.model.objects[selectedId] : null;

  const childCount =
    obj != null
      ? Object.values(doc.model.objects).filter((o) => o.parentId === obj.id).length
      : 0;
  const incoming =
    obj != null
      ? Object.values(doc.model.connections).filter((c) => c.targetId === obj.id).length
      : 0;
  const outgoing =
    obj != null
      ? Object.values(doc.model.connections).filter((c) => c.originId === obj.id).length
      : 0;
  const flowCount = obj != null ? flowsMentioning(doc, obj.id) : 0;
  const zoomable =
    obj != null && (canContain(obj.type) || childCount > 0);

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

        {obj ? (
          <>
            <span className="sidepanel__kind">{KIND_LABELS[obj.type]}</span>
            <h3 className="sidepanel__name">{obj.name}</h3>
            {obj.caption !== "" && (
              <p className="sidepanel__caption">{obj.caption}</p>
            )}

            <dl className="sidepanel__fields">
              <div className="sidepanel__field-row">
                <dt>Status</dt>
                <dd>{STATUS_LABEL[obj.status] ?? obj.status}</dd>
              </div>
              <div className="sidepanel__field-row">
                <dt>External</dt>
                <dd>{obj.external ? "Yes" : "No"}</dd>
              </div>
              {obj.tagIds.length > 0 && (
                <div className="sidepanel__field-row">
                  <dt>Tags</dt>
                  <dd>
                    <div className="sidepanel__tags">
                      {obj.tagIds.map((tid) => {
                        const t = doc.model.tags[tid];
                        if (!t) return null;
                        return (
                          <TagPill
                            key={tid}
                            label={t.name}
                            color={toTagColor(t.color)}
                          />
                        );
                      })}
                    </div>
                  </dd>
                </div>
              )}
            </dl>

            {obj.description !== "" && (
              <section className="sidepanel__section" aria-label="Description">
                <h4 className="sidepanel__section-title">Description</h4>
                <p className="sidepanel__text">{obj.description}</p>
              </section>
            )}

            <section className="sidepanel__section" aria-label="Model counts">
              <h4 className="sidepanel__section-title">Model</h4>
              <dl className="sidepanel__counts">
                <div className="sidepanel__count-row">
                  <dt>Children</dt>
                  <dd>{childCount}</dd>
                </div>
                <div className="sidepanel__count-row">
                  <dt>Links in</dt>
                  <dd>{incoming}</dd>
                </div>
                <div className="sidepanel__count-row">
                  <dt>Links out</dt>
                  <dd>{outgoing}</dd>
                </div>
                <div className="sidepanel__count-row">
                  <dt>Flows</dt>
                  <dd>{flowCount}</dd>
                </div>
              </dl>
            </section>

            {zoomable && (
              <section className="sidepanel__section" aria-label="Drill down">
                <Button variant="secondary" onClick={() => obj && void zoomInto(obj.id, null)}>
                  Open inside
                </Button>
              </section>
            )}

            <section className="sidepanel__section" aria-label="Danger zone">
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete from model…
              </Button>
            </section>

            {confirmDelete && (
              <Modal
                title={`Delete “${obj.name}” from the model?`}
                body={
                  <>
                    <p>
                      This removes the box from every diagram and deletes:
                    </p>
                    <ul>
                      <li>
                        {childCount} child object{childCount === 1 ? "" : "s"}
                      </li>
                      <li>
                        {incoming + outgoing} connection
                        {incoming + outgoing === 1 ? "" : "s"}
                      </li>
                      <li>
                        Steps in {flowCount} flow{flowCount === 1 ? "" : "s"}
                      </li>
                    </ul>
                    <p>Undo restores everything.</p>
                  </>
                }
                onClose={() => setConfirmDelete(false)}
                actions={
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        setConfirmDelete(false);
                        void deleteFromModel([obj.id]);
                      }}
                    >
                      Delete
                    </Button>
                  </>
                }
              />
            )}
          </>
        ) : (
          <p className="sidepanel__text sidepanel__empty">
            Select an object on the canvas to inspect it.
          </p>
        )}

        <section className="sidepanel__section" aria-label="Document">
          <h4 className="sidepanel__section-title">Document</h4>
          <dl className="sidepanel__counts">
            <div className="sidepanel__count-row">
              <dt>Objects</dt>
              <dd data-testid="panel-count-objects">{status.objects}</dd>
            </div>
            <div className="sidepanel__count-row">
              <dt>Links</dt>
              <dd data-testid="panel-count-links">{status.links}</dd>
            </div>
            <div className="sidepanel__count-row">
              <dt>Flows</dt>
              <dd data-testid="panel-count-flows">{status.flows}</dd>
            </div>
          </dl>
        </section>
      </div>
    </aside>
  );
}
