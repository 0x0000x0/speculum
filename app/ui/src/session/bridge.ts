/**
 * Bridge to the Rust backend (Tauri commands) with an in-browser mock
 * fallback so `pnpm dev` renders outside Tauri.
 *
 * Inside Tauri (`window.__TAURI_INTERNALS__` defined) every call invokes
 * the matching Rust command from `app/src-tauri/src/main.rs` (invoke args
 * use camelCase, matching Tauri v2's default parameter mapping).
 * Outside Tauri an in-memory mock answers instead; the mock persists the
 * document to localStorage (key "speculum.mock.doc") so reloads behave
 * like close/reopen, and honours `?mock=fresh|sample|recovery`.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  emptyDocument,
  type Command,
  type ContextTray,
  type DiagramInfo,
  type DiagramView,
  type Rect,
  type SpecDocument,
  type ViewEdge,
} from "../model/types";
import { endpointBox } from "../model/endpoints";

export interface SessionCounts {
  objects: number;
  connections: number;
  tags: number;
  diagrams: number;
  flows: number;
  rev: number;
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

export interface EnsureLayoutResult {
  placed: number;
  counts: SessionCounts;
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

function countsOf(doc: SpecDocument, rev: number): SessionCounts {
  return {
    objects: Object.keys(doc.model.objects).length,
    connections: Object.keys(doc.model.connections).length,
    tags: Object.keys(doc.model.tags).length,
    diagrams: Object.keys(doc.diagrams).length,
    flows: Object.keys(doc.model.flows).length,
    rev,
  };
}

// ---------------------------------------------------------------------------
// In-browser mock: command application (mirrors speculum-core semantics)
// ---------------------------------------------------------------------------

function fail(msg: string): never {
  throw new Error(msg);
}

function childrenOf(doc: SpecDocument, id: string): string[] {
  return Object.values(doc.model.objects)
    .filter((o) => o.parentId === id)
    .map((o) => o.id)
    .sort();
}

function subtreeIds(doc: SpecDocument, root: string): Set<string> {
  const seen = new Set<string>([root]);
  const stack = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const o of Object.values(doc.model.objects)) {
      if (o.parentId === cur && !seen.has(o.id)) {
        seen.add(o.id);
        stack.push(o.id);
      }
    }
  }
  return seen;
}

function isAncestor(doc: SpecDocument, a: string, b: string): boolean {
  if (a === b) return false;
  const seen = new Set<string>([b]);
  let cur = doc.model.objects[b]?.parentId ?? null;
  while (cur) {
    if (cur === a) return true;
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = doc.model.objects[cur]?.parentId ?? null;
  }
  return false;
}

/** Remove flow steps (any depth) touching removed objects/connections. */
function stripFlowSteps(
  doc: SpecDocument,
  objs: Set<string>,
  conns: Set<string>,
): void {
  const touches = (s: Record<string, unknown>): boolean => {
    for (const k of ["originId", "targetId", "objectId"]) {
      const v = s[k];
      if (typeof v === "string" && objs.has(v)) return true;
    }
    const via = s["viaConnectionId"];
    if (typeof via === "string" && conns.has(via)) return true;
    return false;
  };
  const cleanSteps = (steps: unknown[]): unknown[] => {
    const out: unknown[] = [];
    for (const st of steps) {
      if (typeof st !== "object" || st === null) continue;
      const s = st as Record<string, unknown>;
      if (touches(s)) continue;
      const paths = s["paths"];
      if (Array.isArray(paths)) {
        const next = paths.map((p) => {
          if (typeof p !== "object" || p === null) return p;
          const pp = p as Record<string, unknown>;
          return {
            ...pp,
            steps: Array.isArray(pp["steps"])
              ? cleanSteps(pp["steps"] as unknown[])
              : pp["steps"],
          };
        });
        out.push({ ...s, paths: next });
      } else {
        out.push(s);
      }
    }
    return out;
  };
  for (const f of Object.values(doc.model.flows)) {
    if (Array.isArray(f.steps)) f.steps = cleanSteps(f.steps);
  }
}

