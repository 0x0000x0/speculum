/** Sample model for the M3 visual demo. Real canvas data arrives in M4. */

export type TagColor =
  | "slate"
  | "blue"
  | "violet"
  | "purple"
  | "pink"
  | "red"
  | "orange"
  | "amber"
  | "lime"
  | "green"
  | "teal"
  | "cyan";

export interface SampleTag {
  label: string;
  color: TagColor;
}

export type SampleKind = "system" | "app" | "store" | "actor";

export interface SampleNode {
  id: string;
  kind: SampleKind;
  title: string;
  caption: string;
  tags: SampleTag[];
  /** External actors render with a dashed border. */
  external?: boolean;
  /** Child count badge shown on container nodes. */
  children?: number;
  description: string;
  /** Canvas position (M3 demo layout). */
  x: number;
  y: number;
}

export interface SampleEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export const SAMPLE_NODES: SampleNode[] = [
  {
    id: "storefront",
    kind: "system",
    title: "Storefront",
    caption: "C4 system · 3 contained apps",
    tags: [{ label: "Shop", color: "violet" }],
    children: 3,
    description:
      "The customer-facing storefront system. Contains the web experience, checkout, and the surrounding services that fulfil an order.",
    x: 40,
    y: 120,
  },
  {
    id: "webapp",
    kind: "app",
    title: "Web App",
    caption: "React storefront · SSR",
    tags: [{ label: "Core", color: "blue" }],
    description:
      "Server-rendered storefront. Browses the catalog, renders product pages, and hands off to checkout when the shopper is ready to pay.",
    x: 360,
    y: 20,
  },
  {
    id: "payments",
    kind: "app",
    title: "Payments API",
    caption: "Charges cards · idempotent",
    tags: [
      { label: "Core", color: "blue" },
      { label: "PCI", color: "red" },
    ],
    description:
      "Authorizes and captures card payments. Every charge is idempotent and writes an audit record to the orders store.",
    x: 360,
    y: 220,
  },
  {
    id: "orders",
    kind: "store",
    title: "Orders Store",
    caption: "Postgres · source of truth",
    tags: [{ label: "SQL", color: "teal" }],
    description:
      "Durable record of carts, orders, and payment attempts. The single source of truth the support tooling reads from.",
    x: 660,
    y: 120,
  },
  {
    id: "customer",
    kind: "actor",
    title: "Customer",
    caption: "External · browser",
    tags: [{ label: "Person", color: "amber" }],
    external: true,
    description:
      "A shopper using a browser. External to the system boundary — drawn dashed — but the reason any of this exists.",
    x: 40,
    y: 330,
  },
];

export const SAMPLE_EDGES: SampleEdge[] = [
  { id: "e1", source: "customer", target: "webapp", label: "browses" },
  { id: "e2", source: "webapp", target: "payments", label: "charges via" },
  { id: "e3", source: "payments", target: "orders", label: "records in" },
  { id: "e4", source: "webapp", target: "orders", label: "reads" },
];

export const KIND_LABELS: Record<SampleKind, string> = {
  system: "System",
  app: "App",
  store: "Store",
  actor: "Actor",
};
