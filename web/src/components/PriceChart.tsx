"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { ChartDrawings } from "@/components/trade/ChartDrawings";
import { readScale } from "@/lib/chart-scale";

/** What /api/candles returns. */
interface ChartFeed {
  /** OHLC in the familiar quote — local currency per USD. */
  candles: { openTs: string; open: number; high: number; low: number; close: number }[];
  ticks: { ts: string; price: number; median: number | null }[];
  official: number | null;
  officialHistory: { date: string; rate: number }[];
  /** Real OHLC from the published daily rates; null when a bucket is one day. */
  officialCandles:
    | { openTs: string; open: number; high: number; low: number; close: number; days: number }[]
    | null;
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
export interface ChartIndicators {
  ma20: boolean;
  ema50: boolean;
}

const STEP_SECONDS: Record<Timeframe, number> = {
  "1H": 3600,
  "4H": 4 * 3600,
  "1D": 24 * 3600,
  "1W": 7 * 24 * 3600,
  "1M": 30 * 24 * 3600,
};

/* ----------------------------------------------------------- pan, zoom -- */

/**
 * Pan and zoom are ours rather than the library's.
 *
 * The library maps a wheel event to `barSpacing + deltaY/100 * barSpacing/10`.
 * On a mouse that is a tolerable step; on a trackpad, where one swipe is fifty
 * events of `deltaY ≈ 2`, it is a fifth of a percent at a time — the gesture
 * reads as doing nothing at all, while the small sideways drift of the same
 * swipe scrolls the chart. That is exactly the reported symptom: the candles
 * sit still and the frame slides off to one side.
 *
 * So: zoom is exponential in the wheel delta, which makes it feel identical
 * from a trackpad and from a notched wheel, and it is anchored on the pointer
 * — the bar under the cursor does not move. One flick is about two and a half
 * times in or out, and one wheel notch about a third.
 */
const ZOOM_GAIN = 320;
/** A pinch (a wheel event with ctrl held) is a deliberate, finer gesture. */
const PINCH_GAIN = 90;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The library's own floor; declared here because the arithmetic below needs it. */
const MIN_BAR_SPACING = 0.5;

const simpleMovingAverage = (data: Candle[], period: number) =>
  data.flatMap((point, index) => {
    if (index + 1 < period) return [];
    const window = data.slice(index + 1 - period, index + 1);
    const value = window.reduce((sum, item) => sum + item.close, 0) / period;
    return [{ time: point.time as UTCTimestamp, value }];
  });

const exponentialMovingAverage = (data: Candle[], period: number) => {
  if (data.length === 0) return [];
  const alpha = 2 / (period + 1);
  let value = data[0]!.close;
  return data.map((point) => {
    value = point.close * alpha + value * (1 - alpha);
    return { time: point.time as UTCTimestamp, value };
  });
};

/**
 * One change of view: zoom by `factor` about `anchorX`, then slide by
 * `panPx` pixels.
 *
 * Both are done by setting bar spacing and the right offset, which is how the
 * library's own zoom works internally. Two details make the obvious
 * alternatives wrong:
 *
 *  - Not `setVisibleLogicalRange`: a logical range addresses bar *centres*
 *    while the range is measured at the pane edges, and that half-bar changes
 *    with the zoom, so setting a range left the anchor drifting about thirty
 *    pixels a notch.
 *  - The right offset is corrected in closed form rather than by measuring,
 *    because `applyOptions({ barSpacing })` is queued on an invalidation mask
 *    and does not take effect until the next frame — reading the scale back
 *    straight away returns the old one, and the correction came out as zero.
 *    Inverting the library's index-to-coordinate line gives it exactly:
 *    holding the index at `x` fixed through a change of spacing needs
 *    `rightOffset += (width - 1 - x) * (1/s' - 1/s)`.
 *
 * Zoom and pan are applied together because each sets the right offset
 * absolutely: done as two calls, the second would read a scale the first had
 * only queued, and throw the first away.
 */
function transformView(
  chart: IChartApi,
  change: { factor?: number; panPx?: number; anchorX?: number | null; barCount: number },
): void {
  const ts = chart.timeScale();
  const scale = readScale(ts);
  if (!scale) return;

  const factor = change.factor ?? 1;
  const panPx = change.panPx ?? 0;
  if (!Number.isFinite(factor) || factor <= 0) return;

  const width = ts.width();
  const s = scale.spacing;
  // The library clamps the spacing to these bounds itself. Clamping here too
  // keeps the offset correction in step with the spacing actually applied.
  const next = clamp(s / factor, MIN_BAR_SPACING, Math.max(MIN_BAR_SPACING, width * 0.5));
  // Zooming further out once the whole series is already a smudge is nothing
  // but a way to lose the chart off the side of the pane.
  const refusesZoomOut = next < s && change.barCount * next < width * 0.15;
  const spacing = refusesZoomOut ? s : next;

  const x = change.anchorX ?? width / 2;
  let offset = ts.scrollPosition();
  if (spacing !== s) offset += (width - 1 - x) * (1 / spacing - 1 / s);
  // A bigger right offset pushes the last bar further left, which is what a
  // positive `deltaX` — a swipe towards the future — should do.
  if (panPx !== 0) offset += panPx / spacing;

  if (spacing !== s) ts.applyOptions({ barSpacing: spacing });
  ts.scrollToPosition(offset, false);
}

/**
 * The market chart: candles of the Parallel street index, with the official
 * rate as a dashed overlay so the premium is visible, markers for the viewer's
 * own entries (PRD F6), and a drawing layer for the tools a trader expects.
 *
 * Built on TradingView Lightweight Charts, styled to match the design
 * hand-off's palette.
 */
export function PriceChart({
  market,
  timeframe,
  trades,
  indicators,
  onSource,
}: {
  market: Market;
  timeframe: Timeframe;
  /** The viewer's confirmed trades in this market. */
  trades: { ts: string; side: "long" | "short"; action: string }[];
  indicators: ChartIndicators;
  /** Tells the caller what the chart is actually showing, so it can say so. */
  onSource?: (s: { mode: "index" | "official-candles" | "official" | "sample"; indexFrom: string | null }) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const officialRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  /** The `market|timeframe` whose data the current viewport was fitted to. */
  const fittedRef = useRef<string>("");
  const markRef = useRef<IPriceLine | null>(null);
  /** The wheel handler needs the bar count without re-binding on every pass. */
  const barCountRef = useRef(0);

  /** Published once the chart exists, so the drawing layer can attach to it. */
  const [api, setApi] = useState<{
    chart: IChartApi;
    series: ISeriesApi<"Candlestick">;
  } | null>(null);
  /** Bar open times, for anchoring drawings between and beyond the bars. */
  const [barTimes, setBarTimes] = useState<number[]>([]);

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
        // The library draws a TradingView logo here by default, linking out to
        // tradingview.com. Its licence allows disabling it once the attribution
        // notice is carried elsewhere, which /docs/about now does. It was also
        // simply wrong for us: TradingView has no USD/NGN, so the link led
        // somewhere that cannot show the market the user was looking at.
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#161C2E" },
        horzLines: { color: "#161C2E" },
      },
      rightPriceScale: { borderColor: "#1C2238" },
      timeScale: {
        borderColor: "#1C2238",
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 9,
        minBarSpacing: 0.5,
        rightOffset: 4,
        // Resizing the panel should move the frame, not re-fit the data and
        // throw away wherever the viewer had scrolled to.
        lockVisibleTimeRangeOnResize: true,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#3D5CF5", labelBackgroundColor: "#3D5CF5" },
        horzLine: { color: "#3D5CF5", labelBackgroundColor: "#3D5CF5" },
      },
      // Drag to pan, drag an axis to rescale it, pinch to zoom on a phone.
      // The wheel is handled below instead of here, because the library's own
      // mapping is unusable on a trackpad.
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: false,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      kineticScroll: { mouse: false, touch: true },
      autoSize: true,
    });

    const series = chart.addCandlestickSeries({
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
    candleRef.current = series;

    officialRef.current = chart.addLineSeries({
      color: "#8A8A90",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    ma20Ref.current = chart.addLineSeries({
      color: "#F2A93B",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    ema50Ref.current = chart.addLineSeries({
      color: "#9FB0FF",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    setApi({ chart, series });

    // Wheel: vertical zooms on the pointer, horizontal pans, shift pans,
    // ctrl (which is what a trackpad pinch sends) zooms finer.
    //
    // A trackpad delivers several wheel events per frame, so they are
    // accumulated and applied once a frame. Applying each one as it arrives
    // looked right and was not: the view change is queued until the next
    // frame, so every event in a burst computed from the same unchanged scale
    // and the last one simply overwrote the rest. A flick of twenty events
    // zoomed 1.3% instead of 28%, which is precisely the gesture that felt
    // like it was doing nothing.
    let pendingFactor = 1;
    let pendingPanPx = 0;
    let anchorX = 0;
    let scheduled = 0;
    const flush = (): void => {
      scheduled = 0;
      const factor = pendingFactor;
      const panPx = pendingPanPx;
      pendingFactor = 1;
      pendingPanPx = 0;
      if (factor === 1 && panPx === 0) return;
      transformView(chart, { factor, panPx, anchorX, barCount: barCountRef.current });
    };
    const schedule = (): void => {
      if (scheduled === 0) scheduled = window.requestAnimationFrame(flush);
    };

    const onWheel = (event: WheelEvent): void => {
      const unit = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? 120 : 1;
      const dy = event.deltaY * unit;
      const dx = event.deltaX * unit;
      if (dy === 0 && dx === 0) return;
      event.preventDefault();

      const rect = host.getBoundingClientRect();
      anchorX = event.clientX - rect.left;

      if (event.ctrlKey || event.metaKey) {
        pendingFactor *= Math.exp(clamp(dy, -60, 60) / PINCH_GAIN);
      } else if (event.shiftKey) {
        pendingPanPx += dy;
      } else if (Math.abs(dx) > Math.abs(dy)) {
        pendingPanPx += dx;
      } else {
        pendingFactor *= Math.exp(clamp(dy, -140, 140) / ZOOM_GAIN);
      }
      schedule();
    };
    host.addEventListener("wheel", onWheel, { passive: false });

    // Double-click anywhere on the chart frames the whole series again. The
    // library only does this on the axes, and once zoom survives a refresh the
    // viewer needs an obvious way back out.
    const reset = (): void => chart.timeScale().fitContent();
    host.addEventListener("dblclick", reset);

    return () => {
      if (scheduled !== 0) window.cancelAnimationFrame(scheduled);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("dblclick", reset);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      officialRef.current = null;
      ma20Ref.current = null;
      ema50Ref.current = null;
      markRef.current = null;
      setApi(null);
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
    const ma20 = ma20Ref.current;
    const ema50 = ema50Ref.current;
    const chart = chartRef.current;
    if (!candles || !official || !ma20 || !ema50 || !chart) return;

    const real = feed?.candles ?? [];
    const officialPts = feed?.officialHistory ?? [];

    const toCandle = (c: ChartFeed["candles"][number]): Candle => ({
      time: Math.floor(new Date(c.openTs).getTime() / 1000),
      open: c.open, high: c.high, low: c.low, close: c.close,
    });

    let data: Candle[];
    let mode: "index" | "official-candles" | "official" | "sample";
    let backfill: { time: number; value: number }[] = [];

    if (real.length >= MIN_REAL_CANDLES) {
      // Enough measured history to draw the index itself.
      data = real.map(toCandle);
      mode = "index";
    } else if (feed?.officialCandles && feed.officialCandles.length > 0) {
      // Not enough measured history at this timeframe — a weekly or monthly
      // chart of a two-day-old index is one candle. The published daily rates
      // aggregate into real candles, so draw those instead of a lone bar above
      // a flat line. One candle series, one quantity: these are official
      // rates, and the caption says so. The dashed overlay is dropped, since
      // the candles already *are* the official series, and the labelled mark
      // line still shows where the street index is right now.
      data = feed.officialCandles.map((c) => ({
        time: Math.floor(new Date(c.openTs).getTime() / 1000),
        open: c.open, high: c.high, low: c.low, close: c.close,
      }));
      mode = "official-candles";
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
    ma20.setData(indicators.ma20 ? simpleMovingAverage(data, 20) : []);
    ema50.setData(indicators.ema50 ? exponentialMovingAverage(data, 50) : []);
    barCountRef.current = data.length;
    // The drawing layer anchors on time, and needs the bar times to place a
    // point that falls between bars or beyond the last one. Replace the array
    // only when it has actually changed, or the layer re-renders on every poll.
    const times = data.map((c) => c.time as number);
    setBarTimes((prev) =>
      prev.length === times.length &&
      prev[0] === times[0] &&
      prev[prev.length - 1] === times[times.length - 1]
        ? prev
        : times,
    );

    // The dashed line is either the official-rate history (pre-launch) or the
    // current official rate drawn flat across the measured span.
    if (mode === "official-candles") {
      // The candles already are the official series; a second copy of it as a
      // line would just be noise.
      official.setData([]);
    } else if (backfill.length > 0) {
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

    // Fit the frame only when the dataset itself changes — a new market, a new
    // timeframe, or a change of what is being drawn. The live price poll hands
    // back a fresh `market` object every 30 seconds, and fitting on that was
    // silently undoing the viewer's zoom and scroll twice a minute, which is
    // why the chart felt like it fought back. Double-click resets it
    // deliberately instead.
    //
    // `mode` belongs in the key: the first pass draws the sample series while
    // the feed is still in flight, and keying on market and timeframe alone
    // meant the frame stayed fitted to the sample — the real candles then
    // landed in a corner of an empty pane at the default bar spacing.
    const key = `${market.c}|${timeframe}|${mode}`;
    if (fittedRef.current !== key) {
      chart.timeScale().fitContent();
      fittedRef.current = key;
    }
  }, [market, timeframe, trades, feed, indicators, onSource]);

  const zoom = useCallback((factor: number) => {
    const chart = chartRef.current;
    if (chart) transformView(chart, { factor, barCount: barCountRef.current });
  }, []);
  const fit = useCallback(() => chartRef.current?.timeScale().fitContent(), []);

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <div
        ref={hostRef}
        className="chart-host"
        role="img"
        aria-label={`USD/${market.c} price chart`}
      />

      {api && (
        <ChartDrawings
          chart={api.chart}
          series={api.series}
          wrap={wrapRef}
          host={hostRef}
          barTimes={barTimes}
          code={market.c}
          dp={market.dp}
        />
      )}

      <div className="chart-zoom">
        <button type="button" onClick={() => zoom(1 / 1.35)} title="Zoom in" aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoom(1.35)} title="Zoom out" aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={fit} title="Fit the whole series (or double-click the chart)" aria-label="Fit">
          ⤢
        </button>
      </div>
    </div>
  );
}