function applyCommand(doc: SpecDocument, cmd: Command): void {
  switch (cmd.op) {
    case "createObject": {
      const o = cmd.object;
      if (!o.id) fail("object id is empty");
      if (doc.model.objects[o.id]) fail(`duplicate id: ${o.id}`);
      if (o.parentId && !doc.model.objects[o.parentId])
        fail(`not found: ${o.parentId}`);
      doc.model.objects[o.id] = { ...o };
      return;
    }
    case "deleteObject": {
      if (!doc.model.objects[cmd.id]) fail(`not found: ${cmd.id}`);
      const removed = subtreeIds(doc, cmd.id);
      const removedConns = new Set(
        Object.values(doc.model.connections)
          .filter(
            (c) =>
              removed.has(c.originId) ||
              removed.has(c.targetId) ||
              (c.viaId != null && removed.has(c.viaId)),
          )
          .map((c) => c.id),
      );
      for (const oid of removed) delete doc.model.objects[oid];
      for (const cid of removedConns) delete doc.model.connections[cid];
      // Diagrams scoped to deleted objects disappear entirely.
      for (const [did, d] of Object.entries(doc.diagrams)) {
        if (d.scopeObjectId && removed.has(d.scopeObjectId))
          delete doc.diagrams[did];
      }
      const deadDiagrams = new Set<string>();
      for (const d of Object.values(doc.diagrams)) {
        for (const bid of Object.keys(d.boxes))
          if (removed.has(bid)) delete d.boxes[bid];
        for (const cid of Object.keys(d.connections))
          if (removedConns.has(cid)) delete d.connections[cid];
        for (const [objId, target] of Object.entries(d.landing)) {
          if (removed.has(objId) || deadDiagrams.has(target))
            delete d.landing[objId];
          if (!doc.diagrams[target]) delete d.landing[objId];
        }
        void deadDiagrams;
      }
      for (const o of Object.values(doc.model.objects)) {
        if (o.groupIds.some((g) => removed.has(g)))
          o.groupIds = o.groupIds.filter((g) => !removed.has(g));
      }
      for (const c of Object.values(doc.model.connections)) {
        if (c.viaId && removed.has(c.viaId)) c.viaId = null;
      }
      for (const f of Object.values(doc.model.flows)) {
        if (f.diagramId && !doc.diagrams[f.diagramId]) f.diagramId = null;
      }
      stripFlowSteps(doc, removed, removedConns);
      return;
    }
    case "patchObject": {
      const o = doc.model.objects[cmd.id];
      if (!o) fail(`not found: ${cmd.id}`);
      Object.assign(o, cmd.patch);
      return;
    }
    case "reparent": {
      const o = doc.model.objects[cmd.id];
      if (!o) fail(`not found: ${cmd.id}`);
      const np = cmd.newParent ?? null;
      if (np != null) {
        if (!doc.model.objects[np]) fail(`not found: ${np}`);
        if (np === cmd.id || isAncestor(doc, cmd.id, np))
          fail("would create cycle");
      }
      o.parentId = np;
      return;
    }
    case "connect": {
      const c = cmd.connection;
      if (!c.id) fail("connection id is empty");
      if (doc.model.connections[c.id]) fail(`duplicate id: ${c.id}`);
      if (!doc.model.objects[c.originId]) fail(`not found: ${c.originId}`);
      if (!doc.model.objects[c.targetId]) fail(`not found: ${c.targetId}`);
      doc.model.connections[c.id] = { ...c };
      return;
    }
    case "deleteConnection": {
      if (!doc.model.connections[cmd.id]) fail(`not found: ${cmd.id}`);
      delete doc.model.connections[cmd.id];
      for (const d of Object.values(doc.diagrams))
        delete d.connections[cmd.id];
      stripFlowSteps(doc, new Set(), new Set([cmd.id]));
      return;
    }
    case "patchConnection": {
      const c = doc.model.connections[cmd.id];
      if (!c) fail(`not found: ${cmd.id}`);
      Object.assign(c, cmd.patch);
      return;
    }
    case "createTag": {
      if (!cmd.tag.id) fail("tag id is empty");
      if (doc.model.tags[cmd.tag.id]) fail(`duplicate id: ${cmd.tag.id}`);
      doc.model.tags[cmd.tag.id] = { ...cmd.tag };
      return;
    }
    case "deleteTag": {
      if (!doc.model.tags[cmd.id]) fail(`not found: ${cmd.id}`);
      delete doc.model.tags[cmd.id];
      for (const o of Object.values(doc.model.objects))
        o.tagIds = o.tagIds.filter((t) => t !== cmd.id);
      for (const c of Object.values(doc.model.connections))
        c.tagIds = c.tagIds.filter((t) => t !== cmd.id);
      return;
    }
    case "createDiagram": {
      const d = cmd.diagram;
      if (!d.id) fail("diagram id is empty");
      if (doc.diagrams[d.id]) fail(`duplicate id: ${d.id}`);
      if (d.scopeObjectId && !doc.model.objects[d.scopeObjectId])
        fail(`not found: ${d.scopeObjectId}`);
      doc.diagrams[d.id] = { ...d, boxes: { ...d.boxes } };
      return;
    }
    case "deleteDiagram": {
      const d = doc.diagrams[cmd.id];
      if (!d) fail(`not found: ${cmd.id}`);
      delete doc.diagrams[cmd.id];
      for (const f of Object.values(doc.model.flows))
        if (f.diagramId === cmd.id) f.diagramId = null;
      for (const other of Object.values(doc.diagrams))
        for (const [objId, target] of Object.entries(other.landing))
          if (target === cmd.id) delete other.landing[objId];
      return;
    }
    case "patchDiagram": {
      const d = doc.diagrams[cmd.id];
      if (!d) fail(`not found: ${cmd.id}`);
      if (cmd.name !== undefined) d.name = cmd.name;
      if (cmd.description !== undefined) d.description = cmd.description;
      if (cmd.order !== undefined) d.order = cmd.order;
      if (cmd.pinned !== undefined) d.pinned = cmd.pinned;
      if (cmd.autoPlaced !== undefined) d.autoPlaced = cmd.autoPlaced;
      if (cmd.showAllLabels !== undefined) d.showAllLabels = cmd.showAllLabels;
      return;
    }
    case "addToDiagram": {
      const d = doc.diagrams[cmd.diagramId];
      if (!d) fail(`not found: ${cmd.diagramId}`);
      if (!doc.model.objects[cmd.objectId]) fail(`not found: ${cmd.objectId}`);
      if (d.scopeObjectId === cmd.objectId)
        fail(
          `cannot add scope object '${cmd.objectId}' to its own diagram '${cmd.diagramId}'`,
        );
      d.boxes[cmd.objectId] = { ...cmd.rect };
      return;
    }
    case "removeFromDiagram": {
      const d = doc.diagrams[cmd.diagramId];
      if (!d) fail(`not found: ${cmd.diagramId}`);
      if (!d.boxes[cmd.objectId]) fail(`not found: ${cmd.objectId}`);
      delete d.boxes[cmd.objectId];
      for (const cid of Object.keys(d.connections)) {
        const c = doc.model.connections[cid];
        if (c && (c.originId === cmd.objectId || c.targetId === cmd.objectId))
          delete d.connections[cid];
      }
      return;
    }
    case "moveBoxes": {
      const d = doc.diagrams[cmd.diagramId];
      if (!d) fail(`not found: ${cmd.diagramId}`);
      for (const [bid, r] of Object.entries(cmd.moves)) d.boxes[bid] = { ...r };
      return;
    }
    case "applyLayout": {
      const d = doc.diagrams[cmd.diagramId];
      if (!d) fail(`not found: ${cmd.diagramId}`);
      d.boxes = { ...cmd.boxes };
      return;
    }
    case "showConnection": {
      const d = doc.diagrams[cmd.diagramId];
      if (!d) fail(`not found: ${cmd.diagramId}`);
      if (!doc.model.connections[cmd.connectionId])
        fail(`not found: ${cmd.connectionId}`);
      d.connections[cmd.connectionId] = { ...cmd.layout };
      return;
    }
    case "hideConnection": {
      const d = doc.diagrams[cmd.diagramId];
      if (!d) fail(`not found: ${cmd.diagramId}`);
      if (!d.connections[cmd.connectionId]) fail(`not found: ${cmd.connectionId}`);
      delete d.connections[cmd.connectionId];
      return;
    }
    case "setViewport": {
      const d = doc.diagrams[cmd.diagramId];
      if (!d) fail(`not found: ${cmd.diagramId}`);
      d.viewport = cmd.viewport ?? null;
      return;
    }
    case "setLanding": {
      const d = doc.diagrams[cmd.diagramId];
      if (!d) fail(`not found: ${cmd.diagramId}`);
      if (!doc.model.objects[cmd.objectId]) fail(`not found: ${cmd.objectId}`);
      if (cmd.target != null && !doc.diagrams[cmd.target])
        fail(`not found: ${cmd.target}`);
      if (cmd.target == null) delete d.landing[cmd.objectId];
      else d.landing[cmd.objectId] = cmd.target;
      return;
    }
    case "batch": {
      const snapshot = structuredClone(doc);
      try {
        for (const c of cmd.commands) applyCommand(doc, c);
      } catch (e) {
        // Atomic like Rust: restore on any failure.
        const restored = snapshot as SpecDocument;
        doc.schema = restored.schema;
        doc.meta = restored.meta;
        doc.model = restored.model;
        doc.diagrams = restored.diagrams;
        throw e;
      }
      return;
    }
    default:
      fail(`unsupported command in mock: ${(cmd as Command).op}`);
  }
}

