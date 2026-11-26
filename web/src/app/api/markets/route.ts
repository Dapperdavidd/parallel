import {
  dayChangeReference,
  latestTicks,
  listMarkets,
  registryMeta,
} from "@/lib/server/data";
import { engineMarks } from "@/lib/server/marks";
import { CEILINGS, route } from "@/lib/server/request";
import { ok } from "@/lib/server/respond";

/**
 * F7 — the market board, from the live index.
 *
 * Returns only what actually comes from the pipeline: the street median, the
 * official rate, the premium, the sources in the median, whether the market is
 * accepting positions, and when it was last written on-chain. Presentation
 * metadata (symbol, long name, region, decimal places) stays in the client,
 * so a market that is briefly unpriced renders as "paused" rather than blank.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface LiveMarket {
  code: string;
  id: string;
  /** Street median, local currency per USD. Null when the market is paused. */
  median: number | null;
  official: number | null;
  premiumPct: number | null;
  /** USD price of one contract — what Percolator is told. */
  unitPriceUsd: number | null;
  /**
   * The engine's own effective price for one contract, read from the chain.
   * Null when the market account is unreadable. Close to `unitPriceUsd` but
   * not equal to it — the difference is the basis.
   */
  markUnitPriceUsd: number | null;
  /** The engine's price in the familiar quote scale, local currency per USD. */
  mark: number | null;
  /** Mark against index, in basis points. Null when either is missing. */
  basisBps: number | null;
  /** Open interest the engine is actually carrying, in tUSDC. */
  openInterestLongUsdc: number | null;
  openInterestShortUsdc: number | null;
  unitLabel: string;
  maxLeverage: number;
  status: string;
  /** PRD F2: a paused market accepts no new positions. */
  acceptingPositions: boolean;
  reason: string | null;
  sources: string[];
  /** How many sources were in the median, and how many we tried. */
  sourceCount: number;
  sourcesTried: number;
  ts: string | null;
  /** Seconds since the index last produced a figure for this market. */
  ageSeconds: number | null;
  /** Plain words for why a market is not accepting positions. */
  pausedBecause: string | null;
  /** Percent change over the last 24h of index history. */
  change24hPct: number | null;
  lastPushTx: string | null;
  marketAccount: string;
  collateralVault: string;
  maxNotionalUsdc: number | null;
  maxOpenInterestUsdc: number | null;
}

/**
 * Change over the last 24 hours of index history.
 *
 * Null rather than zero when the history is shorter than a day: a market that
 * launched an hour ago has no 24h change, and showing "0.00%" would be a
 * number we made up.
 */
function change24h(
  day: { reference: number | null; hasFullDay: boolean },
  latest: number | null,
): number | null {
  if (latest === null || !day.hasFullDay) return null;
  if (day.reference === null || day.reference === 0) return null;
  return ((latest - day.reference) / day.reference) * 100;
}

/**
 * Why this market is not accepting positions, in words a trader can act on.
 *
 * The status codes are the index service's own vocabulary. A screen showing
 * "paused_few_sources" is telling somebody their money is unavailable and
 * refusing to say why.
 */
function pausedBecause(status: string, reason: string | null): string | null {
  if (status === "ok") return null;
  if (status === "paused_few_sources") {
    return (
      "Not enough independent price sources are reachable right now, so we will not " +
      "quote a price. Trading reopens by itself when they come back."
    );
  }
  if (status === "paused_official_band") {
    return (
      "The street price has moved far enough from the published official rate that we " +
      "treat it as unreliable until it settles."
    );
  }
  if (status === "unknown") {
    return "This market has not produced a price yet.";
  }
  return reason ?? "This market is paused.";
}

export const GET = route(
  "markets",
  { ceiling: CEILINGS.read, sameOrigin: false },
  async (): Promise<Response> => {
    const [markets, ticks, meta, marks] = await Promise.all([
      listMarkets(),
      latestTicks(),
      registryMeta(),
      // One batched account read for all thirteen, memoised — the engine's
      // price is a different quantity from the index and the terminal
      // labels it as one.
      engineMarks(),
    ]);

    // Two small indexed lookups per market, rather than a day of ticks each.
    const days = await Promise.all(
      markets.map((m) =>
        dayChangeReference(m.id).catch(() => ({ reference: null, hasFullDay: false })),
      ),
    );

    const now = Date.now();
    const rows: LiveMarket[] = markets.map((m, i) => {
      const t = ticks.get(m.id);
      const status = t?.status ?? "unknown";
      const mark = marks.get(m.id) ?? null;
      const basisBps =
        mark && t?.unitPriceUsd
          ? Math.round((mark.unitPriceUsd / t.unitPriceUsd - 1) * 10_000)
          : null;
      return {
        code: m.currency,
        id: m.id,
        median: t?.median ?? null,
        official: t?.official ?? null,
        premiumPct: t?.premiumPct ?? null,
        unitPriceUsd: t?.unitPriceUsd ?? null,
        markUnitPriceUsd: mark?.unitPriceUsd ?? null,
        // The engine holds USD per contract; every screen shows the familiar
        // quote. They are reciprocals scaled by the contract size.
        mark: mark && mark.unitPriceUsd > 0 ? m.unit / mark.unitPriceUsd : null,
        basisBps,
        openInterestLongUsdc: mark?.openInterestLongUsdc ?? null,
        openInterestShortUsdc: mark?.openInterestShortUsdc ?? null,
        unitLabel: m.unitLabel,
        maxLeverage: m.maxLeverage,
        status,
        acceptingPositions: status === "ok",
        reason: t?.reason ?? null,
        sources: t?.sourcesUsed ?? [],
        sourceCount: t?.sourcesUsed?.length ?? 0,
        sourcesTried: t?.breakdown?.length ?? t?.sourcesUsed?.length ?? 0,
        ts: t?.ts ?? null,
        ageSeconds: t?.ts ? Math.max(0, Math.round((now - new Date(t.ts).getTime()) / 1000)) : null,
        pausedBecause: pausedBecause(status, t?.reason ?? null),
        change24hPct: change24h(days[i] ?? { reference: null, hasFullDay: false }, t?.median ?? null),
        lastPushTx: t?.pushedTx ?? null,
        marketAccount: m.market,
        collateralVault: m.vault,
        maxNotionalUsdc: m.liquidityVault?.maxNotionalUsdc ?? null,
        maxOpenInterestUsdc: m.liquidityVault?.maxOpenInterestUsdc ?? null,
      };
    });

    return ok(
      { markets: rows, collateralMint: meta?.collateralMint ?? null, at: new Date().toISOString() },
      // The index moves every two minutes, so a few seconds of shared cache
      // costs nothing and takes the repeat polling off the database.
      { "Cache-Control": "public, max-age=5, stale-while-revalidate=55" },
    );
  },
);
