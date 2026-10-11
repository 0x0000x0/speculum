import { useTheme, type ThemeMode } from "../theme/ThemeProvider";
import { redoModel, undoModel } from "../model/store";
import "./TopBar.css";

const SEGMENTS: { mode: ThemeMode; label: string; Icon: () => JSX.Element }[] = [
  { mode: "system", label: "System theme", Icon: SystemIcon },
  { mode: "light", label: "Light theme", Icon: LightIcon },
  { mode: "dark", label: "Dark theme", Icon: DarkIcon },
];

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

export default function TopBar() {
  const { mode, setMode } = useTheme();
  return (
    <header className="topbar">
      <div className="topbar__left">
        <LogoMark />
        <span className="topbar__wordmark">Speculum</span>
      </div>

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