// --- rollup (mirrors speculum-core rollup::diagram_edges) -------------------

function ancestorsOf(doc: SpecDocument, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = doc.model.objects[id]?.parentId ?? null;
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const o = doc.model.objects[cur];
    if (!o) break;
    out.push(o.id);
    cur = o.parentId ?? null;
  }
  return out;
}

function mapToBox(
  doc: SpecDocument,
  diagramId: string,
  objectId: string,
): { box: string; rolled: boolean } | null {
  const d = doc.diagrams[diagramId];
  if (!d) return null;
  if (d.boxes[objectId]) return { box: objectId, rolled: false };
  for (const anc of ancestorsOf(doc, objectId)) {
    if (d.boxes[anc]) return { box: anc, rolled: true };
  }
  return null;
}

function mockDiagramEdges(doc: SpecDocument, diagramId: string): ViewEdge[] {
  const d = doc.diagrams[diagramId];
  if (!d) return [];
  const scope = d.scopeObjectId ?? null;
  const grouped = new Map<string, ViewEdge>();
  // Same wire contract as Rust: { box: id } or { frame: true } (tolerates
  // the legacy bare "frame" string when reading).
  const key = (e: ViewEdge["from"] | ViewEdge["to"]) => {
    const b = endpointBox(e);
    return b != null ? `box:${b}` : "__frame__";
  };
  const cids = Object.keys(doc.model.connections).sort();
  for (const cid of cids) {
    const c = doc.model.connections[cid];
    const from =
      scope != null && c.originId === scope
        ? { frame: true as const }
        : null;
    const to =
      scope != null && c.targetId === scope ? { frame: true as const } : null;
    const fMapped = from ?? mapToBox(doc, diagramId, c.originId);
    const tMapped = to ?? mapToBox(doc, diagramId, c.targetId);
    if (!fMapped || !tMapped) continue;
    const fEp = from ?? { box: (fMapped as { box: string }).box };
    const tEp = to ?? { box: (tMapped as { box: string }).box };
    const fk = key(fEp);
    const tk = key(tEp);
    if (fk === tk) continue;
    const lower =
      ("rolled" in (fMapped as object) &&
        (fMapped as { rolled: boolean }).rolled) ||
      ("rolled" in (tMapped as object) && (tMapped as { rolled: boolean }).rolled);
    const gk = `${fk}\n${tk}`;
    const existing = grouped.get(gk);
    const bidi = c.direction === "bidirectional";
    if (existing) {
      existing.connectionIds.push(cid);
      existing.connectionIds.sort();
      existing.lower = existing.lower || lower;
      existing.explicit = existing.explicit || !!d.connections[cid];
      existing.bidirectional = existing.bidirectional || bidi;
    } else {
      grouped.set(gk, {
        from: fEp,
        to: tEp,
        connectionIds: [cid],
        lower,
        explicit: !!d.connections[cid],
        bidirectional: bidi,
      });
    }
  }
  return [...grouped.values()].sort((a, b) =>
    key(a.from) === key(b.from)
      ? key(a.to).localeCompare(key(b.to))
      : key(a.from).localeCompare(key(b.from)),
  );
}

// --- context trays (mirrors speculum-core context::context_trays EXACTLY) ---

function subtreeOf(doc: SpecDocument, root: string): Set<string> {
  const seen = new Set<string>([root]);
  const stack = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const o of Object.values(doc.model.objects)) {
      if ((o.parentId ?? null) === cur && !seen.has(o.id)) {
        seen.add(o.id);
        stack.push(o.id);
      }
    }
  }
  return seen;
}

