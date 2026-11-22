"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { candlesFor, type Candle, type Market } from "@/lib/mock";

/** What /api/candles returns. */
interface ChartFeed {
  /** OHLC in the familiar quote — local currency per USD. */
  candles: { openTs: string; open: number; high: number; low: number; close: number }[];
  ticks: { ts: string; price: number; median: number | null }[];
  official: number | null;
  officialHistory: { date: string; rate: number }[];
}

/**
 * The index has only existed since the service started running, so a new
 * market has minutes of history, not months. Below this many real candles the
 * chart would be a stub, and we show the published official-rate history
 * instead — clearly as the official rate, never as our street index.
 */
const MIN_REAL_CANDLES = 8;

/** PRD F6 asks for five timeframes. */
export const TIMEFRAMES = ["1H", "4H", "1D", "1W", "1M"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

const STEP_SECONDS: Record<Timeframe, number> = {
  "1H": 3600,
  "4H": 4 * 3600,
  "1D": 24 * 3600,
  "1W": 7 * 24 * 3600,
  "1M": 30 * 24 * 3600,
};

/**
 * The market chart: candles of the Parallel street index, with the official
 * rate as a dashed overlay so the premium is visible, plus markers for the
 * viewer's own entries (PRD F6).
 *
 * Built on TradingView Lightweight Charts, styled to match the design
 * hand-off's palette.
 */
export function PriceChart({
  market,
  timeframe,
  trades,
  onSource,
}: {
  market: Market;
  timeframe: Timeframe;
  /** The viewer's confirmed trades in this market. */
  trades: { ts: string; side: "long" | "short"; action: string }[];
  /** Tells the caller what the chart is actually showing, so it can say so. */
  onSource?: (s: { mode: "index" | "official" | "sample"; indexFrom: string | null }) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const officialRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markRef = useRef<IPriceLine | null>(null);

  // Create once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#868CA2",
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#161C2E" },
        horzLines: { color: "#161C2E" },
      },
      rightPriceScale: { borderColor: "#1C2238" },
      timeScale: { borderColor: "#1C2238", timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#3D5CF5", labelBackgroundColor: "#3D5CF5" },
        horzLine: { color: "#3D5CF5", labelBackgroundColor: "#3D5CF5" },
      },
      autoSize: true,
    });

    candleRef.current = chart.addCandlestickSeries({
      upColor: "#2EBD85",
      downColor: "#E5484D",
      borderUpColor: "#2EBD85",
      borderDownColor: "#E5484D",
      wickUpColor: "#2EBD85",
      wickDownColor: "#E5484D",
      // The mark price line below carries the label. Without this, its badge
      // and the series' own last-value badge stack on top of each other.
      lastValueVisible: false,
      priceLineVisible: false,
    });

    officialRef.current = chart.addLineSeries({
      color: "#8A8A90",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      officialRef.current = null;
      markRef.current = null;
    };
  }, []);

  // Real index history, when there is any.
  const [feed, setFeed] = useState<ChartFeed | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/candles?market=${encodeURIComponent(`USD/${market.c}`)}&tf=${timeframe}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json()) as ChartFeed;
        if (!cancelled) setFeed(body);
      } catch {
        // Leave `feed` null: the chart falls back to the sample series rather
        // than showing nothing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [market.c, timeframe]);

  // Feed it data whenever the market, timeframe or the viewer's trades change.
  useEffect(() => {
    const candles = candleRef.current;
    const official = officialRef.current;
    const chart = chartRef.current;
    if (!candles || !official || !chart) return;

    const real = feed?.candles ?? [];
    const officialPts = feed?.officialHistory ?? [];

    const toCandle = (c: ChartFeed["candles"][number]): Candle => ({
      time: Math.floor(new Date(c.openTs).getTime() / 1000),
      open: c.open, high: c.high, low: c.low, close: c.close,
    });

    let data: Candle[];
    let mode: "index" | "official" | "sample";
    let backfill: { time: number; value: number }[] = [];

    if (real.length >= MIN_REAL_CANDLES) {
      // Enough measured history to draw the index itself.
      data = real.map(toCandle);
      mode = "index";
    } else if (officialPts.length > 0) {
      // Pre-launch. Draw the published official rate as a line — it is a
      // daily publication with no intraday range, so candles would imply a
      // high and low nobody published. Whatever index history exists is drawn
      // as candles on top, so the handover is visible rather than blended.
      backfill = officialPts.map((p) => ({
        time: Math.floor(new Date(`${p.date}T00:00:00Z`).getTime() / 1000),
        value: p.rate,
      }));
      data = real.map(toCandle);
      mode = "official";
    } else {
      data = candlesFor(market, 120, STEP_SECONDS[timeframe]);
      mode = "sample";
    }

    onSource?.({
      mode,
      indexFrom: real.length > 0 ? real[0]!.openTs : null,
    });
    candles.setData(
      data.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    // The dashed line is either the official-rate history (pre-launch) or the
    // current official rate drawn flat across the measured span.
    if (backfill.length > 0) {
      official.setData(backfill.map((b) => ({ time: b.time as UTCTimestamp, value: b.value })));
    } else {
      const officialRate = feed?.official ?? market.off;
      official.setData(
        data.map((c) => ({ time: c.time as UTCTimestamp, value: officialRate })),
      );
    }

    // Mark price: a labelled line at the latest index value. Remove the
    // previous one first — createPriceLine adds, it does not replace, so
    // changing market or timeframe would otherwise stack lines up.
    if (markRef.current) candles.removePriceLine(markRef.current);
    markRef.current = candles.createPriceLine({
      price: market.px,
      color: "#3D5CF5",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "mark",
    });

    // The viewer's own confirmed trades, each snapped to the candle it landed
    // in. Previously these arrows were placed at arbitrary bar offsets from the
    // right edge, which put a real position at a time it never happened; a
    // marker is only worth drawing where it actually belongs.
    const first = data[0]!.time as number;
    const last = data[data.length - 1]!.time as number;
    candles.setMarkers(
      trades
        .map((t) => ({ t, at: Math.floor(new Date(t.ts).getTime() / 1000) }))
        .filter(({ at }) => at >= first && at <= last)
        .sort((a, b) => a.at - b.at)
        .map(({ t, at }) => {
          // Snap back to the opening time of the bar that contains it.
          const bar = data.reduce(
            (best, point) => ((point.time as number) <= at ? (point.time as number) : best),
            first,
          );
          const long = t.side === "long";
          const closing = t.action === "close";
          return {
            time: bar as UTCTimestamp,
            position: long ? ("belowBar" as const) : ("aboveBar" as const),
            color: closing ? "#868CA2" : long ? "#2EBD85" : "#E5484D",
            shape: long ? ("arrowUp" as const) : ("arrowDown" as const),
            text: `${closing ? "Closed" : long ? "Long" : "Short"}`,
          };
        }),
    );

    chart.timeScale().fitContent();
  }, [market, timeframe, trades, feed, onSource]);

  return (
    <div
      ref={hostRef}
      className="chart-host"
      role="img"
      aria-label={`USD/${market.c} price chart`}
    />
  );
}
