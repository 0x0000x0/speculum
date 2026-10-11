import { useEffect, useMemo, useRef, useState } from "react";
import { KindGlyph } from "./SpecBox";
import {
  crumbTo,
  goBack,
  goForward,
  openDiagram,
  useModel,
} from "../model/store";
import type { DiagramLevel, ObjectKind } from "../model/types";
import "./BreadcrumbCard.css";

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M9 2.5 4.5 7 9 11.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ForwardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M5 2.5 9.5 7 5 11.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Hand-drawn layers glyph for the unscoped (landscape) root crumb. */
function LandscapeGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M7 1.8 12.2 4.8 7 7.8 1.8 4.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M1.8 7.4 7 10.4l5.2-3M1.8 9.8 7 12.8l5.2-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const LEVEL_LABEL: Record<DiagramLevel, string> = {
  context: "Context",
  app: "App",
  component: "Component",
};

interface CardCrumb {
  id: string;
  name: string;
  kind: ObjectKind | null;
}

/**
 * Floating breadcrumb card at the canvas top-left (spec 4.8): back/forward
 * arrows, a divider, then kind-icon crumbs with chevrons. The last crumb
 * opens the diagram switcher menu; long paths collapse into a "…" menu.
 */
export default function BreadcrumbCard() {
  const { diagrams, diagramId, view, doc, navStack, navIndex } = useModel();
  const [menuOpen, setMenuOpen] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen && !hiddenOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
      if (!hiddenRef.current?.contains(e.target as Node)) setHiddenOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setHiddenOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, hiddenOpen]);

  // Same trail as the top bar used to show: root context diagram, then one
  // diagram per scope ancestor, then the current diagram.
  const crumbs: CardCrumb[] = useMemo(() => {
    if (view == null) return [];
    const byScope = new Map<string, { id: string; name: string; order: number }>();
    for (const d of diagrams) {
      if (d.scopeObjectId == null) continue;
      const prev = byScope.get(d.scopeObjectId);
      if (
        prev == null ||
        d.order < prev.order ||
        (d.order === prev.order && d.name < prev.name)
      ) {
        byScope.set(d.scopeObjectId, { id: d.id, name: d.name, order: d.order });
      }
    }
    const kindOf = (diagramId: string): ObjectKind | null => {
      const dd = diagrams.find((x) => x.id === diagramId);
      const scope = dd?.scopeObjectId ?? null;
      if (scope == null) return null;
      return doc.model.objects[scope]?.type ?? null;
    };
    const out: CardCrumb[] = [];
    const roots = diagrams
      .filter((d) => d.scopeObjectId == null)
      .sort((a, b) =>
        a.order === b.order
          ? a.name === b.name
            ? a.id.localeCompare(b.id)
            : a.name.localeCompare(b.name)
          : a.order - b.order,
      );
    const chainIds = view.breadcrumb.map((b) => b.id);
    if (roots.length > 0 && !chainIds.includes(roots[0].id)) {
      if (roots[0].id !== view.diagram.id) {
        out.push({ id: roots[0].id, name: roots[0].name, kind: kindOf(roots[0].id) });
      }
    }
    for (const b of view.breadcrumb) {
      const match = byScope.get(b.id);
      if (match && !out.some((c) => c.id === match.id)) {
        out.push({ id: match.id, name: match.name, kind: kindOf(match.id) });
      }
    }
    if (!out.some((c) => c.id === view.diagram.id)) {
      out.push({ id: view.diagram.id, name: view.diagram.name, kind: kindOf(view.diagram.id) });
    }
    return out;
  }, [view, diagrams, doc]);

  const MAX_CRUMBS = 4;
  const visibleCrumbs: (CardCrumb | null)[] = useMemo(() => {
    if (crumbs.length <= MAX_CRUMBS) return crumbs;
    return [crumbs[0], null, ...crumbs.slice(crumbs.length - 2)];
  }, [crumbs]);
  const hiddenCrumbs = useMemo(() => {
    if (crumbs.length <= MAX_CRUMBS) return [];
    return crumbs.slice(1, crumbs.length - 2);
  }, [crumbs]);

  const grouped = (["context", "app", "component"] as DiagramLevel[])
    .map((level) => ({
      level,
      items: diagrams.filter((d) => d.level === level),
    }))
    .filter((g) => g.items.length > 0);

  const canBack = navIndex > 0;
  const canForward = navIndex >= 0 && navIndex < navStack.length - 1;

  if (view == null) return null;

  const iconOf = (c: CardCrumb) =>
    c.kind != null ? (
      <KindGlyph kind={c.kind} size={13} />
    ) : (
      <LandscapeGlyph />
    );

  return (
    <nav className="crumb-card" data-testid="breadcrumb-card" aria-label="Breadcrumb">
      <div className="crumb-card__nav" role="group" aria-label="Navigate">
        <button
          type="button"
          data-testid="nav-back"
          className="crumb-card__btn"
          aria-label="Back"
          title="Back (Alt+Left)"
          disabled={!canBack}
          onClick={() => void goBack()}
        >
          <BackIcon />
        </button>
        <button
          type="button"
          data-testid="nav-forward"
          className="crumb-card__btn"
          aria-label="Forward"
          title="Forward (Alt+Right)"
          disabled={!canForward}
          onClick={() => void goForward()}
        >
          <ForwardIcon />
        </button>
      </div>
      <span className="crumb-card__divider" aria-hidden="true" />
      <ol className="crumb-card__crumbs" data-testid="breadcrumb">
        {visibleCrumbs.map((c, i) =>
          c == null ? (
            <li key="ellipsis" className="crumb-card__item">
              <div className="crumb-card__menu-wrap" ref={hiddenRef}>
                <button
                  type="button"
                  className="crumb-card__crumb crumb-card__crumb--ellipsis"
                  aria-haspopup="menu"
                  aria-expanded={hiddenOpen}
                  aria-label="Hidden levels"
                  title="Hidden levels"
                  onClick={() => setHiddenOpen((o) => !o)}
                >
                  …
                </button>
                {hiddenOpen && (
                  <div className="crumb-card__menu" role="menu" aria-label="Hidden levels">
                    {hiddenCrumbs.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        role="menuitem"
                        data-testid={`crumb-${h.id}`}
                        className="crumb-card__menu-item"
                        onClick={() => {
                          setHiddenOpen(false);
                          void crumbTo(h.id);
                        }}
                      >
                        {h.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="crumb-card__sep" aria-hidden="true">
                ›
              </span>
            </li>
          ) : (
            <li key={c.id} className="crumb-card__item">
              {i === visibleCrumbs.length - 1 ? (
                <div className="crumb-card__menu-wrap" ref={menuRef}>
                  <button
                    type="button"
                    data-testid={`crumb-${c.id}`}
                    className="crumb-card__menu-btn"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    title="Switch diagram"
                    onClick={() => setMenuOpen((o) => !o)}
                  >
                    <span className="crumb-card__icon" aria-hidden="true">
                      {iconOf(c)}
                    </span>
                    <span className="crumb-card__crumb crumb-card__crumb--current">
                      {c.name}
                    </span>
                    <span className="crumb-card__sep" aria-hidden="true">
                      ▾
                    </span>
                  </button>
                  {menuOpen && (
                    <div className="crumb-card__menu" role="menu" aria-label="Diagrams">
                      {grouped.map((g) => (
                        <div key={g.level} className="crumb-card__menu-group">
                          <div className="crumb-card__menu-title">
                            {LEVEL_LABEL[g.level]}
                          </div>
                          {g.items.map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              role="menuitem"
                              className={`crumb-card__menu-item${d.id === diagramId ? " crumb-card__menu-item--current" : ""}`}
                              aria-current={d.id === diagramId ? "page" : undefined}
                              onClick={() => {
                                setMenuOpen(false);
                                void openDiagram(d.id);
                              }}
                            >
                              {d.name}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  data-testid={`crumb-${c.id}`}
                  className="crumb-card__crumb crumb-card__crumb--link"
                  title={c.name}
                  onClick={() => void crumbTo(c.id)}
                >
                  <span className="crumb-card__icon" aria-hidden="true">
                    {iconOf(c)}
                  </span>
                  <span className="crumb-card__text">{c.name}</span>
                </button>
              )}
              {i < visibleCrumbs.length - 1 && (
                <span className="crumb-card__sep" aria-hidden="true">
                  ›
                </span>
              )}
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}