function mockContextTrays(doc: SpecDocument, diagramId: string): ContextTray[] {
  const d = doc.diagrams[diagramId];
  if (!d) return [];
  const scopeId = d.scopeObjectId ?? null;
  if (scopeId == null) return [];
  const scopeObj = doc.model.objects[scopeId];
  if (!scopeObj) return [];
  const parent = scopeObj.parentId ?? null;
  const siblings = Object.values(doc.model.objects)
    .filter((o) => (o.parentId ?? null) === parent && o.id !== scopeId)
    .sort((a, b) => (a.name === b.name ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.name < b.name ? -1 : 1));
  const scopeSub = subtreeOf(doc, scopeId);
  const cids = Object.keys(doc.model.connections).sort();
  const trays: ContextTray[] = [];
  for (const sib of siblings) {
    const sibSub = subtreeOf(doc, sib.id);
    const involved = new Map<string, { objectId: string; name: string; kind: typeof sib.type }>();
    for (const cid of cids) {
      const c = doc.model.connections[cid];
      const oInSib = sibSub.has(c.originId);
      const tInSib = sibSub.has(c.targetId);
      const oInScope = scopeSub.has(c.originId);
      const tInScope = scopeSub.has(c.targetId);
      if (!((oInSib && tInScope) || (tInSib && oInScope))) continue;
      for (const end of [c.originId, c.targetId]) {
        if (!sibSub.has(end) || end === sib.id) continue;
        let cur = end;
        let guard = 0;
        while (guard < 1024) {
          guard += 1;
          const p = doc.model.objects[cur]?.parentId ?? null;
          if (p === sib.id) break;
          if (p == null) break;
          cur = p;
        }
        const o = doc.model.objects[cur];
        if (o && (o.parentId ?? null) === sib.id) {
          involved.set(`${o.name}\n${o.id}`, { objectId: o.id, name: o.name, kind: o.type });
        }
      }
    }
    if (involved.size === 0) continue;
    const children = [...involved.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([, v]) => v);
    trays.push({
      objectId: sib.id,
      name: sib.name,
      kind: sib.type,
      caption: sib.caption,
      side: trays.length % 2 === 0 ? "right" : "left",
      children,
    });
  }
  return trays;
}

function mockDiagramView(doc: SpecDocument, diagramId: string): DiagramView {
  const diagram = doc.diagrams[diagramId];
  if (!diagram) fail(`unknown diagram: ${diagramId}`);
  const scopeId = diagram.scopeObjectId ?? null;
  const bids = Object.keys(diagram.boxes)
    .sort()
    .filter((b) => b !== scopeId);
  const objects = bids
    .map((b) => doc.model.objects[b])
    .filter((o) => o != null);
  const childCounts: Record<string, number> = {};
  for (const b of bids) childCounts[b] = childrenOf(doc, b).length;
  const edges = mockDiagramEdges(doc, diagramId);
  const contextTrays = mockContextTrays(doc, diagramId);
  const breadcrumb: { id: string; name: string }[] = [];
  if (diagram.scopeObjectId) {
    const chain = ancestorsOf(doc, diagram.scopeObjectId).reverse();
    for (const a of chain) {
      const o = doc.model.objects[a];
      if (o) breadcrumb.push({ id: o.id, name: o.name });
    }
    const scope = doc.model.objects[diagram.scopeObjectId];
    breadcrumb.push({
      id: diagram.scopeObjectId,
      name: scope ? scope.name : "",
    });
  }
  const scopeObj = scopeId ? doc.model.objects[scopeId] : null;
  return {
    diagram: structuredClone(diagram),
    objects,
    childCounts,
    edges,
    contextTrays,
    breadcrumb,
    scope: scopeObj
      ? { id: scopeObj.id, name: scopeObj.name, kind: scopeObj.type }
      : null,
  };
}

// --- drill-down (mirrors speculum-core zoom::zoom_target + main.rs zoom_into)

type MockZoomTarget =
  | { kind: "existing"; diagramId: string }
  | { kind: "create"; level: "context" | "app" | "component"; suggestedName: string }
  | { kind: "none" };

function levelWord(level: string): string {
  return level === "app" ? "Apps" : level === "component" ? "Internals" : "Landscape";
}

function mockZoomTarget(
  doc: SpecDocument,
  fromDiagramId: string,
  objectId: string,
): MockZoomTarget {
  const from = doc.diagrams[fromDiagramId];
  if (from?.landing[objectId] && doc.diagrams[from.landing[objectId]]) {
    return { kind: "existing", diagramId: from.landing[objectId] };
  }
  const scoped = Object.values(doc.diagrams)
    .filter((d) => d.scopeObjectId === objectId)
    .sort((a, b) =>
      a.order === b.order
        ? a.name === b.name
          ? a.id.localeCompare(b.id)
          : a.name.localeCompare(b.name)
        : a.order - b.order,
    );
  if (scoped.length > 0) return { kind: "existing", diagramId: scoped[0].id };
  const obj = doc.model.objects[objectId];
  if (!obj) return { kind: "none" };
  const fromLevel = from?.level ?? "context";
  let level: "context" | "app" | "component" | null = null;
  if (obj.type === "system") level = "app";
  else if (obj.type === "app" || obj.type === "store") level = "component";
  else if (obj.type === "group") level = fromLevel;
  else if (obj.type === "component" && childrenOf(doc, objectId).length > 0)
    level = fromLevel;
  if (!level) return { kind: "none" };
  return { kind: "create", level, suggestedName: `${obj.name} ${levelWord(level)}` };
}

