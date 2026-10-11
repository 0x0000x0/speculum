/**
 * TypeScript mirror of the Rust Document (serde camelCase JSON).
 * Keep in sync with crates/speculum-core/src/model.rs.
 */

export type ObjectKind =
  | "actor"
  | "system"
  | "group"
  | "app"
  | "store"
  | "component";
export type Status = "live" | "future" | "deprecated" | "removed";
export type Direction = "outgoing" | "bidirectional" | "none";
export type LineShape = "curved" | "straight" | "square";
export type DiagramLevel = "context" | "app" | "component";

export interface Link {
  name: string;
  url: string;
}

export interface SpecObject {
  id: string;
  name: string;
  type: ObjectKind;
  parentId?: string | null;
  status: Status;
  external: boolean;
  icon?: string | null;
  caption: string;
  description: string;
  tagIds: string[];
  technologies: string[];
  links: Link[];
  groupIds: string[];
  domainId?: string | null;
  labels: Record<string, string>;
}

export interface Connection {
  id: string;
  originId: string;
  targetId: string;
  name: string;
  description: string;
  direction: Direction;
  status: Status;
  lineShape: LineShape;
  labelPosition?: number | null;
  viaId?: string | null;
  tagIds: string[];
  technologies: string[];
  links: Link[];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  groupId?: string | null;
  index: number;
}

export interface TagGroup {
  id: string;
  name: string;
  icon: string;
  index: number;
}

export interface Domain {
  id: string;
  name: string;
  description: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A box rect in canvas-container CSS pixels (for drill animations). */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface EdgeLayout {
  labelPosition?: number | null;
  waypoints: { x: number; y: number }[];
}

export interface SpecDiagram {
  id: string;
  name: string;
  level: DiagramLevel;
  scopeObjectId?: string | null;
  domainId?: string | null;
  description: string;
  order: number;
  pinned: boolean;
  boxes: Record<string, Rect>;
  connections: Record<string, EdgeLayout>;
  viewport?: Viewport | null;
  landing: Record<string, string>;
  autoPlaced: boolean;
  created: string;
  modified: string;
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  diagramId?: string | null;
  pinned: boolean;
  showAllConnectionNames: boolean;
  showAllSteps: boolean;
  // Steps are opaque to the M4 canvas; kept as unknown JSON.
  steps: unknown[];
}

export interface SpecDocument {
  schema: number;
  meta: { name: string; created: string; modified: string };
  model: {
    objects: Record<string, SpecObject>;
    connections: Record<string, Connection>;
    tags: Record<string, Tag>;
    tagGroups: Record<string, TagGroup>;
    domains: Record<string, Domain>;
    flows: Record<string, Flow>;
  };
  diagrams: Record<string, SpecDiagram>;
}

// --- rollup views -----------------------------------------------------------

/** Wire contract: objects in both cases; the bare "frame" string is legacy. */
export type Endpoint = { box: string } | { frame: true } | "frame";

export interface ViewEdge {
  from: Endpoint;
  to: Endpoint;
  connectionIds: string[];
  lower: boolean;
  explicit: boolean;
  bidirectional: boolean;
}

export interface DiagramInfo {
  id: string;
  name: string;
  level: DiagramLevel;
  scopeObjectId?: string | null;
  order: number;
}

export interface BreadcrumbItem {
  id: string;
  name: string;
}

export interface ScopeInfo {
  id: string;
  name: string;
  kind: ObjectKind;
}

export interface DiagramView {
  diagram: SpecDiagram;
  objects: SpecObject[];
  childCounts: Record<string, number>;
  edges: ViewEdge[];
  breadcrumb: BreadcrumbItem[];
  scope?: ScopeInfo | null;
}

export interface ZoomIntoResult {
  diagramId: string;
  created: boolean;
}

// --- commands (serde tag = "op", camelCase) ---------------------------------

export type Command =
  | { op: "createObject"; object: SpecObject }
  | { op: "deleteObject"; id: string }
  | { op: "patchObject"; id: string; patch: Partial<SpecObject> }
  | { op: "reparent"; id: string; newParent?: string | null }
  | { op: "connect"; connection: Connection }
  | { op: "deleteConnection"; id: string }
  | { op: "patchConnection"; id: string; patch: Partial<Connection> }
  | { op: "createTag"; tag: Tag }
  | { op: "deleteTag"; id: string }
  | { op: "createDiagram"; diagram: SpecDiagram }
  | { op: "deleteDiagram"; id: string }
  | {
      op: "patchDiagram";
      id: string;
      name?: string;
      description?: string;
      order?: number;
      pinned?: boolean;
      autoPlaced?: boolean;
    }
  | { op: "addToDiagram"; diagramId: string; objectId: string; rect: Rect }
  | { op: "removeFromDiagram"; diagramId: string; objectId: string }
  | { op: "moveBoxes"; diagramId: string; moves: Record<string, Rect> }
  | { op: "applyLayout"; diagramId: string; boxes: Record<string, Rect> }
  | { op: "setViewport"; diagramId: string; viewport?: Viewport | null }
  | { op: "setLanding"; diagramId: string; objectId: string; target?: string | null }
  | { op: "batch"; commands: Command[] };

export function emptyDocument(name: string): SpecDocument {
  return {
    schema: 1,
    meta: { name, created: "", modified: "" },
    model: {
      objects: {},
      connections: {},
      tags: {},
      tagGroups: {},
      domains: {},
      flows: {},
    },
    diagrams: {},
  };
}
