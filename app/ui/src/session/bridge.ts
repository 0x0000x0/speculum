/**
 * Bridge to the Rust backend (Tauri commands) with an in-browser mock
 * fallback so `pnpm dev` renders outside Tauri.
 *
 * Inside Tauri (`window.__TAURI_INTERNALS__` defined) every call invokes
 * the matching Rust command from `app/src-tauri/src/main.rs`.
 * Outside Tauri a small in-memory mock answers instead; the mock can be
 * forced into the recovery state with the URL query `?mock=recovery`
 * (used for screenshots).
 */
import { invoke } from "@tauri-apps/api/core";

export interface SessionCounts {
  objects: number;
  connections: number;
  tags: number;
  diagrams: number;
  flows: number;
}

export interface RecoveryInfo {
  pendingCommands: number;
  fileOk: boolean;
}

export interface StartupResult {
  path: string;
  status: "clean" | "needs_recovery";
  recovery?: RecoveryInfo;
  counts: SessionCounts;
}

export interface SessionStateDto {
  name: string;
  counts: SessionCounts;
  dirty: boolean;
  lastSavedMs: number;
}

export function isTauri(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !==
        undefined
    );
  } catch {
    return false;
  }
}

function readParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

/** True when the in-browser mock should start in the recovery state. */
export function mockWantsRecovery(): boolean {
  return readParam("mock") === "recovery";
}

// ---------------------------------------------------------------------------
// In-browser mock
// ---------------------------------------------------------------------------

interface MockState {
  counts: SessionCounts;
  dirty: boolean;
  lastSavedMs: number;
  pending: RecoveryInfo | null;
}

const mock: MockState = {
  counts: { objects: 5, connections: 4, tags: 2, diagrams: 1, flows: 0 },
  dirty: false,
  lastSavedMs: Date.now(),
  pending: null,
};

function mockStartup(): StartupResult {
  if (mockWantsRecovery() && mock.pending === null) {
    mock.pending = { pendingCommands: 5, fileOk: true };
  }
  if (mock.pending) {
    return {
      path: "mock/Default.speculum",
      status: "needs_recovery",
      recovery: { ...mock.pending },
      counts: { ...mock.counts },
    };
  }
  return {
    path: "mock/Default.speculum",
    status: "clean",
    counts: { ...mock.counts },
  };
}

function mockResolve(choice: "restore" | "discard"): SessionCounts {
  // Discard drops back to the "saved" snapshot; the mock pretends the
  // saved state had one fewer box than the recovered one.
  if (choice === "discard") {
    mock.counts = {
      ...mock.counts,
      objects: Math.max(0, mock.counts.objects - 1),
    };
  }
  mock.pending = null;
  mock.dirty = choice === "restore";
  return { ...mock.counts };
}

// ---------------------------------------------------------------------------
// Public bridge
// ---------------------------------------------------------------------------

export async function bridgeStartup(): Promise<StartupResult> {
  if (!isTauri()) return mockStartup();
  return invoke<StartupResult>("startup");
}

export async function bridgeResolveRecovery(
  choice: "restore" | "discard",
): Promise<SessionCounts> {
  if (!isTauri()) return mockResolve(choice);
  return invoke<SessionCounts>("recovery_resolve", { choice });
}

export async function bridgeUndo(): Promise<SessionCounts> {
  if (!isTauri()) {
    mock.counts.objects = Math.max(0, mock.counts.objects - 1);
    return { ...mock.counts };
  }
  return invoke<SessionCounts>("undo");
}

export async function bridgeRedo(): Promise<SessionCounts> {
  if (!isTauri()) {
    mock.counts.objects += 1;
    return { ...mock.counts };
  }
  return invoke<SessionCounts>("redo");
}

export async function bridgeAddSampleBox(): Promise<SessionCounts> {
  if (!isTauri()) {
    mock.counts.objects += 1;
    mock.dirty = true;
    return { ...mock.counts };
  }
  return invoke<SessionCounts>("add_sample_box");
}

export async function bridgeGetState(): Promise<SessionStateDto> {
  if (!isTauri()) {
    return {
      name: "Mock Document",
      counts: { ...mock.counts },
      dirty: mock.dirty,
      lastSavedMs: mock.lastSavedMs,
    };
  }
  return invoke<SessionStateDto>("state");
}
