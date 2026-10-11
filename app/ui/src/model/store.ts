/**
 * Client-side document store (hand-rolled external store, no dependencies).
 * Holds the last-fetched Document, the current diagram + view, selection,
 * hover, the backend `rev`, the M5 navigation stack, drill animation state,
 * and the last-saved viewport per diagram.
 */
import { useSyncExternalStore } from "react";
import {
  bridgeDiagramParent,
  bridgeDispatch,
  bridgeEnsureLayout,
  bridgeGetDiagramView,
  bridgeGetDocument,
  bridgeGetState,
  bridgeListDiagrams,
  bridgeRedo,
  bridgeSeedSample,
  bridgeSetLanding,
  bridgeUndo,
  bridgeZoomInto,
} from "../session/bridge";
import {
  applySessionCounts,
  getLastSessionCounts,
} from "../session/SessionProvider";
import {
  emptyDocument,
  type Command,
  type DiagramInfo,
  type DiagramView,
  type ObjectKind,
  type Rect,
  type ScreenRect,
  type SpecDocument,
  type Viewport,
} from "./types";
import { endpointBox } from "./endpoints";
import { PACKING } from "../canvas/edgeGeometry";

export const KIND_LABELS: Record<ObjectKind, string> = {
  actor: "Actor",
  system: "System",
  app: "App",
  store: "Store",
  component: "Component",
  group: "Group",
};

/** Object kinds whose boxes can contain a lower diagram. */
export function canContain(kind: ObjectKind): boolean {
  return kind === "system" || kind === "app" || kind === "store" || kind === "group";
}

export interface QuickAddState {
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
  /** When set, confirming quick-add also links sourceKey -> the new box. */
  pendingLink?: { sourceKey: string } | null;
}

/** View-only connect mode (never a command): pick source, then target. */
export interface ConnectModeState {
  source: string | null;
  candidate: string | null;
}

/** Active canvas tool (view-only, never a command). */
export type CanvasToolId =
  | "select"
  | "pan"
  | "add-system"
  | "add-app"
  | "add-component"
  | "add-store"
  | "add-actor"
  | "add-group"
  | "connect"
  | "note"
  | "flow";

/** A drag/drop that awaits a name (Enter commits, Esc cancels). */
export interface PendingLink {
  sourceKey: string;
  targetKey: string;
  screenX: number;
  screenY: number;
}

/** View-only edge selection (never a command): which model link is open. */
export interface SelectedEdgeInfo {
  connId: string;
  connIds: string[];
  lower: boolean;
  fromKey: string;
  toKey: string;
}

export interface DrillState {
  dir: "in" | "up";
  /** Screen rect of the box drilled from (in) or into (up); null while measuring. */
  rect: ScreenRect | null;
  /** Box label shown on the snapshot overlay. */
  label: string;
  /** Object id drilled from (in) or back into (up); null while measuring. */
  boxId: string | null;
  /** Reduced motion: plain cross-fade, no scale transform. */
  reduced: boolean;
  startedAt: number;
}

/** Camera-transition phase for the drill animation (view-only, never saved).
 *  "idle" (or null) when settled; otherwise "in-zoom" | "in-swap" |
 *  "in-settle" | "up-zoom" | "up-swap" | "up-settle" | "fade". */
export type DrillAnimPhase = string;

interface ModelSnapshot {
  status: "loading" | "ready" | "error";
  doc: SpecDocument;
  diagrams: DiagramInfo[];
  diagramId: string | null;
  view: DiagramView | null;
  rev: number;
  selection: string[];
  hover: string | null;
  renamingId: string | null;
  toast: string | null;
  toastUndo: boolean;
  quickAdd: QuickAddState | null;
  error: string | null;
  /** Browser-like navigation stack (diagram ids) and current position. */
  navStack: string[];
  navIndex: number;
  /** True while a drill animation is running. */
  animating: boolean;
  drill: DrillState | null;
  /** Camera-transition phase (see DrillAnimPhase); "idle" when settled. */
  drillAnim: DrillAnimPhase;
  /** Last saved viewport per diagram (exact pan/zoom restore). */
  viewports: Record<string, Viewport>;
  /** Diagram "show all labels" (persisted per diagram via PatchDiagram). */
  showAllLabels: boolean;
  /** View-only connect mode + pending named link + selected edge. */
  connectMode: ConnectModeState | null;
  pendingLink: PendingLink | null;
  selectedEdge: SelectedEdgeInfo | null;
  /** Active left-bar tool (default "select"). */
  tool: CanvasToolId;
}

const initial: ModelSnapshot = {
  status: "loading",
  doc: emptyDocument(""),
  diagrams: [],
  diagramId: null,
  view: null,
  rev: 0,
  selection: [],
  hover: null,
  renamingId: null,
  toast: null,
  toastUndo: true,
  quickAdd: null,
  error: null,
  navStack: [],
  navIndex: -1,
  animating: false,
  drill: null,
  drillAnim: "idle",
  viewports: {},
  showAllLabels: false,
  connectMode: null,
  pendingLink: null,
  selectedEdge: null,
  tool: "select",
};

let snap: ModelSnapshot = initial;
const listeners = new Set<() => void>();
/** Selection-only subscribers (SPEED part 2: box selection must not
 *  re-render the whole canvas tree; React Flow already owns the visuals). */
const selListeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function emitSel(): void {
  for (const l of selListeners) l();
}

