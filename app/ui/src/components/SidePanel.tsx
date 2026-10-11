import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import {
  KIND_LABELS,
  canContain,
  deleteConnectionFromModel,
  deleteFromModel,
  flowsUsingConnection,
  hideConnection,
  lowerConnections,
  patchConnection,
  showExistingConnection,
  useDoc,
  useModel,
  useSelectedEdgeState,
  useSelection,
  useView,
  zoomInto,
} from "../model/store";
import type { Connection } from "../model/types";
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

const DIRECTIONS = ["outgoing", "bidirectional", "none"] as const;
const DIRECTION_LABEL: Record<string, string> = {
  outgoing: "Outgoing",
  bidirectional: "Bidirectional",
  none: "None",
};
const SHAPES = ["curved", "straight", "square"] as const;
const SHAPE_LABEL: Record<string, string> = {
  curved: "Curved",
  straight: "Straight",
  square: "Square",
};

/** Text field with debounced PatchConnection (history merges within 1s). */
function EdgeTextField({
  connId,
  field,
  label,
  value,
  testId,
  textarea,
}: {
  connId: string;
  field: "name" | "description";
  label: string;
  value: string;
  testId: string;
  textarea?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [connId, field, value]);
  useEffect(() => {
    if (draft === value) return;
    const t = window.setTimeout(() => {
      void patchConnection(connId, { [field]: draft } as never);
    }, 800);
    return () => window.clearTimeout(t);
  }, [draft, connId, field, value]);
  const flush = () => {
    if (draft !== value) void patchConnection(connId, { [field]: draft } as never);
  };
  const shared = {
    className: "sidepanel__input",
    "data-testid": testId,
    "aria-label": label,
    value: draft,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: flush,
    onKeyDown: (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter" && !textarea) flush();
      if (e.key === "Escape") setDraft(value);
    },
  };
  return (
    <label className="sidepanel__label">
      <span className="sidepanel__label-text">{label}</span>
      {textarea ? (
        <textarea {...shared} rows={3} />
      ) : (
        <input {...shared} type="text" />
      )}
    </label>
  );
}

