import { NextResponse } from "next/server";
import { candles, listMarkets, officialHistory, recentTicks } from "@/lib/server/data";

/**
 * F6 — candles for the price chart.
 *
 * Pre-rolled candles when the keeper has written them. A market created
 * minutes ago has fewer candles than a chart wants, so this also returns the
 * raw ticks: the client can draw a line from ticks while history builds, and
 * switch to candles once there are enough. Better a short honest chart than a
 * long invented one.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TIMEFRAMES = new Set(["1H", "4H", "1D", "1W", "1M"]);

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const market = url.searchParams.get("market");
  const tf = url.searchParams.get("tf") ?? "1H";

  if (!market) {
    return NextResponse.json({ error: "market is required" }, { status: 400 });
  }
  if (!TIMEFRAMES.has(tf)) {
    return NextResponse.json({ error: `unknown timeframe ${tf}` }, { status: 400 });
  }

  const [rolled, ticks, official, markets] = await Promise.all([
    candles(market, tf, 300),
    recentTicks(market, 300),
    officialHistory(market),
    listMarkets(),
  ]);

  // The engine is told a USD price per contract; the UI always shows the
  // familiar quote (₦1,447 per $1). They are reciprocals scaled by the
  // contract size, so inverting swaps high and low.
  const unit = markets.find((m) => m.id === market)?.unit ?? 1;
  const quote = (unitPrice: number): number => (unitPrice > 0 ? unit / unitPrice : 0);

  return NextResponse.json(
    {
      market,
      timeframe: tf,
      unit,
      // Both scales, so a caller can plot either without guessing the unit.
      candles: rolled.map((c) => ({
        openTs: c.openTs,
        open: quote(c.open),
        high: quote(c.low),
        low: quote(c.high),
        close: quote(c.close),
        unitOpen: c.open,
        unitClose: c.close,
      })),
      ticks: ticks
        .filter((t) => t.unitPriceUsd !== null)
        .map((t) => ({ ts: t.ts, price: t.unitPriceUsd, median: t.median })),
      official: ticks.length > 0 ? (ticks[ticks.length - 1]!.official ?? null) : null,
      // Published official rates for the span before the index existed. A
      // different quantity from the street median — the chart labels it.
      // `rate` is already local currency per USD — the same scale the chart
      // and the rest of the UI use.
      officialHistory: official.map((o) => ({ date: o.date, rate: o.rate })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
