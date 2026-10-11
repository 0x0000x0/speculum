import { useEffect, useMemo, useRef, useState } from "react";
import {
  createConnection,
  reuseCandidates,
  setPendingLink,
  showExistingConnection,
  useModel,
} from "../model/store";
import "./ConnectDialog.css";

function objectName(doc: ReturnType<typeof useModel>["doc"], id: string): string {
  return doc.model.objects[id]?.name ?? id;
}

export default function ConnectDialog() {
  const { pendingLink, view, doc } = useModel();
  const [name, setName] = useState("");
  const [pickedReuse, setPickedReuse] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reuse = useMemo(() => {
    if (pendingLink == null || view == null) return [];
    return reuseCandidates(view.diagram.id, pendingLink.sourceKey, pendingLink.targetKey);
  }, [pendingLink, view, doc]);

  useEffect(() => {
    setName("");
    setPickedReuse(null);
    inputRef.current?.focus();
  }, [pendingLink]);

  // Esc anywhere cancels an unnamed link (nothing is created).
  useEffect(() => {
    if (pendingLink == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPendingLink(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pendingLink]);

  if (pendingLink == null || view == null) return null;

  const fromName =
    pendingLink.sourceKey === "__frame__"
      ? (view.scope?.name ?? "Parent")
      : objectName(doc, pendingLink.sourceKey);
  const toName =
    pendingLink.targetKey === "__frame__"
      ? (view.scope?.name ?? "Parent")
      : objectName(doc, pendingLink.targetKey);

  const commit = () => {
    if (pickedReuse != null) {
      void showExistingConnection(view.diagram.id, pickedReuse);
      setPendingLink(null);
      return;
    }
    if (name.trim() === "") return;
    void createConnection(view.diagram.id, pendingLink.sourceKey, pendingLink.targetKey, name.trim());
    setPendingLink(null);
  };

  const style = {
    left: Math.min(pendingLink.screenX, window.innerWidth - 320),
    top: Math.min(pendingLink.screenY, window.innerHeight - 300),
  };

  return (
    <div
      className="connect-dialog"
      style={style}
      role="dialog"
      aria-label="Name the new link"
      data-testid="connect-dialog"
    >
      <div className="connect-dialog__ends" data-testid="connect-dialog-ends">
        {fromName} → {toName}
      </div>
      <input
        ref={inputRef}
        className="connect-dialog__name"
        data-testid="connect-name-input"
        placeholder="Name this link…"
        aria-label="Link name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setPickedReuse(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
        }}
      />
      {reuse.length > 0 && (
        <div className="connect-dialog__reuse">
          <div className="connect-dialog__reuse-title">Or reuse an existing link</div>
          <ul className="connect-dialog__reuse-list" data-testid="connect-reuse-list">
            {reuse.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  data-testid={`connect-reuse-${r.id}`}
                  className={
                    "connect-dialog__reuse-item" +
                    (pickedReuse === r.id ? " connect-dialog__reuse-item--picked" : "")
                  }
                  onClick={() => {
                    setPickedReuse(r.id);
                    setName(r.name);
                  }}
                  title={`${objectName(doc, r.originId)} → ${objectName(doc, r.targetId)} (hidden on this diagram)`}
                >
                  {r.name === "" ? "(unnamed link)" : r.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="connect-dialog__actions">
        <button
          type="button"
          className="connect-dialog__cancel"
          data-testid="connect-cancel"
          onClick={() => setPendingLink(null)}
        >
          Cancel
        </button>
        <button
          type="button"
          className="connect-dialog__create"
          data-testid="connect-create"
          onClick={commit}
          disabled={pickedReuse == null && name.trim() === ""}
        >
          {pickedReuse != null ? "Show on this diagram" : "Create link"}
        </button>
      </div>
    </div>
  );
}
