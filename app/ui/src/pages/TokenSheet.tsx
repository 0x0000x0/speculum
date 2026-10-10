import { useTheme } from "../theme/ThemeProvider";
import TagPill from "../components/TagPill";
import type { TagColor } from "../data/sample";
import tokenData from "../../../../tokens/tokens.json";
import "./TokenSheet.css";

const TAG_ORDER: TagColor[] = [
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

const TYPE_ORDER = [
  "caption",
  "body-sm",
  "body",
  "title-sm",
  "title",
  "view-title",
  "drill-header",
] as const;

export default function TokenSheet() {
  const { resolved } = useTheme();
  const palette = tokenData.color[resolved] as Record<string, string>;
  const roles = Object.entries(palette);

  return (
    <div className="token-sheet" aria-label="Design tokens">
      <div className="token-sheet__head">
        <h1 className="token-sheet__title">Design tokens</h1>
        <p className="token-sheet__sub">
          Source of truth: <code>tokens/tokens.json</code> · showing the{" "}
          <strong>{resolved}</strong> theme live — flip the theme switch to
          compare.
        </p>
      </div>

      <section className="token-sheet__section" aria-label="Color roles">
        <h2 className="token-sheet__section-title">Color</h2>
        <div className="token-sheet__swatches">
          {roles.map(([role, value]) => (
            <div className="token-sheet__swatch" key={role}>
              <span
                className="token-sheet__chip"
                style={{ background: value }}
                aria-hidden="true"
              />
              <span className="token-sheet__role">{role}</span>
              <span className="token-sheet__hex">{value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="token-sheet__section" aria-label="Spacing scale">
        <h2 className="token-sheet__section-title">Spacing</h2>
        <div className="token-sheet__spacing">
          {Object.entries(tokenData.spacing).map(([name, px]) => (
            <div className="token-sheet__space-row" key={name}>
              <span className="token-sheet__space-name">{name}</span>
              <span
                className="token-sheet__space-bar"
                style={{ width: `${px * 3}px` }}
                aria-hidden="true"
              />
              <span className="token-sheet__space-px">{px}px</span>
            </div>
          ))}
        </div>
      </section>

      <section className="token-sheet__section" aria-label="Type scale">
        <h2 className="token-sheet__section-title">Type</h2>
        <div className="token-sheet__type">
          {TYPE_ORDER.map((name) => {
            const t = tokenData.type[name] as {
              size: number;
              weight: number;
              lineHeight: number;
            };
            return (
              <div className="token-sheet__type-row" key={name}>
                <span
                  className="token-sheet__type-sample"
                  style={{
                    fontSize: `${t.size}px`,
                    fontWeight: t.weight,
                    lineHeight: t.lineHeight,
                  }}
                >
                  {name} — Speculum maps nested architecture
                </span>
                <span className="token-sheet__type-meta">
                  {t.size}px / {t.weight} / {t.lineHeight}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="token-sheet__section" aria-label="Radii and shadows">
        <h2 className="token-sheet__section-title">Radius &amp; shadow</h2>
        <div className="token-sheet__row">
          {Object.entries(tokenData.radius).map(([name, px]) => (
            <div className="token-sheet__radius" key={name}>
              <span
                className="token-sheet__radius-box"
                style={{ borderRadius: `${px}px` }}
                aria-hidden="true"
              />
              <span className="token-sheet__meta">
                {name} · {px}px
              </span>
            </div>
          ))}
        </div>
        <div className="token-sheet__row">
          {(["l1", "l2", "l3"] as const).map((level) => (
            <div className="token-sheet__shadow" key={level}>
              <span
                className="token-sheet__shadow-box"
                data-shadow={level}
                aria-hidden="true"
              />
              <span className="token-sheet__meta">{level}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="token-sheet__section" aria-label="Tag palette">
        <h2 className="token-sheet__section-title">Tags</h2>
        <div className="token-sheet__tags">
          {TAG_ORDER.map((name) => (
            <span className="token-sheet__tag" key={name}>
              <TagPill label={name} color={name} />
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
