import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "speculum.theme";
const SWITCH_CLASS = "theme-switching";
const SWITCH_MS = 250;

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function readStoredMode(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "dark" || raw === "light" || raw === "system") return raw;
  } catch {
    /* storage unavailable — fall through to default */
  }
  return "system";
}

/** `?theme=dark|light` forces a theme (screenshot / demo override). */
function readUrlOverride(): ResolvedTheme | null {
  try {
    const t = new URLSearchParams(window.location.search).get("theme");
    if (t === "dark" || t === "light") return t;
  } catch {
    /* ignore malformed URLs */
  }
  return null;
}

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "system",
  resolved: "dark",
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() =>
    typeof window === "undefined" ? "system" : readStoredMode(),
  );
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window === "undefined" ? true : prefersDark(),
  );
  const [urlOverride] = useState<ResolvedTheme | null>(() =>
    typeof window === "undefined" ? null : readUrlOverride(),
  );
  const firstApply = useRef(true);

  const resolved: ResolvedTheme = useMemo(() => {
    if (urlOverride) return urlOverride;
    if (mode === "system") return systemDark ? "dark" : "light";
    return mode;
  }, [mode, systemDark, urlOverride]);

  // Follow the OS theme live while in "system" mode.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Apply the resolved theme to <html data-theme="…"> with a brief
  // color/background transition on change only (skipped on first paint
  // and under prefers-reduced-motion).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    if (firstApply.current) {
      firstApply.current = false;
      return;
    }
    if (prefersReducedMotion()) return;
    root.classList.add(SWITCH_CLASS);
    const t = window.setTimeout(() => root.classList.remove(SWITCH_CLASS), SWITCH_MS);
    return () => window.clearTimeout(t);
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
  }, []);

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
