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
}

export interface DrillState {
  dir: "in" | "up";
  /** Screen rect of the box drilled from (in) or into (up); null while measuring. */
  rect: ScreenRect | null;
  /** Box label shown on the snapshot overlay. */
  label: string;
  /** Reduced motion: plain cross-fade, no scale transform. */
  reduced: boolean;
  startedAt: number;
}

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
  quickAdd: QuickAddState | null;
  error: string | null;
  /** Browser-like navigation stack (diagram ids) and current position. */
  navStack: string[];
  navIndex: number;
  /** True while a drill animation is running. */
  animating: boolean;
  drill: DrillState | null;
  /** Last saved viewport per diagram (exact pan/zoom restore). */
  viewports: Record<string, Viewport>;
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
  quickAdd: null,
  error: null,
  navStack: [],
  navIndex: -1,
  animating: false,
  drill: null,
  viewports: {},
};

let snap: ModelSnapshot = initial;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function set(patch: Partial<ModelSnapshot>): void {
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
    set({ animating: false, drill: null });
  }
}

function drillDurationMs(dir: "in" | "up", reduced: boolean): number {
  if (reduced) return 120;
  return dir === "in" ? 240 : 200;
}

// --- loading ---------------------------------------------------------------

async function loadView(diagramId: string): Promise<void> {
  try {
    const ensured = await bridgeEnsureLayout(diagramId);
    applySessionCounts(ensured.counts);
    const [doc, view, diagrams] = await Promise.all([
      bridgeGetDocument(),
      bridgeGetDiagramView(diagramId),
      bridgeListDiagrams(),
    ]);
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
    });
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
  // click-to-settled duration matches the motion tokens (~240/200/120ms)
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
  if (drill) {
    clearAnimTimer();
    set({
      animating: true,
      drill: { ...drill, reduced, startedAt: Date.now() },
      navStack: stack,
      navIndex: idx,
    });
  } else {
    set({ navStack: stack, navIndex: idx });
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
    // anchored to the navigation start (see t0 above).
    clearAnimTimer();
    const wait = Math.max(0, duration - (Date.now() - t0));
    animTimer = window.setTimeout(() => {
      animTimer = null;
      finishDrill();
    }, wait);
  }
}

/** Initial load after the session is clean (call once). */
export async function bootModel(): Promise<void> {
  clearAnimTimer();
  set({ status: "loading", error: null });
  try {
    const [doc, diagrams] = await Promise.all([
      bridgeGetDocument(),
      bridgeListDiagrams(),
    ]);
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
    set({ doc, diagrams, navStack: [pick], navIndex: 0 });
    await loadView(pick);
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

/** Drill into a box (badge click, Enter, details button). */
export async function zoomInto(objectId: string, rect: ScreenRect | null): Promise<void> {
  const from = snap.diagramId;
  if (from == null) return;
  const obj = snap.doc.model.objects[objectId];
  const label = obj?.name ?? "";
  const reduced = prefersReducedMotion();
  clearAnimTimer();
  set({
    animating: true,
    drill: { dir: "in", rect, label, reduced, startedAt: Date.now() },
  });
  try {
    const res = await bridgeZoomInto(from, objectId);
    applySessionCounts(await bridgeGetState().then((s) => s.counts));
    await navigateTo(res.diagramId, "push", {
      dir: "in",
      rect,
      label,
      reduced,
    });
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
  // Rect is measured after the parent loads (scope box position there).
  set({
    animating: true,
    drill: { dir: "up", rect: null, label, reduced, startedAt: Date.now() },
  });
  await navigateTo(target, "up", { dir: "up", rect: null, label, reduced });
  // Now the parent view is rendered with its viewport pre-applied: measure
  // where the scope box sits so the overlay can shrink into it.
  if (fromScope) {
    try {
      const el = document.querySelector(
        `[data-testid="box-${CSS.escape(fromScope)}"]`,
      );
      const canvas = document.querySelector(".flow-canvas");
      if (el && canvas) {
        const r = el.getBoundingClientRect();
        const c = canvas.getBoundingClientRect();
        set({
          drill: {
            dir: "up",
            rect: { x: r.x - c.x, y: r.y - c.y, w: r.width, h: r.height },
            label,
            reduced,
            startedAt: Date.now(),
          },
          animating: true,
        });
      }
    } catch {
      /* measuring must never break navigation */
    }
  }
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
    drill: { dir: "up", rect: null, label, reduced, startedAt: Date.now() },
  });
  await navigateTo(diagramId, "up", { dir: "up", rect: null, label, reduced });
  if (fromScope && snap.view?.diagram.boxes[fromScope]) {
    try {
      const el = document.querySelector(
        `[data-testid="box-${CSS.escape(fromScope)}"]`,
      );
      const canvas = document.querySelector(".flow-canvas");
      if (el && canvas) {
        const r = el.getBoundingClientRect();
        const c = canvas.getBoundingClientRect();
        set({
          drill: {
            dir: "up",
            rect: { x: r.x - c.x, y: r.y - c.y, w: r.width, h: r.height },
            label,
            reduced,
            startedAt: Date.now(),
          },
          animating: true,
        });
      }
    } catch {
      /* ignore */
    }
  }
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
      set({
        doc,
        diagrams,
        view,
        rev: countsRev,
        selection: snap.selection.filter((id) => view.diagram.boxes[id] != null),
        viewports,
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

// --- local UI state ----------------------------------------------------------

export function select(ids: string[]): void {
  set({ selection: ids, renamingId: null });
}

export function setHover(id: string | null): void {
  if (snap.hover !== id) set({ hover: id });
}

export function setRenaming(id: string | null): void {
  set({ renamingId: id });
}

export function showToast(text: string): void {
  set({ toast: text });
}

export function clearToast(): void {
  set({ toast: null });
}

export function setQuickAdd(q: QuickAddState | null): void {
  set({ quickAdd: q });
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

function exposeDebugApi(): void {
  try {
    (window as unknown as Record<string, unknown>).__speculum = {
      getState: () => {
        const c = getLastSessionCounts();
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
          drillDuration:
            snap.drill != null ? Date.now() - snap.drill.startedAt : null,
          scope: snap.view?.scope?.id ?? snap.view?.diagram.scopeObjectId ?? null,
          edges: snap.view
            ? snap.view.edges.map((e) => ({
                from: endpointBox(e.from),
                to: endpointBox(e.to),
              }))
            : [],
          viewports: Object.fromEntries(
            Object.entries(snap.viewports).map(([k, v]) => [k, { ...v }]),
          ),
        };
      },
    };
  } catch {
    /* non-browser */
  }
}
exposeDebugApi();
