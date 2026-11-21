import { NextResponse } from "next/server";
import { candles, recentTicks } from "@/lib/server/data";

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

  const [rolled, ticks] = await Promise.all([
    candles(market, tf, 300),
    recentTicks(market, 300),
  ]);

  return NextResponse.json(
    {
      market,
      timeframe: tf,
      candles: rolled,
      ticks: ticks
        .filter((t) => t.unitPriceUsd !== null)
        .map((t) => ({ ts: t.ts, price: t.unitPriceUsd, median: t.median })),
      official: ticks.length > 0 ? (ticks[ticks.length - 1]!.official ?? null) : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
