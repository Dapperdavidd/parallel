/**
 * The Parallel street index.
 *
 * Implements the PRD oracle rules verbatim:
 *   3. Drop any source more than 3% from the median of all sources, then recompute.
 *   4. A market needs at least 2 live sources. With fewer it pauses: no new
 *      positions, existing positions can still close.
 *   5. If the median strays more than 15% from the official rate, pause and alert.
 *   6. Push on-chain when the median moves more than 0.1% or 10 minutes pass.
 *   7. Store every calculation with its per-source breakdown.
 */

import { unitPriceUsd, type MarketDef } from "./markets.js";
import type { SourceReading } from "./sources.js";

export const OUTLIER_PCT = 3;
export const MIN_SOURCES = 2;
export const OFFICIAL_BAND_PCT = 15;
export const PUSH_MOVE_PCT = 0.1;
export const PUSH_MAX_AGE_MS = 10 * 60 * 1000;

export type IndexStatus =
  | "ok"
  | "paused_few_sources"
  | "paused_official_band";

export interface DroppedSource {
  id: string;
  rate: number;
  deviationPct: number;
}

export interface IndexTick {
  market: string;
  ts: string;
  /** Median street rate: local currency per 1 USD. Null when paused with no usable median. */
  median: number | null;
  /** USD price of one tradable unit — this is what gets pushed to Percolator. */
  unitPriceUsd: number | null;
  /** Official rate (local per USD) for the sanity check. */
  official: number | null;
  /** Street premium over official, in percent. */
  premiumPct: number | null;
  sourcesUsed: string[];
  dropped: DroppedSource[];
  failed: { id: string; error: string }[];
  breakdown: SourceReading[];
  status: IndexStatus;
  reason?: string;
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error("median of empty set");
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid]!;
  return (s[mid - 1]! + s[mid]!) / 2;
}

export function pctDiff(value: number, reference: number): number {
  return ((value - reference) / reference) * 100;
}

/**
 * Turns a set of source readings into one index tick.
 * `official` is local currency per 1 USD, or null when unavailable.
 */
export function computeIndex(
  market: MarketDef,
  readings: SourceReading[],
  official: number | null,
  now: Date = new Date(),
): IndexTick {
  const ts = now.toISOString();
  const live = readings.filter(
    (r): r is SourceReading & { rate: number } => r.ok && typeof r.rate === "number",
  );
  const failed = readings
    .filter((r) => !r.ok)
    .map((r) => ({ id: r.id, error: r.error ?? "unknown" }));

  const base: Omit<IndexTick, "status" | "reason"> = {
    market: market.id,
    ts,
    median: null,
    unitPriceUsd: null,
    official,
    premiumPct: null,
    sourcesUsed: [],
    dropped: [],
    failed,
    breakdown: readings,
  };

  // Rule 4, first pass: not enough live sources to form an index at all.
  if (live.length < MIN_SOURCES) {
    return {
      ...base,
      status: "paused_few_sources",
      reason: `${live.length} live source(s), need ${MIN_SOURCES}`,
    };
  }

  // Rule 3: provisional median, drop outliers, recompute.
  const provisional = median(live.map((r) => r.rate));
  const dropped: DroppedSource[] = [];
  const kept: (SourceReading & { rate: number })[] = [];
  for (const r of live) {
    const dev = pctDiff(r.rate, provisional);
    if (Math.abs(dev) > OUTLIER_PCT) dropped.push({ id: r.id, rate: r.rate, deviationPct: dev });
    else kept.push(r);
  }

  // Rule 4, second pass: outlier removal can itself starve the market.
  if (kept.length < MIN_SOURCES) {
    return {
      ...base,
      dropped,
      status: "paused_few_sources",
      reason: `${kept.length} source(s) left after the ${OUTLIER_PCT}% outlier rule, need ${MIN_SOURCES}`,
    };
  }

  const finalMedian = median(kept.map((r) => r.rate));
  const unit = unitPriceUsd(market, finalMedian);
  const premiumPct = official !== null ? pctDiff(finalMedian, official) : null;

  const withNumbers: Omit<IndexTick, "status" | "reason"> = {
    ...base,
    median: finalMedian,
    unitPriceUsd: unit,
    premiumPct,
    sourcesUsed: kept.map((r) => r.id),
    dropped,
  };

  // Rule 5: official-rate sanity band.
  if (premiumPct !== null && Math.abs(premiumPct) > OFFICIAL_BAND_PCT) {
    return {
      ...withNumbers,
      status: "paused_official_band",
      reason: `median is ${premiumPct.toFixed(1)}% from official, band is ±${OFFICIAL_BAND_PCT}%`,
    };
  }

  return { ...withNumbers, status: "ok" };
}

/** Rule 6: should this tick be pushed on-chain? */
export function shouldPush(
  tick: IndexTick,
  last: { unitPriceUsd: number; at: number } | null,
  now: number = Date.now(),
): { push: boolean; reason: string } {
  if (tick.status !== "ok" || tick.unitPriceUsd === null) {
    return { push: false, reason: `market ${tick.status}` };
  }
  if (last === null) return { push: true, reason: "first push" };

  const movePct = Math.abs(pctDiff(tick.unitPriceUsd, last.unitPriceUsd));
  if (movePct > PUSH_MOVE_PCT) {
    return { push: true, reason: `moved ${movePct.toFixed(3)}% (> ${PUSH_MOVE_PCT}%)` };
  }
  const ageMs = now - last.at;
  if (ageMs >= PUSH_MAX_AGE_MS) {
    return { push: true, reason: `${Math.round(ageMs / 60000)} min since last push` };
  }
  return {
    push: false,
    reason: `moved ${movePct.toFixed(3)}%, ${Math.round(ageMs / 1000)}s since last push`,
  };
}