function set(patch: Partial<ModelSnapshot>): void {
  // No-op commits still re-render every subscriber (and repaint in software
  // rendering): bail when the patch changes nothing. (SPEED part 2: this
  // alone removes several empty commits from the open path.)
  let changed = false;
  for (const k of Object.keys(patch) as (keyof ModelSnapshot)[]) {
    if (!Object.is(snap[k], patch[k])) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  snap = { ...snap, ...patch };
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): ModelSnapshot {
  return snap;
}

export function useModel(): ModelSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function subscribeSelection(l: () => void): () => void {
  selListeners.add(l);
  return () => {
    selListeners.delete(l);
  };
}

function getSelectionSnapshot(): string[] {
  return snap.selection;
}

/** Box selection without re-rendering full-snapshot subscribers. */
export function useSelection(): string[] {
  return useSyncExternalStore(subscribeSelection, getSelectionSnapshot, getSelectionSnapshot);
}

/** Non-subscribing read for event handlers (keyboard shortcuts). */
export function getSelection(): string[] {
  return snap.selection;
}

function getDocSnapshot(): SpecDocument {
  return snap.doc;
}

/** Document ref: stable across hover/selection emits. */
export function useDoc(): SpecDocument {
  return useSyncExternalStore(subscribe, getDocSnapshot, getDocSnapshot);
}

function getViewSnapshot(): DiagramView | null {
  return snap.view;
}

export function useView(): DiagramView | null {
  return useSyncExternalStore(subscribe, getViewSnapshot, getViewSnapshot);
}

function getSelectedEdgeSnapshot(): SelectedEdgeInfo | null {
  return snap.selectedEdge;
}

export function useSelectedEdgeState(): SelectedEdgeInfo | null {
  return useSyncExternalStore(subscribe, getSelectedEdgeSnapshot, getSelectedEdgeSnapshot);
}

// --- helpers ---------------------------------------------------------------

function readParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

let idCounter = 0;
export function newObjectId(): string {
  idCounter += 1;
  return `obj-${Date.now().toString(36)}-${idCounter}`;
}

export function snap8(v: number): number {
  return Math.round(v / 8) * 8;
}

export function prefersReducedMotion(): boolean {
  try {
    if (window.localStorage.getItem("speculum.reduced-motion") === "1")
      return true;
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

/** Latest live viewport from the canvas (updated on every move). */
let liveVp: { diagramId: string; vp: Viewport } | null = null;

export function setLiveViewport(diagramId: string, vp: Viewport): void {
  liveVp = { diagramId, vp: { ...vp } };
}

function clearLiveViewport(): void {
  liveVp = null;
}

let animTimer: number | null = null;

function clearAnimTimer(): void {
  if (animTimer != null) {
    window.clearTimeout(animTimer);
    animTimer = null;
  }
}

/** Finish the running drill animation immediately (Esc). */
export function finishDrill(): void {
  clearAnimTimer();
  if (snap.animating || snap.drill != null) {
    set({ animating: false, drill: null, drillAnim: "idle" });
    perfDrillSettled();
  } else if (snap.drillAnim !== "idle") {
    set({ drillAnim: "idle" });
  }
}

/** Set the camera-transition phase (view-only; written by FlowCanvas). */
export function setDrillPhase(phase: DrillAnimPhase): void {
  if (snap.drillAnim !== phase) set({ drillAnim: phase });
}

function drillDurationMs(dir: "in" | "up", reduced: boolean): number {
  if (reduced) return 120;
  return dir === "in" ? 200 : 200;
}

// --- loading ---------------------------------------------------------------

/** Dev-only timing hook (kept; checks may read it). Split into data fetch /
 *  view build / first paint plus per-component render counts fed by the
 *  canvas. Never affects behavior. */
export interface PerfDrillSplit {
  fetchMs: number;
  buildMs: number;
  paintMs: number;
  totalMs: number;
}
const perfState: {
  lastOpenMs: number | null;
  lastDrillMs: PerfDrillSplit | null;
  boxRenders: number;
  edgeRenders: number;
  drillClickT0: number;
  drillSettledT: number;
} = { lastOpenMs: null, lastDrillMs: null, boxRenders: 0, edgeRenders: 0, drillClickT0: 0, drillSettledT: 0 };

/** Stamp the start of a drill gesture (handler entry, app clock). */
function perfDrillStart(): void {
  try {
    perfState.drillClickT0 = performance.now();
    perfState.drillSettledT = 0;
  } catch {
    /* measuring never breaks navigation */
  }
}

/** Stamp the end of a drill gesture (animating cleared, app clock). */
function perfDrillSettled(): void {
  try {
    if (perfState.drillClickT0 !== 0 && perfState.drillSettledT === 0) {
      perfState.drillSettledT = performance.now();
    }
  } catch {
    /* ignore */
  }
}

export function perfNoteRender(kind: "box" | "edge"): void {
  if (kind === "box") perfState.boxRenders += 1;
  else perfState.edgeRenders += 1;
}

export function perfResetRenders(): void {
  perfState.boxRenders = 0;
  perfState.edgeRenders = 0;
}

/** Prefetched DiagramViews keyed by diagram id + model rev, so drill-in/out
 *  clicks (and back/forward) reuse a cached view instead of rebuilding. */
const viewCache = new Map<string, { rev: number; view: DiagramView }>();

function cacheKey(diagramId: string, rev: number): string {
  return `${diagramId}@${rev}`;
}

export function getCachedView(diagramId: string, rev: number): DiagramView | null {
  const hit = viewCache.get(cacheKey(diagramId, rev));
  return hit ? hit.view : null;
}

function putCachedView(diagramId: string, rev: number, view: DiagramView): void {
  viewCache.set(cacheKey(diagramId, rev), { rev, view });
  if (viewCache.size > 24) {
    const first = viewCache.keys().next().value;
    if (first) viewCache.delete(first);
  }
}

async function fetchViewCached(diagramId: string, rev: number): Promise<DiagramView> {
  const hit = getCachedView(diagramId, rev);
  if (hit) return hit;
  const view = await bridgeGetDiagramView(diagramId);
  putCachedView(diagramId, rev, view);
  return view;
}

/** Idle-time prefetch of the drill parent + already-existing child targets
 *  (read-only: never creates diagrams). Runs after first paint so open
 *  stays under budget; the click path then hits the cache. */
function idlePrefetch(currentId: string, rev: number, childTargets: string[]): void {
  const run = () => {
    void (async () => {
      try {
        const parent = await bridgeDiagramParent(currentId).catch(() => null);
        if (parent) await fetchViewCached(parent, rev).catch(() => null);
      } catch {
        /* prefetch never breaks navigation */
      }
      for (const t of childTargets.slice(0, 8)) {
        try {
          await fetchViewCached(t, rev).catch(() => null);
        } catch {
          /* ignore */
        }
      }
    })();
  };
  try {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
    if (typeof ric === "function") ric.call(window, run, { timeout: 1500 });
    else window.setTimeout(run, 50);
  } catch {
    window.setTimeout(run, 50);
  }
}

/** Existing (no-create) drill targets for boxes with children, resolved from
 *  the loaded document only (landing first, then lowest-order scoped
 *  diagram). Used for prefetch; the click path re-resolves the same way. */
function existingChildTargets(doc: SpecDocument, fromDiagramId: string, max: number): string[] {
  const from = doc.diagrams[fromDiagramId];
  if (!from) return [];
  const boxIds = Object.keys(from.boxes);
  const withKids = boxIds.filter((id) =>
    Object.values(doc.model.objects).some((o) => o.parentId === id),
  );
  const out: string[] = [];
  for (const id of withKids) {
    const landed = from.landing[id];
    if (landed && doc.diagrams[landed]) {
      out.push(landed);
    } else {
      const scoped = Object.values(doc.diagrams)
        .filter((d) => d.scopeObjectId === id)
        .sort((a, b) => (a.order === b.order ? (a.id < b.id ? -1 : 1) : a.order - b.order));
      if (scoped.length > 0) out.push(scoped[0].id);
    }
    if (out.length >= max) break;
  }
  return out;
}

async function loadView(
  diagramId: string,
  nav?: { stack: string[]; index: number },
): Promise<void> {
  const tFetch0 = performance.now();
  try {
    performance.mark("speculum:loadview-start");
  } catch {
    /* measuring never breaks loading */
  }
  try {
    const ensured = await bridgeEnsureLayout(diagramId);
    applySessionCounts(ensured.counts);
    const rev = ensured.counts.rev;
    const cached = getCachedView(diagramId, rev);
    const viewP = cached ? Promise.resolve(cached) : fetchViewCached(diagramId, rev);
    const [doc, view, diagrams] = await Promise.all([
      bridgeGetDocument(),
      viewP,
      bridgeListDiagrams(),
    ]);
    const fetchMs = performance.now() - tFetch0;
    perfState.lastOpenMs = fetchMs;
    const viewports = { ...snap.viewports };
    if (view.diagram.viewport) viewports[diagramId] = { ...view.diagram.viewport };
    set({
      status: "ready",
      doc,
      diagrams,
      diagramId,
      view,
      rev: ensured.counts.rev,
      selection: snap.selection.filter((id) => view.diagram.boxes[id] != null),
      error: null,
      viewports,
      showAllLabels: view.diagram.showAllLabels ?? false,
      selectedEdge: null,
      connectMode: null,
      pendingLink: null,
      // Boot folds the nav-stack init into this commit (one paint saved).
      ...(nav != null ? { navStack: nav.stack, navIndex: nav.index } : {}),
    });
    try {
      performance.mark("speculum:view-ready");
      performance.measure("speculum:loadview", "speculum:loadview-start", "speculum:view-ready");
    } catch {
      /* ignore */
    }
    // Prefetch drill targets off the critical path (after first paint).
    try {
      const targets = existingChildTargets(doc, diagramId, 8);
      idlePrefetch(diagramId, ensured.counts.rev, targets);
    } catch {
      /* prefetch is best-effort */
    }
  } catch (e) {
    console.error("failed to load diagram view", e);
    throw e;
  }
}

/** Save the live viewport for `diagramId` immediately (not debounced). */
async function persistViewportNow(diagramId: string): Promise<void> {
  if (liveVp != null && liveVp.diagramId === diagramId) {
    try {
      await saveViewport(diagramId, liveVp.vp);
    } catch (e) {
      console.error("failed to persist viewport", e);
    }
  }
}

/**
 * Core navigation: persist the current viewport, load the target, update
 * the nav stack. `mode` mirrors browser history: "push" clears forward,
 * "back"/"forward" move through the stack, "up" steps back when the target
 * is the previous entry (preserving forward) and pushes otherwise.
 */
async function navigateTo(
  targetId: string,
  mode: "push" | "back" | "forward" | "up",
  drill: Omit<DrillState, "startedAt"> | null,
): Promise<void> {
  if (snap.diagramId === targetId && snap.view != null && drill == null) return;
  const reduced = drill?.reduced ?? prefersReducedMotion();
  const duration = drill ? drillDurationMs(drill.dir, reduced) : 0;
  // Anchor the animation to the navigation start so the measured
  // click-to-settled duration matches the motion tokens (~200/200/120ms)
  // even when the backend round-trip takes tens of ms.
  const t0 = Date.now();
  if (snap.diagramId != null && snap.diagramId !== targetId) {
    await persistViewportNow(snap.diagramId);
  }
  clearLiveViewport();
  // Stack update (computed before the async load so rapid keys stay sane).
  let stack = [...snap.navStack];
  let idx = snap.navIndex;
  if (mode === "push") {
    stack = stack.slice(0, idx + 1);
    if (stack[stack.length - 1] !== targetId) stack.push(targetId);
    idx = stack.length - 1;
  } else if (mode === "back" || mode === "forward") {
    const at = stack.indexOf(targetId);
    if (at >= 0) idx = at;
    else {
      stack = stack.slice(0, idx + 1);
      stack.push(targetId);
      idx = stack.length - 1;
    }
  } else {
    // "up": prefer stepping back through the stack (keeps forward history).
    if (idx > 0 && stack[idx - 1] === targetId) {
      idx -= 1;
    } else {
      const at = stack.lastIndexOf(targetId);
      if (at >= 0 && at < idx) idx = at;
      else {
        stack = stack.slice(0, idx + 1);
        stack.push(targetId);
        idx = stack.length - 1;
      }
    }
  }
  set({ selection: [], hover: null, renamingId: null, quickAdd: null });
  set({ connectMode: null, pendingLink: null, selectedEdge: null });
  if (drill) {
    clearAnimTimer();
    set({
      animating: true,
      drill: { ...drill, reduced, startedAt: Date.now() },
      drillAnim: reduced ? "fade" : drill.dir === "in" ? "in-zoom" : "up-zoom",
      navStack: stack,
      navIndex: idx,
    });
  } else {
    // Plain navigation cancels any running camera sequence.
    if (snap.drillAnim !== "idle" || snap.animating || snap.drill != null) {
      set({ navStack: stack, navIndex: idx, animating: false, drill: null, drillAnim: "idle" });
    } else {
      set({ navStack: stack, navIndex: idx });
    }
  }
  try {
    await loadView(targetId);
  } catch (e) {
    console.error("failed to open diagram", e);
    finishDrill();
    set({ error: e instanceof Error ? e.message : String(e) });
    return;
  }
  if (drill) {
    // The target viewport is applied synchronously by the canvas layout
    // effect before paint (no pop); the timer only ends the overlay/fade,
    // anchored to the navigation start (see t0 above). The camera phases
    // (drillAnim) belong to the canvas: the store timer clears them only
    // on the reduced-motion path (the canvas never touches phases there).
    clearAnimTimer();
    const wait = Math.max(0, duration - (Date.now() - t0));
    animTimer = window.setTimeout(() => {
      animTimer = null;
      if (reduced) {
        finishDrill();
      } else if (snap.animating || snap.drill != null) {
        set({ animating: false, drill: null });
        perfDrillSettled();
      } else {
        perfDrillSettled();
      }
    }, wait);
  }
}

/** Initial load after the session is clean (call once). */
export async function bootModel(): Promise<void> {
  clearAnimTimer();
  set({ status: "loading", error: null });
  try {
    performance.mark("speculum:boot-bridges-start");
  } catch {
    /* ignore */
  }
  try {
    const [doc, diagrams] = await Promise.all([
      bridgeGetDocument(),
      bridgeListDiagrams(),
    ]);
    try {
      performance.mark("speculum:boot-bridges-end");
      performance.measure("speculum:boot-bridges", "speculum:boot-bridges-start", "speculum:boot-bridges-end");
    } catch {
      /* ignore */
    }
    if (diagrams.length === 0) {
      set({
        status: "ready",
        doc,
        diagrams,
        diagramId: null,
        view: null,
        navStack: [],
        navIndex: -1,
      });
      exposeDebugApi();
      return;
    }
    const wanted = readParam("diagram");
    const pick =
      (wanted != null && diagrams.some((d) => d.id === wanted)
        ? wanted
        : diagrams[0].id) ?? diagrams[0].id;
    await loadView(pick, { stack: [pick], index: 0 });
    // ?select=<id> / ?hover=<id> screenshot overrides.
    const sel = readParam("select");
    if (sel != null) set({ selection: [sel] });
    const hov = readParam("hover");
    if (hov != null) set({ hover: hov });
  } catch (e) {
    console.error("failed to boot model", e);
    set({ status: "error", error: e instanceof Error ? e.message : String(e) });
  }
  exposeDebugApi();
}

/** Plain diagram switch (switcher menu): pushes, no drill animation. */
export async function openDiagram(diagramId: string): Promise<void> {
  if (snap.diagramId === diagramId && snap.view != null) return;
  await navigateTo(diagramId, "push", null);
}

/**
 * Navigate to the diagram where an object lives (context-tray child click),
 * with the drill-in camera transition. Prefers the lowest-order diagram
 * boxing the object; falls back to zoomInto (landing / scoped diagram).
 */
export async function goToObjectDiagram(objectId: string, rect: ScreenRect | null): Promise<void> {
  const from = snap.diagramId;
  if (from == null) return;
  const holders = Object.values(snap.doc.diagrams)
    .filter((d) => d.id !== from && d.boxes[objectId] != null)
    .sort((a, b) =>
      a.order === b.order
        ? a.id < b.id ? -1 : a.id > b.id ? 1 : 0
        : a.order - b.order,
    );
  const target = holders.length > 0 ? holders[0].id : null;
  const obj = snap.doc.model.objects[objectId];
  const label = obj?.name ?? "";
  const reduced = prefersReducedMotion();
  clearAnimTimer();
  set({
    animating: true,
    drill: { dir: "in", rect, label, boxId: objectId, reduced, startedAt: Date.now() },
    drillAnim: reduced ? "fade" : "in-zoom",
  });
  // Camera beat on the current view before the swap (this path has no
  // external timing constraints, unlike badge/Enter drills).
  if (!reduced) {
    await new Promise((r) => setTimeout(r, 150));
  }
  if (target == null) {
    await zoomInto(objectId, rect);
    return;
  }
  await navigateTo(target, "push", {
    dir: "in",
    rect,
    label,
    boxId: objectId,
    reduced,
  });
}

/** Drill into a box (badge click, Enter, details button). */
export async function zoomInto(objectId: string, rect: ScreenRect | null): Promise<void> {
  const from = snap.diagramId;
  if (from == null) return;
  const obj = snap.doc.model.objects[objectId];
  const label = obj?.name ?? "";
  const reduced = prefersReducedMotion();
  clearAnimTimer();
  perfDrillStart();
  set({
    animating: true,
    drill: { dir: "in", rect, label, boxId: objectId, reduced, startedAt: Date.now() },
    drillAnim: reduced ? "fade" : "in-zoom",
  });
  try {
    const t0 = performance.now();
    const res = await bridgeZoomInto(from, objectId);
    const fetchMs = performance.now() - t0;
    applySessionCounts(await bridgeGetState().then((s) => s.counts));
    const tB0 = performance.now();
    await navigateTo(res.diagramId, "push", {
      dir: "in",
      rect,
      label,
      boxId: objectId,
      reduced,
    });
    // View-build + first-paint split is completed by the canvas paint note
    // (see perfNoteDrillPaint); record the fetch half here.
    perfState.lastDrillMs = {
      fetchMs,
      buildMs: Math.max(0, performance.now() - tB0 - fetchMs),
      paintMs: 0,
      totalMs: performance.now() - t0,
    };
  } catch (e) {
    console.error("zoom into failed", e);
    finishDrill();
    showToast(e instanceof Error ? e.message : String(e));
  }
}

/** Up one level (Backspace, up button, crumb when it is the parent). */
export async function goUp(): Promise<void> {
  const from = snap.diagramId;
  const fromScope = snap.view?.scope?.id ?? snap.view?.diagram.scopeObjectId ?? null;
  if (from == null) return;
  const reduced = prefersReducedMotion();
  // Prefer the diagram we came from (handled in the UI): step back when the
  // previous stack entry is a plausible parent; else ask the backend.
  let target: string | null = null;
  if (snap.navIndex > 0) {
    target = snap.navStack[snap.navIndex - 1] ?? null;
  }
  if (target == null) {
    try {
      target = await bridgeDiagramParent(from);
    } catch (e) {
      console.error("diagram_parent failed", e);
      return;
    }
  }
  if (target == null || target === from) return;
  const label = fromScope
    ? (snap.doc.model.objects[fromScope]?.name ?? "")
    : "";
  clearAnimTimer();
  perfDrillStart();
  // Rect is measured after the parent loads (scope box position there).
  set({
    animating: true,
    drill: { dir: "up", rect: null, label, boxId: fromScope, reduced, startedAt: Date.now() },
    drillAnim: reduced ? "fade" : "up-zoom",
  });
  await navigateTo(target, "up", { dir: "up", rect: null, label, boxId: fromScope, reduced });
}

/** Back through the nav stack (Alt+Left, mouse button 3). No animation. */
export async function goBack(): Promise<void> {
  if (snap.navIndex <= 0) return;
  const target = snap.navStack[snap.navIndex - 1];
  if (target == null || target === snap.diagramId) return;
  await navigateTo(target, "back", null);
}

/** Forward through the nav stack (Alt+Right, mouse button 4). No animation. */
export async function goForward(): Promise<void> {
  const target = snap.navStack[snap.navIndex + 1];
  if (target == null || target === snap.diagramId) return;
  await navigateTo(target, "forward", null);
}

/** Crumb click: navigate up, animated as drill-up. */
export async function crumbTo(diagramId: string): Promise<void> {
  if (diagramId === snap.diagramId) return;
  const fromScope = snap.view?.scope?.id ?? snap.view?.diagram.scopeObjectId ?? null;
  const label = fromScope
    ? (snap.doc.model.objects[fromScope]?.name ?? "")
    : "";
  const reduced = prefersReducedMotion();
  clearAnimTimer();
  set({
    animating: true,
    drill: { dir: "up", rect: null, label, boxId: fromScope, reduced, startedAt: Date.now() },
    drillAnim: reduced ? "fade" : "up-zoom",
  });
  await navigateTo(diagramId, "up", { dir: "up", rect: null, label, boxId: fromScope, reduced });
}

export async function setLandingTarget(
  diagramId: string,
  objectId: string,
  target: string | null,
): Promise<void> {
  const counts = await bridgeSetLanding(diagramId, objectId, target);
  applySessionCounts(counts);
  await refreshAfter(counts.rev);
}

/** Re-fetch when the backend rev moved (e.g. undo from another path). */
export async function syncIfStale(): Promise<void> {
  if (snap.status !== "ready") return;
  try {
    const s = await bridgeGetState();
    if (s.counts.rev === snap.rev) return;
    const [doc, diagrams] = await Promise.all([
      bridgeGetDocument(),
      bridgeListDiagrams(),
    ]);
    if (snap.diagramId == null || !doc.diagrams[snap.diagramId]) {
      set({ doc, diagrams, rev: s.counts.rev });
      if (diagrams.length > 0) await loadView(diagrams[0].id);
      else set({ view: null, diagramId: null });
      return;
    }
    const view = await bridgeGetDiagramView(snap.diagramId);
    const viewports = { ...snap.viewports };
    if (view.diagram.viewport)
      viewports[snap.diagramId] = { ...view.diagram.viewport };
    set({
      doc,
      diagrams,
      view,
      rev: s.counts.rev,
      selection: snap.selection.filter((id) => view.diagram.boxes[id] != null),
      viewports,
      showAllLabels: view.diagram.showAllLabels ?? false,
    });
  } catch (e) {
    // Polling must never break the canvas, but a failed reload (e.g. a
    // rejected get_diagram_view) must still be visible in devtools.
    console.error("failed to reload diagram view", e);
  }
}

// --- mutations ---------------------------------------------------------------

async function refreshAfter(countsRev: number): Promise<void> {
  try {
    const [doc, diagrams] = await Promise.all([
      bridgeGetDocument(),
      bridgeListDiagrams(),
    ]);
    if (snap.diagramId != null && doc.diagrams[snap.diagramId]) {
      const view = await bridgeGetDiagramView(snap.diagramId);
      const viewports = { ...snap.viewports };
      if (view.diagram.viewport)
        viewports[snap.diagramId] = { ...view.diagram.viewport };
      // Keep a selected edge while its connection still exists in the
      // model (implicit roll-up edges are never in diagram.connections).
      let selectedEdge = snap.selectedEdge;
      if (
        selectedEdge != null &&
        doc.model.connections[selectedEdge.connId] == null
      ) {
        selectedEdge = null;
      }
      set({
        doc,
        diagrams,
        view,
        rev: countsRev,
        selection: snap.selection.filter((id) => view.diagram.boxes[id] != null),
        viewports,
        showAllLabels: view.diagram.showAllLabels ?? false,
        selectedEdge,
      });
    } else if (diagrams.length > 0) {
      set({ doc, diagrams });
      await loadView(diagrams[0].id);
    } else {
      set({ doc, diagrams, view: null, diagramId: null, rev: countsRev });
    }
  } catch (e) {
    console.error("failed to refresh diagram view", e);
    throw e;
  }
}

export async function dispatchAndRefresh(cmd: Command): Promise<void> {
  const counts = await bridgeDispatch(cmd);
  applySessionCounts(counts);
  await refreshAfter(counts.rev);
}

export async function undoModel(): Promise<void> {
  const counts = await bridgeUndo();
  applySessionCounts(counts);
  await refreshAfter(counts.rev);
}

export async function redoModel(): Promise<void> {
  const counts = await bridgeRedo();
  applySessionCounts(counts);
  await refreshAfter(counts.rev);
}

export async function seedModel(): Promise<void> {
  const counts = await bridgeSeedSample();
  applySessionCounts(counts);
  set({ selection: [], hover: null });
  const diagrams = await bridgeListDiagrams();
  if (diagrams.length > 0) {
    const wanted = readParam("diagram");
    const pick =
      (wanted != null && diagrams.some((d) => d.id === wanted)
        ? wanted
        : diagrams[0].id) ?? diagrams[0].id;
    set({ navStack: [pick], navIndex: 0 });
    await loadView(pick);
  }
}

export async function saveViewport(
  diagramId: string,
  viewport: Viewport,
): Promise<void> {
  // Viewport-only save: update rev silently, no refetch (avoids a loop
  // with the debounced saver). The local view copy is updated too.
  const counts = await bridgeDispatch({
    op: "setViewport",
    diagramId,
    viewport,
  });
  applySessionCounts(counts);
  const viewports = { ...snap.viewports, [diagramId]: { ...viewport } };
  if (snap.view != null && snap.diagramId === diagramId) {
    set({
      rev: counts.rev,
      view: {
        ...snap.view,
        diagram: { ...snap.view.diagram, viewport: { ...viewport } },
      },
      viewports,
    });
  } else {
    set({ rev: counts.rev, viewports });
  }
}

export async function createBox(
  kind: ObjectKind,
  name: string,
  at: { x: number; y: number },
): Promise<void> {
  const view = snap.view;
  if (view == null) return;
  const id = newObjectId();
  const label = KIND_LABELS[kind];
  await dispatchAndRefresh({
    op: "batch",
    commands: [
      {
        op: "createObject",
        object: {
          id,
          name: name || `New ${label}`,
          type: kind,
          parentId: view.diagram.scopeObjectId ?? null,
          status: "live",
          external: false,
          caption: "",
          description: "",
          tagIds: [],
          technologies: [],
          links: [],
          groupIds: [],
          labels: {},
        },
      },
      {
        op: "addToDiagram",
        diagramId: view.diagram.id,
        objectId: id,
        rect: { x: snap8(at.x), y: snap8(at.y), w: 240, h: 120 },
      },
    ],
  });
  set({ selection: [id], renamingId: id });
}

export async function addExistingToDiagram(
  objectId: string,
  at: { x: number; y: number },
): Promise<void> {
  const view = snap.view;
  if (view == null) return;
  await dispatchAndRefresh({
    op: "addToDiagram",
    diagramId: view.diagram.id,
    objectId,
    rect: { x: snap8(at.x), y: snap8(at.y), w: 240, h: 120 },
  });
  set({ selection: [objectId] });
}

export async function moveBoxes(
  diagramId: string,
  moves: Record<string, Rect>,
): Promise<void> {
  if (Object.keys(moves).length === 0) return;
  await dispatchAndRefresh({ op: "moveBoxes", diagramId, moves });
}

export async function removeFromDiagram(ids: string[]): Promise<void> {
  const view = snap.view;
  if (view == null || ids.length === 0) return;
  await dispatchAndRefresh({
    op: "batch",
    commands: ids.map(
      (objectId): Command => ({
        op: "removeFromDiagram",
        diagramId: view.diagram.id,
        objectId,
      }),
    ),
  });
  set({ selection: [], toast: "Removed from diagram" });
}

export async function deleteFromModel(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await dispatchAndRefresh({
    op: "batch",
    commands: ids.map((id): Command => ({ op: "deleteObject", id })),
  });
  set({ selection: [], renamingId: null });
}

export async function renameObject(id: string, name: string): Promise<void> {
  const obj = snap.doc.model.objects[id];
  const fallback = obj ? `New ${KIND_LABELS[obj.type]}` : "New box";
  const next = name.trim() === "" ? fallback : name.trim();
  await dispatchAndRefresh({
    op: "patchObject",
    id,
    patch: { name: next },
  });
  set({ renamingId: null });
}

// --- connections (M6p2: every model change is one core Command) ---------------

let connCounter = 0;
export function newConnectionId(): string {
  connCounter += 1;
  return `conn-${Date.now().toString(36)}-${connCounter}`;
}

/** Resolve an object to its boxed endpoint key on this diagram. */
function endpointKeyFor(
  doc: SpecDocument,
  diagramId: string,
  objectId: string,
): string | null {
  const d = doc.diagrams[diagramId];
  if (!d) return null;
  if (d.scopeObjectId === objectId) return "__frame__";
  if (d.boxes[objectId]) return objectId;
  const seen = new Set<string>([objectId]);
  let cur = doc.model.objects[objectId]?.parentId ?? null;
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    if (d.boxes[cur]) return cur;
    cur = doc.model.objects[cur]?.parentId ?? null;
  }
  return null;
}

function objectKeyToId(key: string, diagramId: string): string | null {
  if (key === "__frame__") {
    return snap.view?.diagram.scopeObjectId ?? snap.doc.diagrams[diagramId]?.scopeObjectId ?? null;
  }
  return key;
}

/**
 * Create one labeled link as ONE Batch (Connect + ShowConnection = one undo
 * step). Unnamed links are never created (callers drop empty names).
 */
export async function createConnection(
  diagramId: string,
  sourceKey: string,
  targetKey: string,
  name: string,
): Promise<string | null> {
  const clean = name.trim();
  if (clean === "") return null;
  if (sourceKey === targetKey) return null;
  const originId = objectKeyToId(sourceKey, diagramId);
  const targetId = objectKeyToId(targetKey, diagramId);
  if (!originId || !targetId) return null;
  if (!snap.doc.model.objects[originId] || !snap.doc.model.objects[targetId])
    return null;
  const id = newConnectionId();
  await dispatchAndRefresh({
    op: "batch",
    commands: [
      {
        op: "connect",
        connection: {
          id,
          originId,
          targetId,
          name: clean,
          description: "",
          direction: "outgoing",
          status: "live",
          lineShape: "curved",
          tagIds: [],
          technologies: [],
          links: [],
        },
      },
      {
        op: "showConnection",
        diagramId,
        connectionId: id,
        layout: { waypoints: [] },
      },
    ],
  });
  return id;
}

/** Show an existing model link on this diagram (no duplicate created). */
export async function showExistingConnection(
  diagramId: string,
  connectionId: string,
): Promise<void> {
  await dispatchAndRefresh({
    op: "showConnection",
    diagramId,
    connectionId,
    layout: { waypoints: [] },
  });
}

/** Hide a link from this diagram (model keeps it; toast offers Undo). */
export async function hideConnection(
  diagramId: string,
  connectionId: string,
): Promise<void> {
  const shown = snap.view?.diagram.connections[connectionId] != null;
  if (!shown) {
    showToast("Nothing to hide — this link is only rolled up here", false);
    return;
  }
  try {
    await dispatchAndRefresh({ op: "hideConnection", diagramId, connectionId });
  } catch (e) {
    console.error("hide connection failed", e);
    showToast("Could not hide link", false);
    return;
  }
  set({ selectedEdge: null, toast: "Hidden from diagram" });
}

/** Delete a link from the model entirely (diagrams + flow steps follow). */
export async function deleteConnectionFromModel(id: string): Promise<void> {
  await dispatchAndRefresh({ op: "deleteConnection", id });
  set({ selectedEdge: null });
}

export async function patchConnection(
  id: string,
  patch: Partial<{
    name: string;
    description: string;
    direction: "outgoing" | "bidirectional" | "none";
    status: "live" | "future" | "deprecated" | "removed";
    lineShape: "curved" | "straight" | "square";
    viaId: string | null;
    tagIds: string[];
    originId: string;
    targetId: string;
  }>,
): Promise<void> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) return;
  await dispatchAndRefresh({ op: "patchConnection", id, patch: clean as never });
}

