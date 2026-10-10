import type { TagColor } from "../data/sample";
import "./TagPill.css";

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
