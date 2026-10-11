import { useMemo, useState } from "react";
import {
  addExistingToDiagram,
  createBox,
  createBoxAndConnect,
  setQuickAdd,
  useModel,
  KIND_LABELS,
} from "../model/store";
import type { ObjectKind } from "../model/types";
import "./QuickAdd.css";

const KINDS: ObjectKind[] = ["actor", "system", "group", "app", "store", "component"];

export default function QuickAdd() {
  const { quickAdd, doc, view } = useModel();
  const [kind, setKind] = useState<ObjectKind>("system");
  const [name, setName] = useState("");
  const [linkName, setLinkName] = useState("");

  const candidates = useMemo(() => {
    if (view == null) return [];
    const q = name.trim().toLowerCase();
    return Object.values(doc.model.objects)
      .filter((o) => view.diagram.boxes[o.id] == null)
      .filter((o) => q === "" || o.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [doc, view, name]);

  if (quickAdd == null || view == null) return null;
  const linking = quickAdd.pendingLink?.sourceKey;

  const style = {
    left: Math.min(quickAdd.screenX, window.innerWidth - 300),
    top: Math.min(quickAdd.screenY, window.innerHeight - 320),
  };

  const commitCreate = () => {
    const label = KIND_LABELS[kind];
    if (linking != null) {
      // Drop-on-empty-canvas: object + box + link as ONE undo step.
      if (linkName.trim() === "") return;
      void createBoxAndConnect(
        kind,
        name.trim() === "" ? `New ${label}` : name.trim(),
        { x: quickAdd.flowX - 120, y: quickAdd.flowY - 60 },
        linking,
        linkName.trim(),
      );
    } else {
      void createBox(kind, name.trim() === "" ? `New ${label}` : name.trim(), {
        x: quickAdd.flowX - 120,
        y: quickAdd.flowY - 60,
      });
    }
    setQuickAdd(null);
  };

  return (
    <div className="quick-add" style={style} role="dialog" aria-label="Add a box" data-testid="quick-add">
      {linking != null && (
        <div className="quick-add__linking" data-testid="quick-add-linking">
          Link {doc.model.objects[linking]?.name ?? "Parent"} → new box
        </div>
      )}
      <div className="quick-add__types" role="group" aria-label="Box type">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            data-testid={`quick-add-kind-${k}`}
            className={`quick-add__type${kind === k ? " quick-add__type--active" : ""}`}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <input
        className="quick-add__name"
        data-testid="quick-add-name"
        autoFocus={linking == null}
        placeholder={`Name this ${KIND_LABELS[kind].toLowerCase()}…`}
        aria-label="Box name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commitCreate();
          else if (e.key === "Escape") setQuickAdd(null);
        }}
      />
      {linking != null && (
        <input
          className="quick-add__name"
          autoFocus
          placeholder="Name this link…"
          aria-label="Link name"
          data-testid="quick-add-link-name"
          value={linkName}
          onChange={(e) => setLinkName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commitCreate();
            else if (e.key === "Escape") setQuickAdd(null);
          }}
        />
      )}
      {candidates.length > 0 && linking == null && (
        <ul className="quick-add__list" aria-label="Existing objects">
          {candidates.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="quick-add__item"
                onClick={() => {
                  void addExistingToDiagram(o.id, {
                    x: quickAdd.flowX - 120,
                    y: quickAdd.flowY - 60,
                  });
                  setQuickAdd(null);
                }}
              >
                <span className="quick-add__item-kind">{KIND_LABELS[o.type]}</span>
                <span className="quick-add__item-name">{o.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        data-testid="quick-add-create"
        className="quick-add__create"
        onClick={commitCreate}
      >
        Create {KIND_LABELS[kind]}
      </button>
    </div>
  );
}
