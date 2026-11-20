import Link from "next/link";

/**
 * The Parallel mark: two slanted bars, amber and blue. Same geometry as the
 * glass logo but flat, for nav and footer use. Do not change the shape — the
 * design hand-off is explicit about that.
 */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <polygon points="7,44 14,44 26,4 19,4" fill="#F2A93B" />
      <polygon points="28,24 35,24 41,4 34,4" fill="#3D5CF5" />
    </svg>
  );
}

export function Brand({
  size = 20,
  markSize = 28,
  href = "/",
  hideLabelOnSmall = false,
  style,
}: {
  size?: number;
  markSize?: number;
  href?: string;
  hideLabelOnSmall?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <Link href={href} className="brand" style={{ fontSize: size, ...style }}>
      <Mark size={markSize} />
      <span className={hideLabelOnSmall ? "hide-sm" : undefined}>Parallel</span>
    </Link>
  );
}
