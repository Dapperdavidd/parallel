import { latestTicks, listMarkets, registryMeta } from "@/lib/server/data";
import { CEILINGS, route } from "@/lib/server/request";
import { ok } from "@/lib/server/respond";

/**
 * F11 — the public index page.
 *
 * "Shows method, rules, every source and its latest price for every market."
 *
 * The whole point of this endpoint is that nothing is hidden: it returns every
 * source reading including the ones that failed and the ones dropped as
 * outliers, plus the on-chain transaction the median was written in. A reader
 * should be able to recompute our number from this response alone.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = route("index-feed", { ceiling: CEILINGS.read, sameOrigin: false }, async () => {
  const [markets, ticks, meta] = await Promise.all([
    listMarkets(),
    latestTicks(),
    registryMeta(),
  ]);

  const rows = markets.map((m) => {
    const t = ticks.get(m.id);
    return {
      id: m.id,
      currency: m.currency,
      unitLabel: m.unitLabel,
      maxLeverage: m.maxLeverage,
      marketAccount: m.market,
      status: t?.status ?? "unknown",
      reason: t?.reason ?? null,
      ts: t?.ts ?? null,
      median: t?.median ?? null,
      unitPriceUsd: t?.unitPriceUsd ?? null,
      official: t?.official ?? null,
      premiumPct: t?.premiumPct ?? null,
      sourcesUsed: t?.sourcesUsed ?? [],
      readings: t?.breakdown ?? [],
      dropped: t?.dropped ?? [],
      failed: t?.failed ?? [],
      pushedTx: t?.pushedTx ?? null,
      pushedSlot: t?.pushedSlot ?? null,
    };
  });

  return ok(
    {
      network: "devnet",
      ...meta,
      rules: {
        pollSeconds: 120,
        outlierPct: 3,
        minSources: 2,
        officialBandPct: 15,
        pushMovePct: 0.1,
        pushMaxAgeMinutes: 10,
      },
      markets: rows,
      at: new Date().toISOString(),
    },
    { "Cache-Control": "public, max-age=15, stale-while-revalidate=105" },
  );
});
