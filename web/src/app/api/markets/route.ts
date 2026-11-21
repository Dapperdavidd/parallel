import { NextResponse } from "next/server";
import { latestTicks, listMarkets, recentTicks, registryMeta } from "@/lib/server/data";

/**
 * F7 — the market board, from the live index.
 *
 * Returns only what actually comes from the pipeline: the street median, the
 * official rate, the premium, the sources in the median, whether the market is
 * accepting positions, and when it was last written on-chain. Presentation
 * metadata (symbol, long name, region, decimal places) stays in the client,
 * so a market that is briefly unpriced renders as "paused" rather than blank.
 */

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
  unitLabel: string;
  maxLeverage: number;
  status: string;
  /** PRD F2: a paused market accepts no new positions. */
  acceptingPositions: boolean;
  reason: string | null;
  sources: string[];
  ts: string | null;
  /** Percent change over the last 24h of index history. */
  change24hPct: number | null;
  lastPushTx: string | null;
  marketAccount: string;
  collateralVault: string;
}

/**
 * Change over the last 24 hours of index history.
 *
 * Null rather than zero when the history is shorter than a day: a market that
 * launched an hour ago has no 24h change, and showing "0.00%" would be a
 * number we made up.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function change24h(
  history: { ts: string; median: number | null }[],
  latest: number | null,
): number | null {
  if (latest === null || history.length === 0) return null;
  const cutoff = Date.now() - DAY_MS;
  const oldest = history[0]!;
  if (new Date(oldest.ts).getTime() > cutoff) return null; // not a full day yet
  const reference = history.find(
    (h) => h.median !== null && new Date(h.ts).getTime() >= cutoff,
  );
  if (!reference || reference.median === null || reference.median === 0) return null;
  return ((latest - reference.median) / reference.median) * 100;
}

export async function GET(): Promise<NextResponse> {
  const [markets, ticks, meta] = await Promise.all([listMarkets(), latestTicks(), registryMeta()]);

  const histories = await Promise.all(
    markets.map((m) => recentTicks(m.id, 900).catch(() => [])),
  );

  const rows: LiveMarket[] = markets.map((m, i) => {
    const t = ticks.get(m.id);
    return {
      code: m.currency,
      id: m.id,
      median: t?.median ?? null,
      official: t?.official ?? null,
      premiumPct: t?.premiumPct ?? null,
      unitPriceUsd: t?.unitPriceUsd ?? null,
      unitLabel: m.unitLabel,
      maxLeverage: m.maxLeverage,
      status: t?.status ?? "unknown",
      acceptingPositions: t?.status === "ok",
      reason: t?.reason ?? null,
      sources: t?.sourcesUsed ?? [],
      ts: t?.ts ?? null,
      change24hPct: change24h(histories[i] ?? [], t?.median ?? null),
      lastPushTx: t?.pushedTx ?? null,
      marketAccount: m.market,
      collateralVault: m.vault,
    };
  });

  return NextResponse.json(
    { markets: rows, collateralMint: meta?.collateralMint ?? null, at: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
