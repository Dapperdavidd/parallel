"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MARKETS, byCode, fmt, premium } from "@/lib/mock";
import { useDemo } from "@/lib/store";
import { PriceChart, TIMEFRAMES, type Timeframe } from "@/components/PriceChart";
import { CurrencyBadge } from "@/components/MarketsTable";
import { TradeTicket } from "./TradeTicket";
import { PositionsTable } from "./PositionsTable";

export function TradeView() {
  const params = useSearchParams();
  const { market: stateMarket, setMarket, positions } = useDemo();
  const [tf, setTf] = useState<Timeframe>("1H");

  // A ?m= link from the landing table wins over whatever was last selected.
  const requested = params.get("m");
  useEffect(() => {
    if (requested && requested !== stateMarket) setMarket(requested);
  }, [requested, stateMarket, setMarket]);

  const m = byCode(requested ?? stateMarket);
  const p = premium(m);

  return (
    <div className="tgrid" style={{ flex: 1 }}>
      <aside className="panel mlistp">
        <div
          style={{
            padding: "14px 16px",
            fontSize: 12,
            letterSpacing: ".08em",
            color: "var(--ink3)",
            borderBottom: "1px solid var(--ln)",
          }}
        >
          MARKETS
        </div>
        <div className="mlist">
          {MARKETS.map((x) => (
            <button
              key={x.c}
              type="button"
              className={x.c === m.c ? "on" : undefined}
              onClick={() => setMarket(x.c)}
            >
              <CurrencyBadge m={x} small />
              <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <b style={{ fontWeight: 500, fontSize: 14 }}>USD/{x.c}</b>
                <span style={{ fontSize: 11, color: "var(--ink3)" }}>
                  {x.lev}x · {x.st}
                </span>
              </span>
              <span
                className="mono"
                style={{ marginLeft: "auto", fontSize: 13, color: "var(--ink2)" }}
              >
                {fmt(x.px, x.dp)}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="panel" style={{ display: "flex", flexDirection: "column" }}>
        <div className="mhead">
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600 }}>
            <CurrencyBadge m={m} small />
            USD/{m.c}
          </div>
          <div className="stat">
            Street price<b style={{ fontSize: 18 }}>{fmt(m.px, m.dp)}</b>
          </div>
          <div className="stat">
            Official<b>{fmt(m.off, m.dp)}</b>
          </div>
          <div className="stat">
            Gap
            <b style={{ color: "var(--amb)" }}>
              {p >= 0 ? "+" : ""}
              {p.toFixed(1)}% vs official
            </b>
          </div>
          <div className="stat">
            Max leverage<b>{m.lev}x</b>
          </div>
          <div className="stat">
            Sources
            <b style={{ fontFamily: "inherit" }}>
              {m.src.length} · {m.st}
            </b>
          </div>
          <div className="stat">
            Contract<b>{m.unitLabel}</b>
          </div>
        </div>

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
        </div>

        <PriceChart market={m} timeframe={tf} positions={positions} />

        <div style={{ borderTop: "1px solid var(--ln)", overflowX: "auto" }}>
          <div style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600 }}>Positions</div>
          <PositionsTable />
        </div>
      </section>

      <TradeTicket market={m} />
    </div>
  );
}
