"use client";

import { useEffect, useRef } from "react";
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
import { candlesFor, type Market, type Position } from "@/lib/mock";

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
  positions,
}: {
  market: Market;
  timeframe: Timeframe;
  positions: Position[];
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
        textColor: "#8A8A90",
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1C1C1F" },
        horzLines: { color: "#1C1C1F" },
      },
      rightPriceScale: { borderColor: "#222225" },
      timeScale: { borderColor: "#222225", timeVisible: true, secondsVisible: false },
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

  // Feed it data whenever the market, timeframe or the viewer's trades change.
  useEffect(() => {
    const candles = candleRef.current;
    const official = officialRef.current;
    const chart = chartRef.current;
    if (!candles || !official || !chart) return;

    const data = candlesFor(market, 120, STEP_SECONDS[timeframe]);
    candles.setData(
      data.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    official.setData(
      data.map((c) => ({ time: c.time as UTCTimestamp, value: market.off })),
    );

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

    // The viewer's own entries, newest first so overlapping labels stay legible.
    const mine = positions.filter((p) => p.c === market.c);
    candles.setMarkers(
      mine.map((p, i) => ({
        time: data[Math.max(0, data.length - 2 - i * 4)]!.time as UTCTimestamp,
        position: p.side === "long" ? ("belowBar" as const) : ("aboveBar" as const),
        color: p.side === "long" ? "#2EBD85" : "#E5484D",
        shape: p.side === "long" ? ("arrowUp" as const) : ("arrowDown" as const),
        text: `${p.side === "long" ? "Long" : "Short"} ${p.lev}x`,
      })),
    );

    chart.timeScale().fitContent();
  }, [market, timeframe, positions]);

  return (
    <div
      ref={hostRef}
      className="chart-host"
      role="img"
      aria-label={`USD/${market.c} price chart`}
    />
  );
}
