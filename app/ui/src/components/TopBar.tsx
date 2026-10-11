import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme, type ThemeMode } from "../theme/ThemeProvider";
import {
  crumbTo,
  goBack,
  goForward,
  openDiagram,
  redoModel,
  undoModel,
  useModel,
} from "../model/store";
import type { DiagramLevel } from "../model/types";
import "./TopBar.css";

function LogoMark() {
  return (
    <svg
      className="topbar__logo"
      width="22"
      height="22"
      viewBox="0 0 22 22"
      aria-hidden="true"
    >
      <rect
        x="1.5"
        y="1.5"
        width="19"
        height="19"
        rx="5"
        fill="none"
        stroke="var(--sp-color-accent-primary)"
        strokeWidth="2"
      />
      <rect
        x="6.5"
        y="6.5"
        width="9"
        height="9"
        rx="2.5"
        fill="var(--sp-color-accent-primary)"
        opacity="0.85"
      />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect
        x="1.5"
        y="2.5"
        width="11"
        height="7.5"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M5 12.5h4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle
        cx="7"
        cy="7"
        r="2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M7 1.2v1.4M7 11.4v1.4M1.2 7h1.4M11.4 7h1.4M2.9 2.9l1 1M10.1 10.1l1 1M11.1 2.9l-1 1M3.9 10.1l-1 1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DarkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M11.5 8.6A4.9 4.9 0 0 1 5.4 2.5a4.9 4.9 0 1 0 6.1 6.1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M5.5 3 2.5 6l3 3M2.8 6H8a3 3 0 0 1 0 6H6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M8.5 3l3 3-3 3M11.2 6H6a3 3 0 0 0 0 6h2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

const SEGMENTS: { mode: ThemeMode; label: string; Icon: () => JSX.Element }[] = [
  { mode: "system", label: "System theme", Icon: SystemIcon },
  { mode: "light", label: "Light theme", Icon: LightIcon },
  { mode: "dark", label: "Dark theme", Icon: DarkIcon },
];

const LEVEL_LABEL: Record<DiagramLevel, string> = {
  context: "Context",
  app: "App",
  component: "Component",
};

interface Crumb {
  id: string;
  name: string;
}

export default function TopBar() {
  const { mode, setMode } = useTheme();
  const { diagrams, diagramId, view, navStack, navIndex } = useModel();
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

  // Breadcrumb: root context diagram > scope ancestors > current diagram.
  // Scope ancestors (objects) resolve to the lowest-order diagram scoped to
  // each object; the root is the lowest-order unscoped diagram.
  const crumbs: Crumb[] = useMemo(() => {
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
    const out: Crumb[] = [];
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
      // The root context diagram leads, unless it is the current diagram.
      if (roots[0].id !== view.diagram.id) {
        out.push({ id: roots[0].id, name: roots[0].name });
      }
    }
    for (const b of view.breadcrumb) {
      const match = byScope.get(b.id);
      if (match && !out.some((c) => c.id === match.id)) {
        out.push({ id: match.id, name: match.name });
      }
    }
    if (!out.some((c) => c.id === view.diagram.id)) {
      out.push({ id: view.diagram.id, name: view.diagram.name });
    }
    return out;
  }, [view, diagrams]);

  // Truncate middle crumbs with "…" when too long; the menu shows the hidden.
  const MAX_CRUMBS = 4;
  const visibleCrumbs: (Crumb | null)[] = useMemo(() => {
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

  return (
    <header className="topbar">
      <div className="topbar__left">
        <LogoMark />
        <span className="topbar__wordmark">Speculum</span>
      </div>

      <nav className="topbar__breadcrumb" aria-label="Breadcrumb">
        <div className="topbar__nav-btns" role="group" aria-label="Navigate">
          <button
            type="button"
            data-testid="nav-back"
            className="topbar__theme-btn"
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
            className="topbar__theme-btn"
            aria-label="Forward"
            title="Forward (Alt+Right)"
            disabled={!canForward}
            onClick={() => void goForward()}
          >
            <ForwardIcon />
          </button>
        </div>
        <ol className="topbar__crumbs" data-testid="breadcrumb">
          {visibleCrumbs.map((c, i) =>
            c == null ? (
              <li key="ellipsis" className="topbar__crumb-item">
                <div className="topbar__diagram-switch" ref={hiddenRef}>
                  <button
                    type="button"
                    className="topbar__crumb topbar__crumb--ellipsis"
                    aria-haspopup="menu"
                    aria-expanded={hiddenOpen}
                    aria-label="Hidden levels"
                    onClick={() => setHiddenOpen((o) => !o)}
                  >
                    …
                  </button>
                  {hiddenOpen && (
                    <div className="topbar__diagram-menu" role="menu" aria-label="Hidden levels">
                      {hiddenCrumbs.map((h) => (
                        <button
                          key={h.id}
                          type="button"
                          role="menuitem"
                          data-testid={`crumb-${h.id}`}
                          className="topbar__diagram-item"
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
                <span className="topbar__crumb-sep" aria-hidden="true">
                  ›
                </span>
              </li>
            ) : (
              <li key={c.id} className="topbar__crumb-item">
                {i === visibleCrumbs.length - 1 ? (
                  <div className="topbar__diagram-switch" ref={menuRef}>
                    <button
                      type="button"
                      data-testid={`crumb-${c.id}`}
                      className="topbar__diagram-button"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      onClick={() => setMenuOpen((o) => !o)}
                    >
                      <span className="topbar__crumb topbar__crumb--current">
                        {c.name}
                      </span>
                      <span className="topbar__crumb-sep" aria-hidden="true">
                        ▾
                      </span>
                    </button>
                    {menuOpen && (
                      <div className="topbar__diagram-menu" role="menu" aria-label="Diagrams">
                        {grouped.map((g) => (
                          <div key={g.level} className="topbar__diagram-group">
                            <div className="topbar__diagram-group-title">
                              {LEVEL_LABEL[g.level]}
                            </div>
                            {g.items.map((d) => (
                              <button
                                key={d.id}
                                type="button"
                                role="menuitem"
                                className={`topbar__diagram-item${d.id === diagramId ? " topbar__diagram-item--current" : ""}`}
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
                    className="topbar__crumb topbar__crumb--link"
                    onClick={() => void crumbTo(c.id)}
                  >
                    {c.name}
                  </button>
                )}
                {i < visibleCrumbs.length - 1 && (
                  <span className="topbar__crumb-sep" aria-hidden="true">
                    ›
                  </span>
                )}
              </li>
            ),
          )}
        </ol>
      </nav>

      <div className="topbar__right">
        <div
          className="topbar__theme-switch"
          role="group"
          aria-label="Undo and redo"
        >
          <button
            type="button"
            className="topbar__theme-btn"
            aria-label="Undo (Control Z)"
            title="Undo (Ctrl+Z)"
            onClick={() => void undoModel()}
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            className="topbar__theme-btn"
            aria-label="Redo (Control Y)"
            title="Redo (Ctrl+Y)"
            onClick={() => void redoModel()}
          >
            <RedoIcon />
          </button>
        </div>
        <button
          type="button"
          className="topbar__search"
          aria-label="Search or jump to objects (Control K)"
          title="Search or jump to objects"
          onClick={() => {}}
        >
          <span className="topbar__search-text">Search or jump…</span>
          <span className="topbar__kbd">
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </span>
        </button>

        <div
          className="topbar__theme-switch"
          role="group"
          aria-label="Color theme"
        >
          {SEGMENTS.map(({ mode: m, label, Icon }) => (
            <button
              key={m}
              type="button"
              className={`topbar__theme-btn${mode === m ? " topbar__theme-btn--active" : ""}`}
              aria-label={label}
              title={label}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              <Icon />
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
