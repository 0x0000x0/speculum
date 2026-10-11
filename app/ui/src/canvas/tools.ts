import type { ObjectKind } from "../model/types";

export type ToolId =
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

export interface ToolDef {
  id: ToolId;
  /** Short name shown in the tooltip (before the shortcut). */
  label: string;
  /** Exact shortcut text shown in tooltips; must equal the real binding. */
  shortcut: string;
  group: "select" | "pan" | "add" | "connect" | "note" | "flow";
  kind?: ObjectKind;
}

export const TOOLS: ToolDef[] = [
  { id: "select", label: "Select / move", shortcut: "V", group: "select" },
  { id: "pan", label: "Pan", shortcut: "H", group: "pan" },
  { id: "add-system", label: "System", shortcut: "Shift+S", group: "add", kind: "system" },
  { id: "add-app", label: "App", shortcut: "Shift+A", group: "add", kind: "app" },
  { id: "add-component", label: "Component", shortcut: "Shift+X", group: "add", kind: "component" },
  { id: "add-store", label: "Store", shortcut: "Shift+D", group: "add", kind: "store" },
  { id: "add-actor", label: "Actor", shortcut: "Shift+P", group: "add", kind: "actor" },
  { id: "add-group", label: "Group", shortcut: "Shift+G", group: "add", kind: "group" },
  { id: "connect", label: "Draw connection", shortcut: "C", group: "connect" },
  { id: "note", label: "Sticky note", shortcut: "N", group: "note" },
  { id: "flow", label: "Flow", shortcut: "F", group: "flow" },
];

export const TOOL_BY_ID: Record<ToolId, ToolDef> = Object.fromEntries(
  TOOLS.map((t) => [t.id, t]),
) as Record<ToolId, ToolDef>;

/** Tooltip text for a tool button: "Name (Shortcut)". */
export function toolTitle(id: ToolId): string {
  const t = TOOL_BY_ID[id];
  return `${t.label} (${t.shortcut})`;
}

/** aria-label for a tool button (same as the tooltip). */
export function toolAriaLabel(id: ToolId): string {
  return toolTitle(id);
}

export function kindOfAddTool(id: ToolId): ObjectKind | null {
  return TOOL_BY_ID[id]?.kind ?? null;
}

export function isAddTool(id: ToolId): boolean {
  return TOOL_BY_ID[id]?.group === "add";
}

export interface ZoomDef {
  id: "zoom-out" | "zoom-pct" | "zoom-in" | "fit-screen";
  label: string;
  shortcut: string;
}

export const ZOOM_TOOLS: ZoomDef[] = [
  { id: "zoom-out", label: "Zoom out", shortcut: "Ctrl+-" },
  { id: "zoom-pct", label: "Reset zoom to 100%", shortcut: "Ctrl+1" },
  { id: "zoom-in", label: "Zoom in", shortcut: "Ctrl+=" },
  { id: "fit-screen", label: "Fit to screen", shortcut: "Shift+1" },
];

export function zoomTitle(id: ZoomDef["id"]): string {
  const z = ZOOM_TOOLS.find((x) => x.id === id)!;
  return `${z.label} (${z.shortcut})`;
}