function mockZoomInto(doc: SpecDocument, fromDiagramId: string, objectId: string): { diagramId: string; created: boolean } {
  const t = mockZoomTarget(doc, fromDiagramId, objectId);
  if (t.kind === "existing") return { diagramId: t.diagramId, created: false };
  if (t.kind === "none") fail(`object is not zoomable: ${objectId}`);
  const level = (t as { level: "context" | "app" | "component" }).level;
  const suggestedName = (t as { suggestedName: string }).suggestedName;
  let seedIds = childrenOf(doc, objectId);
  if (doc.model.objects[objectId]?.type === "group") {
    for (const o of Object.values(doc.model.objects)) {
      if (o.groupIds.includes(objectId) && !seedIds.includes(o.id)) seedIds.push(o.id);
    }
  }
  seedIds = seedIds.filter((id) => id !== objectId).sort();
  const slugRaw = objectId
    .replace(/^obj-/, "")
    .split("")
    .map((c) => (/[A-Za-z0-9]/.test(c) ? c : "-"))
    .join("")
    .replace(/^-+|-+$/g, "");
  const slug = slugRaw === "" ? "diagram" : slugRaw;
  let newId = `dg-${slug}`;
  let n = 2;
  while (doc.diagrams[newId]) {
    newId = `dg-${slug}-${n}`;
    n += 1;
  }
  const order = Math.max(0, ...Object.values(doc.diagrams).map((d) => d.order)) + 1;
  // Placeholder zero rects, then place like speculum-layout.
  const saved = doc.diagrams[newId];
  void saved;
  doc.diagrams[newId] = {
    id: newId,
    name: "",
    level,
    scopeObjectId: objectId,
    description: "",
    order,
    pinned: false,
    boxes: Object.fromEntries(seedIds.map((id) => [id, { x: 0, y: 0, w: 0, h: 0 }])),
    connections: {},
    landing: {},
    autoPlaced: false,
    showAllLabels: false,
    created: "",
    modified: "",
  };
  const placed = mockPlaceMissing(doc, newId);
  const boxes: Record<string, Rect> = {};
  for (const id of seedIds) {
    if (placed[id]) boxes[id] = placed[id];
  }
  delete doc.diagrams[newId];
  applyCommand(doc, {
    op: "batch",
    commands: [
      {
        op: "createDiagram",
        diagram: {
          id: newId,
          name: suggestedName,
          level,
          scopeObjectId: objectId,
          description: "",
          order,
          pinned: false,
          boxes,
          connections: {},
          landing: {},
          autoPlaced: false,
          showAllLabels: false,
          created: "",
          modified: "",
        },
      },
    ],
  });
  return { diagramId: newId, created: true };
}

function mockDiagramParent(doc: SpecDocument, diagramId: string): string | null {
  const d = doc.diagrams[diagramId];
  if (!d || !d.scopeObjectId) return null;
  const holders = Object.values(doc.diagrams)
    .filter((o) => o.id !== diagramId && o.boxes[d.scopeObjectId!])
    .sort((a, b) =>
      a.order === b.order
        ? a.name === b.name
          ? a.id.localeCompare(b.id)
          : a.name.localeCompare(b.name)
        : a.order - b.order,
    );
  return holders.length > 0 ? holders[0].id : null;
}

// --- first-open placement (mirrors speculum-layout::place_missing) ----------

const KIND_RANK: Record<string, number> = {
  actor: 0,
  system: 1,
  group: 2,
  app: 3,
  store: 4,
  component: 5,
};

/**
 * First-open placement. Mirrors speculum-layout::place_missing EXACTLY
 * (same JSON shapes rule): scoped diagrams pack 120x120 squares on a 180
 * step (60px gaps); the top level uses the 220x110 wide variant; the
 * vertical gap is 120 only between rows joined by labelled links.
 */
export const PACKING = {
  boxS: 120,
  cell: 180,
  gap: 60,
  gapLabelRow: 120,
  boxWideW: 220,
  boxWideH: 110,
  framePad: 30,
  frameHeader: 72,
} as const;

function gridCols(n: number): number {
  if (n <= 0) return 1;
  let cols = Math.ceil(Math.sqrt(n));
  if (n > 16) cols = Math.min(6, Math.max(cols, Math.ceil(Math.sqrt((n * 4) / 3))));
  else cols = Math.min(6, cols);
  return Math.max(1, cols);
}

function orderByConnectivity(
  doc: SpecDocument,
  diagramId: string,
  missing: { id: string; rank: number; name: string }[],
): string[] {
  const missingSet = new Set(missing.map((m) => m.id));
  const d = doc.diagrams[diagramId];
  const onDiagram = (oid: string): boolean => !!d?.boxes[oid];
  const adj = new Map<string, Set<string>>();
  const degree = new Map<string, number>();
  for (const m of missing) {
    adj.set(m.id, new Set());
    degree.set(m.id, 0);
  }
  for (const c of Object.values(doc.model.connections)) {
    const aIn = missingSet.has(c.originId);
    const bIn = missingSet.has(c.targetId);
    if (aIn && bIn) {
      adj.get(c.originId)!.add(c.targetId);
      adj.get(c.targetId)!.add(c.originId);
      degree.set(c.originId, (degree.get(c.originId) ?? 0) + 1);
      degree.set(c.targetId, (degree.get(c.targetId) ?? 0) + 1);
    } else if (aIn && onDiagram(c.targetId)) {
      degree.set(c.originId, (degree.get(c.originId) ?? 0) + 1);
    } else if (bIn && onDiagram(c.originId)) {
      degree.set(c.targetId, (degree.get(c.targetId) ?? 0) + 1);
    }
  }
  const byId = new Map(missing.map((m) => [m.id, m]));
  const unplaced = new Set(missing.map((m) => m.id));
  const placed: string[] = [];
  const placedSet = new Set<string>();
  const cmp = (
    a: { linked: number; deg: number; rank: number; name: string; id: string },
    b: { linked: number; deg: number; rank: number; name: string; id: string },
  ): number =>
    b.linked - a.linked ||
    b.deg - a.deg ||
    a.rank - b.rank ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  while (unplaced.size > 0) {
    let best: { linked: number; deg: number; rank: number; name: string; id: string } | null = null;
    for (const id of unplaced) {
      const m = byId.get(id)!;
      let linked = 0;
      for (const o of adj.get(id) ?? []) if (placedSet.has(o)) linked += 1;
      const cand = { linked, deg: degree.get(id) ?? 0, rank: m.rank, name: m.name, id };
      if (best == null || cmp(cand, best) < 0) best = cand;
    }
    unplaced.delete(best!.id);
    placedSet.add(best!.id);
    placed.push(best!.id);
  }
  return placed;
}

