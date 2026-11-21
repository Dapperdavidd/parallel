"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { byCode } from "@/lib/mock";
import { useDemo } from "@/lib/store";
import { PriceChart, TIMEFRAMES, type Timeframe } from "@/components/PriceChart";
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
  const { market: stateMarket, setMarket, positions } = useDemo();
  const [tf, setTf] = useState<Timeframe>("1H");

  const requested = params.get("m");
  useEffect(() => {
    if (requested && requested !== stateMarket) setMarket(requested);
  }, [requested, stateMarket, setMarket]);

  const m = byCode(requested ?? stateMarket);

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
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink3)", paddingRight: 4 }}>
              Parallel street index · official rate dashed
            </span>
          </div>

          <PriceChart market={m} timeframe={tf} positions={positions} />
          <BottomPanel market={m} />
        </section>

        <TradesFeed market={m} />
        <TradeTicket market={m} />
      </div>
    </div>
  );
}
