"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { byCode } from "@/lib/mock";
import { useMarket } from "@/lib/live";
import { useDemo } from "@/lib/store";
import { useChainPortfolio } from "@/lib/useChainPortfolio";
import {
  PriceChart,
  TIMEFRAMES,
  type ChartIndicators,
  type Timeframe,
} from "@/components/PriceChart";
import { MarketSelect } from "./MarketSelect";
import { MarketStats } from "./MarketStats";
import { TradesFeed } from "./TradesFeed";
import { TradeTicket } from "./TradeTicket";
import { BottomPanel } from "./BottomPanel";

/**
 * The trade screen.
 *
 * Laid out the way a working perps terminal is: market picker and stats across
 * the top, chart filling the middle, live trades beside it, the order ticket
 * on the right, and positions/balances/history docked at the bottom.
 *
 * Where a conventional venue puts an order book, we put the trades feed —
 * Percolator settles against a matcher, not a central limit order book, so a
 * book would be invented liquidity.
 */
export function TradeView() {
  const params = useSearchParams();
  const { market: stateMarket, setMarket } = useDemo();
  const { trades } = useChainPortfolio();
  const [tf, setTf] = useState<Timeframe>("1H");
  const [indicators, setIndicators] = useState<ChartIndicators>({ ma20: true, ema50: false });

  const requested = params.get("m");
  useEffect(() => {
    if (requested && requested !== stateMarket) setMarket(requested);
  }, [requested, stateMarket, setMarket]);

  // Live street price where the index has it; sample values where it does not.
  const code = byCode(requested ?? stateMarket).c;
  const m = useMarket(code);

  // The chart says what it is actually drawing — measured index, or the
  // published official rate standing in for the span before we existed.
  const [source, setSource] = useState<{
    mode: "index" | "official-candles" | "official" | "sample";
    indexFrom: string | null;
  }>({ mode: "sample", indexFrom: null });
  // Only update when something actually changed: the chart reports on every
  // data pass, and a new object each time would re-render in a loop.
  const onSource = useCallback(
    (next: { mode: "index" | "official-candles" | "official" | "sample"; indexFrom: string | null }) =>
      setSource((prev) =>
        prev.mode === next.mode && prev.indexFrom === next.indexFrom ? prev : next,
      ),
    [],
  );

  const caption =
    source.mode === "index"
      ? "Parallel street index · official rate dashed"
      : source.mode === "official-candles"
        ? "Official published rate · the street index is too young for this timeframe"
      : source.mode === "official"
        ? source.indexFrom
          ? `Official rate history · street index from ${new Date(source.indexFrom).toLocaleDateString()}`
          : "Official rate history · street index building"
        : "Sample data";

  return (
    <div className="tpage">
      <div className="thead">
        <MarketSelect market={m} />
        <MarketStats market={m} />
      </div>

      <div className="tbody">
        <section className="panel tchart">
          <div className="tf">
            {TIMEFRAMES.map((x) => (
              <button
                key={x}
                type="button"
                className={x === tf ? "on" : undefined}
                onClick={() => setTf(x)}
              >
                {x}
              </button>
            ))}
            <i className="tf-sep" aria-hidden />
            <button
              type="button"
              className={indicators.ma20 ? "indicator on" : "indicator"}
              onClick={() => setIndicators((value) => ({ ...value, ma20: !value.ma20 }))}
              title="20-period simple moving average of the series on screen"
            >
              <span className="ind-dot ma" /> MA 20
            </button>
            <button
              type="button"
              className={indicators.ema50 ? "indicator on" : "indicator"}
              onClick={() => setIndicators((value) => ({ ...value, ema50: !value.ema50 }))}
              title="50-period exponential moving average of the series on screen"
            >
              <span className="ind-dot ema" /> EMA 50
            </button>
            <span className="chart-caption">
              {caption}
            </span>
          </div>

          <PriceChart
            market={m}
            timeframe={tf}
            indicators={indicators}
            trades={(trades ?? []).filter((t) => t.marketId === `USD/${m.c}`)}
            onSource={onSource}
          />
          <BottomPanel market={m} />
        </section>

        <TradesFeed market={m} />
        <TradeTicket market={m} />
      </div>
    </div>
  );
}
