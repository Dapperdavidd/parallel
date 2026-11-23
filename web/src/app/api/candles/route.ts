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

/** Same boundaries the keeper rolls index candles on, so the axes line up. */
const TIMEFRAME_MINUTES: Record<string, number> = {
  "1H": 60,
  "4H": 4 * 60,
  "1D": 24 * 60,
  "1W": 7 * 24 * 60,
  "1M": 30 * 24 * 60,
};

interface OfficialCandle {
  openTs: string;
  open: number;
  high: number;
  low: number;
  close: number;
  days: number;
}

/**
 * Candles built from the published official rates.
 *
 * The index is days old; a weekly or monthly chart drawn from it is a single
 * candle. The official series goes back two years at one published rate a day,
 * and that aggregates into a real, continuous candle series.
 *
 * Each candle **opens at the previous bucket's close** and closes at the last
 * rate published inside it — the standard close-to-close construction for a
 * daily fix. The high and low are the extremes of the rates actually
 * published, never wider, so a bucket holding one rate gets a candle with a
 * real body and **no wicks** rather than an invented intraday range. That is
 * the distinction that matters: the body is a move that happened, and nothing
 * is drawn that nobody published.
 *
 * This is the *official* rate, a different quantity from the street median, so
 * the response says which it is and the chart labels it.
 */
function officialCandles(
  points: { date: string; rate: number }[],
  tf: string,
): OfficialCandle[] | null {
  const minutes = TIMEFRAME_MINUTES[tf];
  if (!minutes) return null;

  // Group the published rates into the same buckets the keeper rolls on.
  const buckets = new Map<string, number[]>();
  for (const p of points) {
    const ms = new Date(`${p.date}T00:00:00Z`).getTime();
    if (!Number.isFinite(ms) || !(p.rate > 0)) continue;
    const openTs = new Date(Math.floor(ms / (minutes * 60_000)) * minutes * 60_000).toISOString();
    (buckets.get(openTs) ?? buckets.set(openTs, []).get(openTs)!).push(p.rate);
  }

  const out: OfficialCandle[] = [];
  let prevClose: number | null = null;
  for (const openTs of [...buckets.keys()].sort()) {
    const rates = buckets.get(openTs)!;
    const close = rates[rates.length - 1]!;
    const open = prevClose ?? rates[0]!;
    out.push({
      openTs,
      open,
      high: Math.max(open, ...rates),
      low: Math.min(open, ...rates),
      close,
      days: rates.length,
    });
    prevClose = close;
  }

  // Below a day a bucket holds no published rate at all, so there is nothing
  // to build and the dashed official line stays.
  return out.length >= 2 && minutes >= 24 * 60 ? out : null;
}

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
      // Real OHLC from the published daily rates, for the timeframes where a
      // bucket spans several days. Null when it cannot be built honestly.
      officialCandles: officialCandles(
        official.map((o) => ({ date: o.date, rate: o.rate })),
        tf,
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