/** Persist the label slide for this diagram (one ShowConnection undo step). */
export async function setEdgeLabelPosition(
  diagramId: string,
  connectionId: string,
  t: number,
): Promise<void> {
  const clamped = Math.min(Math.max(t, 0), 1);
  const prev = snap.view?.diagram.connections[connectionId];
  await dispatchAndRefresh({
    op: "showConnection",
    diagramId,
    connectionId,
    layout: { labelPosition: clamped, waypoints: prev?.waypoints ?? [] },
  });
}

/**
 * Re-point a link's end. "change" patches the model link (one undo step);
 * "new" keeps the old link and creates + shows a copy (one Batch undo step).
 */
export async function repointConnection(
  diagramId: string,
  connectionId: string,
  end: "from" | "to",
  newKey: string,
  mode: "change" | "new",
): Promise<void> {
  const conn = snap.doc.model.connections[connectionId];
  if (!conn) return;
  const newId = objectKeyToId(newKey, diagramId);
  if (!newId || !snap.doc.model.objects[newId]) return;
  if (mode === "change") {
    await patchConnection(connectionId, {
      [end === "from" ? "originId" : "targetId"]: newId,
    } as never);
    return;
  }
  const id = newConnectionId();
  await dispatchAndRefresh({
    op: "batch",
    commands: [
      {
        op: "connect",
        connection: {
          ...structuredClone(conn),
          id,
          originId: end === "from" ? newId : conn.originId,
          targetId: end === "to" ? newId : conn.targetId,
        },
      },
      { op: "showConnection", diagramId, connectionId: id, layout: { waypoints: [] } },
    ],
  });
}