function mockPlaceMissing(
  doc: SpecDocument,
  diagramId: string,
): Record<string, Rect> {
  const d = doc.diagrams[diagramId];
  if (!d) return {};
  const scoped = d.scopeObjectId != null;
  const boxW = scoped ? PACKING.boxS : PACKING.boxWideW;
  const boxH = scoped ? PACKING.boxS : PACKING.boxWideH;
  const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const occupied: Rect[] = Object.values(d.boxes).filter(
    (r) => r.w > 0 && r.h > 0,
  );
  const missing = Object.entries(d.boxes)
    .filter(([, r]) => r.w <= 0 || r.h <= 0)
    .map(([id]) => {
      const o = doc.model.objects[id];
      return {
        id,
        rank: o ? (KIND_RANK[o.type] ?? 6) : 6,
        name: o ? o.name : "",
      };
    });
  if (missing.length === 0) return {};
  const ordered = orderByConnectivity(doc, diagramId, missing);
  const cols = gridCols(Math.max(1, Object.keys(d.boxes).length));
  const prow = new Map<string, number>();
  ordered.forEach((id, i) => prow.set(id, Math.floor(i / cols)));
  const labelledBetween = (ra: number, rb: number): boolean => {
    if (ra === rb) return false;
    const lo = Math.min(ra, rb);
    const hi = Math.max(ra, rb);
    if (hi !== lo + 1) return false;
    return Object.values(doc.model.connections).some((c) => {
      if (c.name.trim() === "") return false;
      const pa = prow.get(c.originId);
      const pb = prow.get(c.targetId);
      return (
        pa !== undefined &&
        pb !== undefined &&
        Math.min(pa, pb) === lo &&
        Math.max(pa, pb) === hi
      );
    });
  };
  const snap2 = (v: number): number => Math.round(v / 2) * 2;
  const rowY: number[] = [64];
  const colX = (c: number): number => snap2(64 + c * (boxW + PACKING.gap));
  const out: Record<string, Rect> = {};
  let cell = 0;
  for (const id of ordered) {
    for (;;) {
      const col = cell % cols;
      const row = Math.floor(cell / cols);
      cell += 1;
      while (rowY.length <= row) {
        const prev = rowY.length - 1;
        const gap = labelledBetween(prev, prev + 1) ? PACKING.gapLabelRow : PACKING.gap;
        rowY.push(rowY[prev] + boxH + gap);
      }
      const r: Rect = { x: colX(col), y: snap2(rowY[row]), w: boxW, h: boxH };
      if (occupied.some((o) => overlaps(o, r))) continue;
      occupied.push(r);
      out[id] = r;
      break;
    }
  }
  return out;
}

// --- the made-up sample (mirrors speculum-core sample.rs) -------------------

function sampleCommands(): Command[] {
  const cmds: Command[] = [];
  cmds.push({
    op: "createTag",
    tag: { id: "tag-core", name: "Core", color: "blue", index: 0 },
  });
  cmds.push({
    op: "createTag",
    tag: { id: "tag-pci", name: "PCI", color: "red", index: 1 },
  });
  const O = (
    id: string,
    name: string,
    type: "actor" | "system" | "group" | "app" | "store" | "component",
    parentId: string | null,
    external: boolean,
    caption: string,
  ) => ({
    id,
    name,
    type,
    parentId,
    status: "live" as const,
    external,
    caption,
    description: "",
    tagIds: [] as string[],
    technologies: [] as string[],
    links: [] as { name: string; url: string }[],
    groupIds: [] as string[],
    labels: {} as Record<string, string>,
  });
  const objs = [
    O("obj-customer", "Customer", "actor", null, true, "Shops with a browser"),
    O("obj-support", "Support Agent", "actor", null, true, "Helps shoppers"),
    O("obj-storefront", "Storefront", "system", null, false, "Customer-facing shop"),
    O("obj-payments", "Payments", "system", null, false, "Money movement"),
    O("obj-cloud", "Cloud Region", "group", null, false, "Shared hosting boundary"),
    O("obj-webapp", "Web App", "app", "obj-storefront", false, "Server-rendered shop"),
    O("obj-mobile", "Mobile App", "app", "obj-storefront", false, "Native shopping app"),
    O("obj-payments-api", "Payments API", "app", "obj-payments", false, "Charges cards"),
    O("obj-orders", "Orders Store", "store", "obj-storefront", false, "Orders source of truth"),
    O("obj-vault", "Card Vault", "store", "obj-payments", false, "Tokenized cards"),
    O("obj-cart", "Cart Service", "component", "obj-webapp", false, "Holds shopping carts"),
    O("obj-checkout", "Checkout Service", "component", "obj-webapp", false, "Runs checkout"),
    O("obj-tokenizer", "Card Tokenizer", "component", "obj-payments-api", false, "Tokenizes cards"),
    O("obj-cart-item", "Cart Item", "component", "obj-cart", false, "One line in the cart"),
    O("obj-queue", "Orders Queue", "store", "obj-storefront", false, "Buffers order events"),
  ];
  for (const object of objs) cmds.push({ op: "createObject", object });
  const C = (
    id: string,
    originId: string,
    targetId: string,
    name: string,
    direction: "outgoing" | "bidirectional" = "outgoing",
    extra: Partial<{
      status: "live" | "future" | "deprecated" | "removed";
      lineShape: "curved" | "straight" | "square";
      viaId: string | null;
    }> = {},
  ) =>
    ({
      op: "connect",
      connection: {
        id,
        originId,
        targetId,
        name,
        description: "",
        direction,
        status: extra.status ?? "live",
        lineShape: extra.lineShape ?? "curved",
        ...(extra.viaId != null ? { viaId: extra.viaId } : {}),
        tagIds: [],
        technologies: [],
        links: [],
      },
    }) as Command;
  cmds.push(
    C("conn-1", "obj-customer", "obj-webapp", "browses"),
    C("conn-2", "obj-mobile", "obj-orders", "reads"),
    C("conn-3", "obj-webapp", "obj-payments-api", "charges via", "outgoing", { lineShape: "straight" }),
    C("conn-4", "obj-payments-api", "obj-orders", "syncs", "bidirectional"),
    C("conn-5", "obj-support", "obj-orders", "looks up"),
    C("conn-6", "obj-cart", "obj-checkout", "hands off", "outgoing", { lineShape: "square" }),
    C("conn-7", "obj-checkout", "obj-tokenizer", "tokenizes via"),
    C("conn-8", "obj-tokenizer", "obj-vault", "stores in"),
    C("conn-9", "obj-cart", "obj-cart-item", "holds"),
    C("conn-10", "obj-storefront", "obj-webapp", "hosts"),
    C("conn-11", "obj-webapp", "obj-orders", "enqueues via", "outgoing", { viaId: "obj-queue" }),
    C("conn-12", "obj-mobile", "obj-cart", "will preview", "outgoing", { status: "future" }),
    C("conn-13", "obj-checkout", "obj-orders", "archives", "outgoing", { status: "deprecated" }),
    C("conn-14", "obj-cart", "obj-checkout", "streams to", "outgoing", { lineShape: "straight" }),
    C("conn-15", "obj-customer", "obj-orders", "reorders"),
  );
  const D = (
    id: string,
    name: string,
    level: "context" | "app" | "component",
    scopeObjectId: string | null,
    order: number,
    boxes: Record<string, Rect>,
  ) =>
    ({
      op: "createDiagram",
      diagram: {
          id,
          name,
          level,
          scopeObjectId,
          description: "",
          order,
          pinned: false,
          boxes,
          connections: {},
          landing: {},
          autoPlaced: false,
          showAllLabels: false,
          created: "",
          modified: "",
        },
    }) as Command;
  // Tight packing (mirrors speculum-core sample.rs EXACTLY): scoped
  // diagrams use 120x120 squares, the landscape the 220x110 variant.
  const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
  cmds.push(
    D("dg-landscape", "Shop Landscape", "context", null, 0, {
      "obj-storefront": R(64, 64, 220, 110),
      "obj-customer": R(344, 64, 220, 110),
      "obj-payments": R(624, 64, 220, 110),
      "obj-support": R(64, 294, 220, 110),
      "obj-cloud": R(344, 294, 220, 110),
    }),
    D("dg-storefront", "Storefront Apps", "app", "obj-storefront", 1, {
      "obj-cart": R(64, 96, 120, 120),
      "obj-checkout": R(244, 96, 120, 120),
      "obj-orders": R(424, 96, 120, 120),
      "obj-mobile": R(64, 336, 120, 120),
      "obj-webapp": R(244, 336, 120, 120),
    }),
    D("dg-payments-api", "Payments API Internals", "component", "obj-payments-api", 2, {
      "obj-tokenizer": R(64, 96, 120, 120),
      "obj-checkout": R(244, 96, 120, 120),
      "obj-vault": R(64, 336, 120, 120),
    }),
  );
  return cmds;
}

