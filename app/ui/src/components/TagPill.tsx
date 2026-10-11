import "./TagPill.css";

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

const KNOWN: TagColor[] = [
  "slate",
  "blue",
  "violet",
  "purple",
  "pink",
  "red",
  "orange",
  "amber",
  "lime",
  "green",
  "teal",
  "cyan",
];

/** Map a free-form tag color name to a known pill palette (fallback slate). */
export function toTagColor(raw: string): TagColor {
  return (KNOWN as string[]).includes(raw) ? (raw as TagColor) : "slate";
}

export default function TagPill({
  label,
  color,
}: {
  label: string;
  color: TagColor;
}) {
  return (
    <span className="sp-tag-pill" data-tag={color}>
      {label}
    </span>
  );
}
