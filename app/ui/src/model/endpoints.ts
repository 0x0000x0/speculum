import type { Endpoint } from "./types";

/**
 * Read an edge endpoint as a box id, or null when it touches the scope frame.
 * Accepts the wire contract `{ box: id }` / `{ frame: true }` plus the
 * legacy bare `"frame"` string (old Rust serialization). Never throws.
 */
export function endpointBox(e: Endpoint | unknown): string | null {
  if (typeof e === "string") return null;
  if (e == null || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  if (typeof o["box"] === "string") return o["box"] as string;
  return null;
}

/** True when the endpoint touches the scope frame (object or legacy form). */
export function isFrameEndpoint(e: Endpoint | unknown): boolean {
  return endpointBox(e) == null;
}