function EdgeDetails({ conn }: { conn: Connection }) {
  const doc = useDoc();
  const view = useView();
  const selectedEdge = useSelectedEdgeState();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const diagramId = view?.diagram.id ?? null;
  const originName = doc.model.objects[conn.originId]?.name ?? conn.originId;
  const targetName = doc.model.objects[conn.targetId]?.name ?? conn.targetId;
  const flows = flowsUsingConnection(conn.id);
  const stepCount = flows.reduce((n, f) => n + f.steps.length, 0);
  const lower =
    selectedEdge != null && selectedEdge.connIds.length > 1 && diagramId != null
      ? lowerConnections(diagramId, selectedEdge.connIds)
      : [];
  const objects = Object.values(doc.model.objects).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const tags = Object.values(doc.model.tags).sort((a, b) => a.index - b.index);

  return (
    <div data-testid="edge-details">
      <span className="sidepanel__kind">Link</span>
      <h3 className="sidepanel__name" data-testid="edge-details-title">
        {conn.name === "" ? "(unnamed link)" : conn.name}
      </h3>
      <p className="sidepanel__caption" data-testid="edge-details-ends">
        {originName} → {targetName}
      </p>

      <div className="sidepanel__fields">
        <EdgeTextField
          connId={conn.id}
          field="name"
          label="Name"
          value={conn.name}
          testId="edge-name-input"
        />
        <EdgeTextField
          connId={conn.id}
          field="description"
          label="Description"
          value={conn.description}
          testId="edge-desc-input"
          textarea
        />
        <div className="sidepanel__label">
          <span className="sidepanel__label-text">Direction</span>
          <div
            className="sidepanel__segmented"
            role="group"
            aria-label="Direction"
            data-testid="edge-direction"
          >
            {DIRECTIONS.map((d) => (
              <button
                key={d}
                type="button"
                data-testid={`edge-direction-${d}`}
                aria-pressed={conn.direction === d}
                className={
                  "sidepanel__segment" +
                  (conn.direction === d ? " sidepanel__segment--on" : "")
                }
                onClick={() => void patchConnection(conn.id, { direction: d })}
              >
                {DIRECTION_LABEL[d]}
              </button>
            ))}
          </div>
        </div>
        <label className="sidepanel__label">
          <span className="sidepanel__label-text">Status</span>
          <select
            className="sidepanel__input"
            data-testid="edge-status"
            aria-label="Status"
            value={conn.status}
            onChange={(e) =>
              void patchConnection(conn.id, {
                status: e.target.value as Connection["status"],
              })
            }
          >
            {(["live", "future", "deprecated", "removed"] as const).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s] ?? s}
              </option>
            ))}
          </select>
        </label>
        <div className="sidepanel__label">
          <span className="sidepanel__label-text">Line shape</span>
          <div
            className="sidepanel__segmented"
            role="group"
            aria-label="Line shape"
            data-testid="edge-shape"
          >
            {SHAPES.map((s) => (
              <button
                key={s}
                type="button"
                data-testid={`edge-shape-${s}`}
                aria-pressed={conn.lineShape === s}
                className={
                  "sidepanel__segment" +
                  (conn.lineShape === s ? " sidepanel__segment--on" : "")
                }
                onClick={() => void patchConnection(conn.id, { lineShape: s })}
              >
                {SHAPE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <label className="sidepanel__label">
          <span className="sidepanel__label-text">Via object</span>
          <select
            className="sidepanel__input"
            data-testid="edge-via"
            aria-label="Via object"
            value={conn.viaId ?? ""}
            onChange={(e) =>
              void patchConnection(conn.id, { viaId: e.target.value === "" ? null : e.target.value })
            }
          >
            <option value="">None</option>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        {tags.length > 0 && (
          <div className="sidepanel__label">
            <span className="sidepanel__label-text">Tags</span>
            <div className="sidepanel__tags" data-testid="edge-tags">
              {tags.map((t) => {
                const on = conn.tagIds.includes(t.id);
                return (
                  <label key={t.id} className="sidepanel__tagcheck">
                    <input
                      type="checkbox"
                      data-testid={`edge-tag-${t.id}`}
                      checked={on}
                      onChange={() => {
                        const next = on
                          ? conn.tagIds.filter((x) => x !== t.id)
                          : [...conn.tagIds, t.id];
                        void patchConnection(conn.id, { tagIds: next });
                      }}
                    />
                    <TagPill label={t.name} color={toTagColor(t.color)} />
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {lower.length > 1 && (
        <section className="sidepanel__section" aria-label="Lower connections">
          <h4 className="sidepanel__section-title">Show lower connections</h4>          <ul className="sidepanel__lower" data-testid="edge-lower-list">
            {lower.map((l) => (
              <li key={l.id} className="sidepanel__lower-item">
                <span className="sidepanel__lower-name" title={`${l.originName} → ${l.targetName}`}>
                  {l.name === "" ? "(unnamed link)" : l.name}
                </span>
                {l.addable && diagramId != null ? (
                  <Button
                    variant="secondary"
                    data-testid={`edge-lower-add-${l.id}`}
                    onClick={() => void showExistingConnection(diagramId, l.id)}
                  >
                    Add to this diagram
                  </Button>
                ) : (
                  <span
                    className="sidepanel__lower-reason"
                    data-testid={`edge-lower-reason-${l.id}`}
                  >
                    {l.reason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sidepanel__section" aria-label="Diagram">
        {diagramId != null && (
          <Button
            variant="secondary"
            data-testid="edge-hide"
            onClick={() => void hideConnection(diagramId, conn.id)}
          >
            Hide from this diagram
          </Button>
        )}
      </section>

      <section className="sidepanel__section" aria-label="Danger zone">
        <Button variant="danger" data-testid="edge-delete" onClick={() => setConfirmDelete(true)}>
          Delete from model…
        </Button>
      </section>

      {confirmDelete && (
        <Modal
          title={`Delete “${conn.name === "" ? "unnamed link" : conn.name}” from the model?`}
          body={
            <>
              <p>
                This removes the link from every diagram and deletes:
              </p>
              <ul>
                <li>
                  Steps in {flows.length} flow{flows.length === 1 ? "" : "s"}
                  {flows.length > 0 && ` (${flows.map((f) => f.flowName).join(", ")})`}
                </li>
                <li>
                  {stepCount} step{stepCount === 1 ? "" : "s"}
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
                data-testid="edge-delete-confirm"
                onClick={() => {
                  setConfirmDelete(false);
                  void deleteConnectionFromModel(conn.id);
                }}
              >
                Delete
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

export default function SidePanel({ collapsed, onToggle }: SidePanelProps) {
  const status = useSessionStatus();
  const doc = useDoc();
  const selection = useSelection();
  const selectedEdge = useSelectedEdgeState();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const edgeConn =
    selectedEdge != null ? (doc.model.connections[selectedEdge.connId] as Connection | undefined) : undefined;

  const selectedId = selection.length > 0 ? selection[0] : null;
  const obj = selectedId != null ? doc.model.objects[selectedId] : null;

  // Model scans are memoized: selection changes re-render the panel on
  // every click, and rescanning all objects/connections each time cost
  // real milliseconds at 500+ objects (SPEED part 2: select < 16ms).
  const childCount = useMemo(
    () =>
      obj != null
        ? Object.values(doc.model.objects).filter((o) => o.parentId === obj.id).length
        : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, selectedId],
  );
  const incoming = useMemo(
    () =>
      obj != null
        ? Object.values(doc.model.connections).filter((c) => c.targetId === obj.id).length
        : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, selectedId],
  );
  const outgoing = useMemo(
    () =>
      obj != null
        ? Object.values(doc.model.connections).filter((c) => c.originId === obj.id).length
        : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, selectedId],
  );
  const flowCount = useMemo(
    () => (obj != null ? flowsMentioning(doc, obj.id) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, selectedId],
  );
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

        {edgeConn ? (
          <EdgeDetails conn={edgeConn} />
        ) : obj ? (
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