// ---------------------------------------------------------------------------
// Mock backend state
// ---------------------------------------------------------------------------

const STORAGE_KEY = "speculum.mock.doc";

interface MockState {
  doc: SpecDocument;
  rev: number;
  dirty: boolean;
  lastSavedMs: number;
  undo: SpecDocument[];
  redo: SpecDocument[];
  pending: RecoveryInfo | null;
}

function loadStored(): { doc: SpecDocument; rev: number } | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { doc: SpecDocument; rev: number };
    if (!parsed || typeof parsed !== "object" || !parsed.doc) return null;
    return { doc: parsed.doc, rev: parsed.rev ?? 0 };
  } catch {
    return null;
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ doc: mock.doc, rev: mock.rev }),
    );
  } catch {
    /* storage unavailable */
  }
}

const mock: MockState = {
  doc: emptyDocument("Mock Document"),
  rev: 0,
  dirty: false,
  lastSavedMs: Date.now(),
  undo: [],
  redo: [],
  pending: null,
};

let mockInit = false;

function mockInitOnce(): void {
  if (mockInit) return;
  mockInit = true;
  const param = readParam("mock");
  if (param === "fresh") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    mock.doc = emptyDocument("Mock Document");
    mock.rev = 0;
  } else {
    const stored = loadStored();
    if (stored) {
      mock.doc = stored.doc;
      mock.rev = stored.rev;
    }
    if (param === "sample" && Object.keys(mock.doc.model.objects).length === 0) {
      applyCommand(mock.doc, { op: "batch", commands: sampleCommands() });
      mock.rev += 1;
      persist();
    }
  }
  if (mockWantsRecovery() && mock.pending === null) {
    mock.pending = { pendingCommands: 5, fileOk: true };
  }
}

function mockMutate(cmd: Command): SessionCounts {
  mockInitOnce();
  // Camera moves are never undo steps (like Figma): apply but do not push
  // onto the undo stack and do not clear the redo stack.
  if (cmd.op !== "setViewport") {
    mock.undo.push(structuredClone(mock.doc));
    if (mock.undo.length > 500) mock.undo.shift();
    mock.redo = [];
  }
  applyCommand(mock.doc, cmd);
  mock.rev += 1;
  mock.dirty = true;
  persist();
  return countsOf(mock.doc, mock.rev);
}

function mockStartup(): StartupResult {
  mockInitOnce();
  if (mock.pending) {
    return {
      path: "mock/Default.speculum",
      status: "needs_recovery",
      recovery: { ...mock.pending },
      counts: countsOf(mock.doc, mock.rev),
    };
  }
  return {
    path: "mock/Default.speculum",
    status: "clean",
    counts: countsOf(mock.doc, mock.rev),
  };
}

function mockResolve(choice: "restore" | "discard"): SessionCounts {
  mockInitOnce();
  if (choice === "discard") {
    mock.doc = emptyDocument("Mock Document");
    mock.undo = [];
    mock.redo = [];
  }
  mock.pending = null;
  mock.dirty = choice === "restore";
  mock.rev += 1;
  persist();
  return countsOf(mock.doc, mock.rev);
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
    mockInitOnce();
    const prev = mock.undo.pop();
    if (prev) {
      mock.redo.push(structuredClone(mock.doc));
      mock.doc = prev;
      mock.rev += 1;
      mock.dirty = true;
      persist();
    }
    return countsOf(mock.doc, mock.rev);
  }
  return invoke<SessionCounts>("undo");
}