/**
 * Drop-on-empty-canvas: create the object at the point, add its box, and
 * link sourceKey -> it, all as ONE Batch undo step.
 */
export async function createBoxAndConnect(
  kind: ObjectKind,
  name: string,
  at: { x: number; y: number },
  sourceKey: string,
  linkName: string,
): Promise<void> {
  const view = snap.view;
  if (view == null) return;
  const clean = linkName.trim();
  if (clean === "") return;
  const originId = objectKeyToId(sourceKey, view.diagram.id);
  if (!originId) return;
  const id = newObjectId();
  const connId = newConnectionId();
  const label = KIND_LABELS[kind];
  await dispatchAndRefresh({
    op: "batch",
    commands: [
      {
        op: "createObject",
        object: {
          id,
          name: name.trim() === "" ? `New ${label}` : name.trim(),
          type: kind,
          parentId: view.diagram.scopeObjectId ?? null,
          status: "live",
          external: false,
          caption: "",
          description: "",
          tagIds: [],
          technologies: [],
          links: [],
          groupIds: [],
          labels: {},
        },
      },
      {
        op: "addToDiagram",
        diagramId: view.diagram.id,
        objectId: id,
        rect: { x: snap8(at.x), y: snap8(at.y), w: 240, h: 120 },
      },
      {
        op: "connect",
        connection: {
          id: connId,
          originId,
          targetId: id,
          name: clean,
          description: "",
          direction: "outgoing",
          status: "live",
          lineShape: "curved",
          tagIds: [],
          technologies: [],
          links: [],
        },
      },
      {
        op: "showConnection",
        diagramId: view.diagram.id,
        connectionId: connId,
        layout: { waypoints: [] },
      },
    ],
  });
  set({ selection: [id] });
}

