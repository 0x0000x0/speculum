import { useSession } from "./SessionProvider";

export interface SessionStatus {
  /** Left status-bar text, e.g. "Saved · 2:41 PM" or "Unsaved changes". */
  savedLabel: string;
  /** Right status-bar model counts. */
  objects: number;
  links: number;
  flows: number;
}

function formatTime(ms: number): string {
  if (!ms) return "Saved";
  try {
    const t = new Date(ms).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    return `Saved · ${t}`;
  } catch {
    return "Saved";
  }
}

/**
 * Session + model status for the shell chrome.
 * Live data from the Rust backend via `SessionProvider` (M2); falls back
 * to placeholder values before `startup()` resolves.
 */
export function useSessionStatus(): SessionStatus {
  const session = useSession();
  if (session.loading) {
    return { savedLabel: "Loading…", objects: 0, links: 0, flows: 0 };
  }
  return {
    savedLabel: session.dirty ? "Unsaved changes" : formatTime(session.lastSavedMs),
    objects: session.counts.objects,
    links: session.counts.connections,
    flows: session.counts.flows,
  };
}
