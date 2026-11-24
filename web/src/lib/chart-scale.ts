import type { ITimeScaleApi, Logical, Time } from "lightweight-charts";

/**
 * The time scale as a straight line, read out of the public API.
 *
 * Two things about Lightweight Charts 4 make this necessary.
 *
 *  1. `logicalToCoordinate` returns **0** for any index that is not a whole
 *     number — it bails out on `!isInteger(index)`. A drawing anchored between
 *     two bars, or a position box whose right edge lands mid-bar, would be
 *     painted hard against the left edge of the pane.
 *  2. The live bar spacing is not readable. `timeScale().options().barSpacing`
 *     is the *configured* value, and every internal change — `fitContent`, a
 *     pinch, an axis drag — moves the real one without touching it. Zooming by
 *     reading that option meant computing from 9 when the chart was actually
 *     at 1.3.
 *
 * Both are answered by the same observation: index to coordinate is exactly
 * linear (`width - (baseIndex + rightOffset - index + 0.5) * barSpacing - 1`),
 * so two integer indices — which the API does answer — give the whole mapping,
 * spacing included.
 */
export interface ChartScale {
  /** Pixel x of logical index 0. */
  x0: number;
  /** Pixels per bar: the live bar spacing. */
  spacing: number;
}

/** Far enough apart that the division is exact to many decimal places. */
const PROBE = 100;

export function readScale(ts: ITimeScaleApi<Time>): ChartScale | null {
  const a = ts.logicalToCoordinate(0 as Logical);
  const b = ts.logicalToCoordinate(PROBE as Logical);
  if (a === null || b === null) return null;
  const spacing = ((b as number) - (a as number)) / PROBE;
  if (!Number.isFinite(spacing) || spacing <= 0) return null;
  return { x0: a as number, spacing };
}

/** Pixel x of a fractional bar index. */
export const coordinateOf = (scale: ChartScale, logical: number): number =>
  scale.x0 + logical * scale.spacing;

/** Fractional bar index at a pixel x — no snapping to the nearest bar. */
export const logicalAt = (scale: ChartScale, x: number): number =>
  (x - scale.x0) / scale.spacing;