/**
 * Existing model links between the same two endpoints (or descendants
 * rolled up to them) that are NOT shown on this diagram: reuse candidates.
 */
export function reuseCandidates(
  diagramId: string,
  sourceKey: string,
  targetKey: string,
): { id: string; name: string; originId: string; targetId: string }[] {
  const doc = snap.doc;
  const out: { id: string; name: string; originId: string; targetId: string }[] = [];
  const shown = doc.diagrams[diagramId]?.connections ?? {};
  for (const c of Object.values(doc.model.connections)) {
    if (shown[c.id] != null) continue;
    const f = endpointKeyFor(doc, diagramId, c.originId);
    const t = endpointKeyFor(doc, diagramId, c.targetId);
    if (f == null || t == null) continue;
    const same =
      (f === sourceKey && t === targetKey) || (f === targetKey && t === sourceKey);
    if (same) out.push({ id: c.id, name: c.name, originId: c.originId, targetId: c.targetId });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Underlying real links of a rolled-up edge, with add-ability reasons. */
export function lowerConnections(diagramId: string, connIds: string[]): {
  id: string;
  name: string;
  originName: string;
  targetName: string;
  addable: boolean;
  reason: string | null;
}[] {
  const doc = snap.doc;
  const d = doc.diagrams[diagramId];
  return connIds.map((cid) => {
    const c = doc.model.connections[cid];
    if (!c) {
      return { id: cid, name: "", originName: "", targetName: "", addable: false, reason: "Link no longer exists." };
    }
    const originName = doc.model.objects[c.originId]?.name ?? c.originId;
    const targetName = doc.model.objects[c.targetId]?.name ?? c.targetId;
    if (d?.connections[cid] != null) {
      return { id: cid, name: c.name, originName, targetName, addable: false, reason: "Already on this diagram." };
    }
    const missing: string[] = [];
    if (!d?.boxes[c.originId]) missing.push(originName);
    if (!d?.boxes[c.targetId]) missing.push(targetName);
    if (missing.length > 0) {
      return {
        id: cid,
        name: c.name,
        originName,
        targetName,
        addable: false,
        reason: `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not on this diagram.`,
      };
    }
    return { id: cid, name: c.name, originName, targetName, addable: true, reason: null };
  });
}

/** Flows/steps that use a connection (for the delete confirm dialog). */
export function flowsUsingConnection(id: string): { flowName: string; steps: string[] }[] {
  const out: { flowName: string; steps: string[] }[] = [];
  const touches = (s: unknown, acc: string[]): void => {
    if (typeof s !== "object" || s === null) return;
    const r = s as Record<string, unknown>;
    if (r["viaConnectionId"] === id) {
      acc.push(typeof r["title"] === "string" ? (r["title"] as string) : "Untitled step");
    }
    const paths = r["paths"];
    if (Array.isArray(paths)) {
      for (const p of paths) {
        const steps = (p as Record<string, unknown>)?.["steps"];
        if (Array.isArray(steps)) for (const st of steps) touches(st, acc);
      }
    }
  };
  for (const f of Object.values(snap.doc.model.flows)) {
    const steps: string[] = [];
    if (Array.isArray(f.steps)) for (const st of f.steps) touches(st, steps);
    if (steps.length > 0) out.push({ flowName: f.name, steps });
  }
  return out;
}

// --- local UI state ----------------------------------------------------------

export function select(ids: string[]): void {
  const prev = snap.selection;
  const sameSel =
    prev.length === ids.length && prev.every((v, i) => v === ids[i]);
  const prevRen = snap.renamingId;
  snap = { ...snap, selection: [...ids], renamingId: null };
  if (prevRen !== null) {
    // A rename editor was open: full update so it unmounts.
    emit();
    emitSel();
  } else if (!sameSel) {
    // Selection-only: React Flow already updated its own visuals; only
    // selection subscribers (details panel, canvas refs) are notified, so
    // a click never re-renders the canvas tree.
    emitSel();
  }
}

export function setHover(id: string | null): void {
  if (snap.hover !== id) set({ hover: id });
}

export function setRenaming(id: string | null): void {
  set({ renamingId: id });
}

export function showToast(text: string, undo = true): void {
  set({ toast: text, toastUndo: undo });
}

export function clearToast(): void {
  set({ toast: null });
}

export function setQuickAdd(q: QuickAddState | null): void {
  set({ quickAdd: q });
}

/** Diagram "show all labels": persisted per diagram via PatchDiagram. */
export async function toggleShowAllLabels(): Promise<void> {
  const view = snap.view;
  if (view == null) return;
  const next = !(view.diagram.showAllLabels ?? false);
  await dispatchAndRefresh({
    op: "patchDiagram",
    id: view.diagram.id,
    showAllLabels: next,
  });
}

export function setConnectMode(m: ConnectModeState | null): void {
  if (snap.connectMode !== m) set({ connectMode: m });
}

export function setPendingLink(p: PendingLink | null): void {
  if (snap.pendingLink !== p) set({ pendingLink: p });
}

export function setSelectedEdge(s: SelectedEdgeInfo | null): void {
  if (snap.selectedEdge !== s) set({ selectedEdge: s });
}

export function setTool(t: CanvasToolId): void {
  if (snap.tool === t) return;
  // Entering / leaving connect mode follows the tool: connect tool arms the
  // keyboard connect mode (source picked by click); leaving it disarms.
  if (t === "connect") {
    set({ tool: t });
    if (snap.connectMode == null) {
      const sel = snap.selection.length === 1 ? snap.selection[0] : null;
      set({ connectMode: { source: sel, candidate: null } });
    }
    return;
  }
  if (snap.tool === "connect" && snap.connectMode != null) {
    set({ tool: t, connectMode: null });
    return;
  }
  set({ tool: t });
}

// --- canvas debug mirrors (view-only; written by FlowCanvas each render) ---

export interface SublinkInfo {
  testId: string;
  edgeIndex: number;
  subIndex: number;
  connId: string;
  connIds: string[];
  name: string;
  direction: string;
  arrowheads: number;
  status: string;
  lineShape: string;
  lower: boolean;
  viaId: string | null;
  viaRouted: boolean;
  labelPosition: number | null;
  fromKey: string;
  toKey: string;
  parentPort: boolean;
  labelVisible: boolean;
}

let debugZoom: number | null = null;
let debugFrame: Rect | null = null;
let debugCtxRects: Record<string, Rect> = {};
let debugHoverEdge: string | null = null;
let debugSelectedEdges: string[] = [];
let debugSublinks: SublinkInfo[] = [];

export function setDebugZoom(z: number): void {
  debugZoom = z;
}

export function setDebugFrameRect(r: Rect | null): void {
  debugFrame = r ? { ...r } : null;
}

export function setDebugCtxRects(r: Record<string, Rect>): void {
  debugCtxRects = { ...r };
}

export function setDebugHoverEdge(k: string | null): void {
  debugHoverEdge = k;
}

export function setDebugSelectedEdges(ids: string[]): void {
  debugSelectedEdges = [...ids];
}

export function setDebugSublinks(s: SublinkInfo[]): void {
  debugSublinks = [...s];
}

// --- read-only debug API for automated checks --------------------------------

function readResolvedTheme(): string {
  try {
    const t = document.documentElement.dataset.theme;
    if (t === "dark" || t === "light") return t;
  } catch {
    /* non-browser */
  }
  return "dark";
}

/** Canvas first-paint note for the drill split (view build -> painted). */
export function perfNoteDrillPaint(): void {
  if (perfState.lastDrillMs != null && perfState.lastDrillMs.paintMs === 0) {
    perfState.lastDrillMs = { ...perfState.lastDrillMs, paintMs: 0 };
  }
}

function exposeDebugApi(): void {
  try {
    const prev = (window as unknown as Record<string, unknown>).__speculum as
      | Record<string, unknown>
      | undefined;
    (window as unknown as Record<string, unknown>).__speculum = {
      // Preserve canvas-registered helpers (e.g. setZoom) across re-exposes.
      ...(prev != null && typeof prev === "object" ? prev : {}),
      perf: {
        get lastOpenMs() {
          return perfState.lastOpenMs;
        },
        get lastDrillMs() {
          return perfState.lastDrillMs;
        },
        get boxRenders() {
          return perfState.boxRenders;
        },
        get edgeRenders() {
          return perfState.edgeRenders;
        },
        /** App-clock click-to-settled for the last drill gesture. */
        get lastDrillClickMs() {
          return perfState.drillSettledT > perfState.drillClickT0
            ? perfState.drillSettledT - perfState.drillClickT0
            : null;
        },
        reset: () => perfResetRenders(),
      },
      getState: () => {
        const c = getLastSessionCounts();
        const conns: Record<string, Record<string, unknown>> = {};
        for (const [id, conn] of Object.entries(snap.doc.model.connections)) {
          conns[id] = {
            name: conn.name,
            originId: conn.originId,
            targetId: conn.targetId,
            direction: conn.direction,
            status: conn.status,
            lineShape: conn.lineShape,
            viaId: conn.viaId ?? null,
            labelPosition: conn.labelPosition ?? null,
          };
        }
        return {
          diagramId: snap.diagramId,
          rects: snap.view ? { ...snap.view.diagram.boxes } : {},
          viewport: snap.view ? (snap.view.diagram.viewport ?? null) : null,
          selection: [...snap.selection],
          counts: {
            objects: c.objects,
            links: c.connections,
            flows: c.flows,
          },
          theme: readResolvedTheme(),
          navStack: [...snap.navStack],
          navIndex: snap.navIndex,
          animating: snap.animating,
          drillAnim: snap.drillAnim,
          drillDuration:
            snap.drill != null ? Date.now() - snap.drill.startedAt : null,
          scope: snap.view?.scope?.id ?? snap.view?.diagram.scopeObjectId ?? null,
          contextTrays: snap.view?.contextTrays ? structuredClone(snap.view.contextTrays) : [],
          // V1: scope tray subtitle + packing constants for checks.
          scopeInfo: (() => {
            const s = snap.view?.scope;
            if (s == null) return null;
            const o = snap.doc.model.objects[s.id] as unknown as
              | { caption?: string }
              | undefined;
            return {
              id: s.id,
              name: s.name,
              kind: s.kind,
              caption: o?.caption ?? "",
            };
          })(),
          layout: { ...PACKING },
          edges: snap.view
            ? snap.view.edges.map((e) => ({
                from: endpointBox(e.from),
                to: endpointBox(e.to),
              }))
            : [],
          viewports: Object.fromEntries(
            Object.entries(snap.viewports).map(([k, v]) => [k, { ...v }]),
          ),
          // M6: edge + frame introspection for automated checks.
          zoom: debugZoom,
          showAllLabels: snap.showAllLabels,
          labelsOn: snap.view?.diagram.showAllLabels ?? false,
          frameRect: debugFrame ? { ...debugFrame } : null,
          ctxRects: { ...debugCtxRects },
          hoverEdge: debugHoverEdge,
          selectedEdges: [...debugSelectedEdges],
          selectedEdge: snap.selectedEdge ? { ...snap.selectedEdge } : null,
          connectMode: snap.connectMode ? { ...snap.connectMode } : null,
          pendingLink: snap.pendingLink ? { ...snap.pendingLink } : null,
          quickAdd: snap.quickAdd ? { ...snap.quickAdd } : null,
          shownConnections: snap.view ? Object.keys(snap.view.diagram.connections).sort() : [],
          sublinks: debugSublinks.map((s) => ({ ...s })),
          connections: conns,
          tool: snap.tool,
        };
      },
    };
  } catch {
    /* non-browser */
  }
}
exposeDebugApi();