export async function bridgeRedo(): Promise<SessionCounts> {
  if (!isTauri()) {
    mockInitOnce();
    const next = mock.redo.pop();
    if (next) {
      mock.undo.push(structuredClone(mock.doc));
      mock.doc = next;
      mock.rev += 1;
      mock.dirty = true;
      persist();
    }
    return countsOf(mock.doc, mock.rev);
  }
  return invoke<SessionCounts>("redo");
}

export async function bridgeAddSampleBox(): Promise<SessionCounts> {
  if (!isTauri()) {
    mockInitOnce();
    const n = Object.keys(mock.doc.model.objects).length + 1;
    return mockMutate({
      op: "createObject",
      object: {
        id: `sample-${Date.now() % 1000000}`,
        name: `Sample App ${n}`,
        type: "app",
        parentId: null,
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
    });
  }
  return invoke<SessionCounts>("add_sample_box");
}

export async function bridgeGetState(): Promise<SessionStateDto> {
  if (!isTauri()) {
    mockInitOnce();
    return {
      name: mock.doc.meta.name || "Mock Document",
      counts: countsOf(mock.doc, mock.rev),
      dirty: mock.dirty,
      lastSavedMs: mock.lastSavedMs,
    };
  }
  return invoke<SessionStateDto>("state");
}

export async function bridgeGetDocument(): Promise<SpecDocument> {
  if (!isTauri()) {
    mockInitOnce();
    return structuredClone(mock.doc);
  }
  return invoke<SpecDocument>("get_document");
}

export async function bridgeListDiagrams(): Promise<DiagramInfo[]> {
  if (!isTauri()) {
    mockInitOnce();
    return Object.values(mock.doc.diagrams)
      .map((d) => ({
        id: d.id,
        name: d.name,
        level: d.level,
        scopeObjectId: d.scopeObjectId ?? null,
        order: d.order,
      }))
      .sort((a, b) =>
        a.order === b.order ? a.id.localeCompare(b.id) : a.order - b.order,
      );
  }
  return invoke<DiagramInfo[]>("list_diagrams");
}

export async function bridgeGetDiagramView(
  diagramId: string,
): Promise<DiagramView> {
  if (!isTauri()) {
    mockInitOnce();
    return mockDiagramView(mock.doc, diagramId);
  }
  return invoke<DiagramView>("get_diagram_view", { diagramId });
}

export async function bridgeSeedSample(): Promise<SessionCounts> {
  if (!isTauri()) {
    mockInitOnce();
    if (Object.keys(mock.doc.model.objects).length > 0)
      fail("document is not empty");
    return mockMutate({ op: "batch", commands: sampleCommands() });
  }
  return invoke<SessionCounts>("seed_sample");
}

export async function bridgeEnsureLayout(
  diagramId: string,
): Promise<EnsureLayoutResult> {
  if (!isTauri()) {
    mockInitOnce();
    const d = mock.doc.diagrams[diagramId];
    // M5 one-off repair: drop the scope box like the Rust ensure_layout.
    let scopeBoxed = false;
    if (d?.scopeObjectId && d.boxes[d.scopeObjectId]) scopeBoxed = true;
    const placedMap = mockPlaceMissing(mock.doc, diagramId);
    const placed = Object.keys(placedMap).length;
    if (placed > 0 || scopeBoxed) {
      const dd = mock.doc.diagrams[diagramId];
      const boxes = { ...dd.boxes };
      if (scopeBoxed && dd.scopeObjectId) delete boxes[dd.scopeObjectId];
      Object.assign(boxes, placedMap);
      const counts = mockMutate({
        op: "batch",
        commands: [
          {
            op: "applyLayout",
            diagramId,
            boxes,
          },
          { op: "patchDiagram", id: diagramId, autoPlaced: true },
        ],
      });
      return { placed, counts };
    }
    return { placed, counts: countsOf(mock.doc, mock.rev) };
  }
  return invoke<EnsureLayoutResult>("ensure_layout", { diagramId });
}

export async function bridgeDispatch(cmd: Command): Promise<SessionCounts> {
  if (!isTauri()) {
    return mockMutate(cmd);
  }
  return invoke<SessionCounts>("dispatch", { cmd });
}

export interface ZoomIntoResult {
  diagramId: string;
  created: boolean;
}

export async function bridgeZoomInto(
  diagramId: string,
  objectId: string,
): Promise<ZoomIntoResult> {
  if (!isTauri()) {
    mockInitOnce();
    if (!mock.doc.diagrams[diagramId]) fail(`unknown diagram: ${diagramId}`);
    if (!mock.doc.model.objects[objectId]) fail(`unknown object: ${objectId}`);
    mock.undo.push(structuredClone(mock.doc));
    if (mock.undo.length > 500) mock.undo.shift();
    mock.redo = [];
    const out = mockZoomInto(mock.doc, diagramId, objectId);
    mock.rev += 1;
    mock.dirty = true;
    persist();
    return out;
  }
  return invoke<ZoomIntoResult>("zoom_into", { diagramId, objectId });
}

export async function bridgeDiagramParent(
  diagramId: string,
): Promise<string | null> {
  if (!isTauri()) {
    mockInitOnce();
    return mockDiagramParent(mock.doc, diagramId);
  }
  return invoke<string | null>("diagram_parent", { diagramId });
}

export async function bridgeSetLanding(
  diagramId: string,
  objectId: string,
  targetDiagramId: string | null,
): Promise<SessionCounts> {
  if (!isTauri()) {
    return mockMutate({
      op: "setLanding",
      diagramId,
      objectId,
      target: targetDiagramId,
    });
  }
  return invoke<SessionCounts>("set_landing", {
    diagramId,
    objectId,
    targetDiagramId,
  });
}
