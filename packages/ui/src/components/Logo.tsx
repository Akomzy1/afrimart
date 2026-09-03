/**
 * The seedling mark and wordmark, per /docs/AfriMart_Brand_Guide.pdf.
 * Path geometry (two leaves opening from a single upright stem) is
 * identical across every prototype page — recreated here as a vector
 * component since no raw exported logo files exist in /docs/brand/ yet.
 * The stem is always Harvest Amber; leaf color and background vary by
 * where the mark sits (see LogoTone below). Do not recolor the stem to
 * terracotta, even though every prototype page does — see CLAUDE.md.
 */

export type LogoTone = "on-dark" | "on-light" | "tile";

const LEAVES_PATH = "M11 21c-5-1-8-5-8-11 6 0 10 4 10 11M13 21c5-1 8-5 8-11-6 0-10 4-10 11";
const STEM_PATH = "M12 22V10";

export interface LogoMarkProps {
  tone?: LogoTone;
  size?: number;
  className?: string;
}

/** Icon-only mark. `tile` (green rounded-square, the avatar/app-icon default) is most common outside a header that already provides its own colored ground. */
export function LogoMark({ tone = "tile", size = 32, className }: LogoMarkProps) {
  const leafColor = tone === "on-light" ? "#1F3D2B" : "#FAF5EE";
  const svg = (
    <svg
      width={tone === "tile" ? size * 0.62 : size}
      height={tone === "tile" ? size * 0.62 : size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={leafColor}
      strokeWidth={1.7}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d={LEAVES_PATH} />
      <path d={STEM_PATH} stroke="#E8A44D" strokeWidth={2} />
    </svg>
  );

  if (tone !== "tile") return svg;

  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: "#1F3D2B",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      {svg}
    </span>
  );
}

export interface LogoProps {
  /** `on-dark` for a green/colored ground (e.g. a header banner); `on-light` for ivory/white. */
  tone?: "on-dark" | "on-light";
  size?: number;
  tagline?: boolean;
  className?: string;
}

/** Full lockup — mark plus two-tone wordmark ("Afri" heritage tone, "Mart" amber). */
export function Logo({ tone = "on-light", size = 28, tagline, className }: LogoProps) {
  const afriColor = tone === "on-dark" ? "#FAF5EE" : "#1F3D2B";
  const martColor = tone === "on-dark" ? "#E8A44D" : "#9C6B2E";
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: size * 0.32 }}>
      <LogoMark tone={tone === "on-dark" ? "on-dark" : "on-light"} size={size} />
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        <span
          className="serif"
          style={{ fontWeight: 600, fontSize: size, letterSpacing: "-0.02em", color: afriColor }}
        >
          Afri<span style={{ color: martColor }}>Mart</span>
        </span>
        {tagline && (
          <span
            style={{
              fontSize: size * 0.32,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: tone === "on-dark" ? "#B9C7BB" : "#7f7361",
              marginTop: size * 0.18,
            }}
          >
            the market from home
          </span>
        )}
      </span>
    </span>
  );
}
