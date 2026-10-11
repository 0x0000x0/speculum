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
import {
  bridgeAddSampleBox,
  bridgeGetState,
  bridgeRedo,
  bridgeResolveRecovery,
  bridgeStartup,
  bridgeUndo,
  type RecoveryInfo,
  type SessionCounts,
} from "./bridge";

export type SessionStatusKind = "loading" | "clean" | "needs_recovery";

interface SessionContextValue {
  loading: boolean;
  status: SessionStatusKind;
  recovery: RecoveryInfo | null;
  counts: SessionCounts;
  dirty: boolean;
  lastSavedMs: number;
  name: string;
  resolveRecovery: (choice: "restore" | "discard") => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  addSampleBox: () => Promise<void>;
}

const defaultCounts: SessionCounts = {
  objects: 0,
  connections: 0,
  tags: 0,
  diagrams: 0,
  flows: 0,
  rev: 0,
};

const SessionContext = createContext<SessionContextValue>({
  loading: true,
  status: "loading",
  recovery: null,
  counts: defaultCounts,
  dirty: false,
  lastSavedMs: 0,
  name: "",
  resolveRecovery: () => Promise.resolve(),
  undo: () => Promise.resolve(),
  redo: () => Promise.resolve(),
  addSampleBox: () => Promise.resolve(),
});

// --- Single place that applies backend counts to session state ----------------
// Every mutation path (seed_sample, dispatch, undo, redo, add_sample_box,
// recovery_resolve, ensure_layout, delete-from-model, quick-add, toast undo)
// funnels through `applySessionCounts` so the status bar / side panel cannot
// drift from the backend. The model store calls this after each bridge
// mutation; SessionProvider wires the real setter on mount.
let lastCounts: SessionCounts = defaultCounts;
let countsApplier: ((next: SessionCounts) => void) | null = null;

/** Latest counts applied via {@link applySessionCounts} (mock or Tauri). */
export function getLastSessionCounts(): SessionCounts {
  return lastCounts;
}

/**
 * Apply counts returned by ANY bridge mutation to the session state.
 * This is the single funnel — do not call setCounts directly elsewhere.
 */
export function applySessionCounts(next: SessionCounts): void {
  lastCounts = next;
  countsApplier?.(next);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SessionStatusKind>("loading");
  const [recovery, setRecovery] = useState<RecoveryInfo | null>(null);
  const [counts, setCounts] = useState<SessionCounts>(defaultCounts);
  const [dirty, setDirty] = useState(false);
  const [lastSavedMs, setLastSavedMs] = useState(0);
  const [name, setName] = useState("");
  const mounted = useRef(true);

  // The single funnel writes through this setter (and the shared copy
  // read by window.__speculum.getState()).
  const applyCounts = useCallback((next: SessionCounts) => {
    lastCounts = next;
    if (mounted.current) setCounts(next);
  }, []);

  useEffect(() => {
    countsApplier = applyCounts;
    return () => {
      if (countsApplier === applyCounts) countsApplier = null;
    };
  }, [applyCounts]);

  useEffect(() => {
    mounted.current = true;
    bridgeStartup()
      .then((res) => {
        if (!mounted.current) return;
        applyCounts(res.counts);
        if (res.status === "needs_recovery" && res.recovery) {
          setStatus("needs_recovery");
          setRecovery(res.recovery);
        } else {
          setStatus("clean");
          setRecovery(null);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!mounted.current) return;
        setLoading(false);
        setStatus("clean");
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  // Poll the backend for save state so the status bar follows autosaves.
  useEffect(() => {
    if (loading || status === "needs_recovery") return;
    const t = window.setInterval(() => {
      bridgeGetState()
        .then((s) => {
          if (!mounted.current) return;
          applyCounts(s.counts);
          setDirty(s.dirty);
          setLastSavedMs(s.lastSavedMs);
          setName(s.name);
        })
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(t);
  }, [loading, status, applyCounts]);

  const resolveRecovery = useCallback(
    async (choice: "restore" | "discard") => {
      const next = await bridgeResolveRecovery(choice);
      if (!mounted.current) return;
      applyCounts(next);
      setRecovery(null);
      setStatus("clean");
      setDirty(choice === "restore");
    },
    [applyCounts],
  );

  const undo = useCallback(async () => {
    const next = await bridgeUndo().catch(() => null);
    if (next && mounted.current) {
      applyCounts(next);
      setDirty(true);
    }
  }, [applyCounts]);

  const redo = useCallback(async () => {
    const next = await bridgeRedo().catch(() => null);
    if (next && mounted.current) {
      applyCounts(next);
      setDirty(true);
    }
  }, [applyCounts]);

  const addSampleBox = useCallback(async () => {
    const next = await bridgeAddSampleBox().catch(() => null);
    if (next && mounted.current) {
      applyCounts(next);
      setDirty(true);
    }
  }, [applyCounts]);

  const value = useMemo<SessionContextValue>(
    () => ({
      loading,
      status,
      recovery,
      counts,
      dirty,
      lastSavedMs,
      name,
      resolveRecovery,
      undo,
      redo,
      addSampleBox,
    }),
    [
      loading,
      status,
      recovery,
      counts,
      dirty,
      lastSavedMs,
      name,
      resolveRecovery,
      undo,
      redo,
      addSampleBox,
    ],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}
