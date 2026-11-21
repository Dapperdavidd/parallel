"use client";

import { agoLabel, fmt, recentTrades, statsFor, type Market } from "@/lib/mock";

/**
 * Live trades.
 *
 * This occupies the slot a conventional perps UI gives the order book.
 * Percolator settles against a matcher, not a central limit order book, so
 * there is no book to display — showing one would be invented liquidity. Every
 * row here is a fill, which is real and on-chain.
 */
export function TradesFeed({ market }: { market: Market }) {
  const fills = recentTrades(market);
  const { longSharePct } = statsFor(market);

  // Each row carries a bar scaled to the largest fill on screen, so size is
  // readable without reading every number.
  const biggest = Math.max(...fills.map((f) => f.sizeUsd), 1);

  return (
    <aside className="panel feed">
      <div className="feed-head">
        <span className="feed-tab on">Trades</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink3)" }}>
          USD/{market.c}
        </span>
      </div>

      {/* Which way open interest leans. Perp traders read this before price. */}
      <div className="pressure" title="Share of open interest sitting long">
        <div className="pressure-bar">
          <span style={{ width: `${longSharePct}%` }} />
        </div>
        <div className="pressure-l">
          <span style={{ color: "var(--up)" }}>{longSharePct.toFixed(0)}% long</span>
          <span style={{ color: "var(--dn)" }}>{(100 - longSharePct).toFixed(0)}% short</span>
        </div>
      </div>

      <div className="feed-cols">
        <span>PRICE</span>
        <span style={{ textAlign: "right" }}>SIZE (tUSDC)</span>
        <span style={{ textAlign: "right" }}>TIME</span>
      </div>

      <div className="feed-rows">
        {fills.map((f) => (
          <div className="feed-row" key={f.id}>
            <span
              className="feed-bar"
              aria-hidden="true"
              style={{
                width: `${(f.sizeUsd / biggest) * 100}%`,
                background: f.side === "long" ? "rgba(46,189,133,.13)" : "rgba(229,72,77,.13)",
              }}
            />
            <span
              className="mono"
              style={{ color: f.side === "long" ? "var(--up)" : "var(--dn)" }}
            >
              {fmt(f.price, market.dp)}
            </span>
            <span className="mono" style={{ textAlign: "right" }}>
              {f.sizeUsd.toLocaleString("en-US")}
            </span>
            <span className="mono" style={{ textAlign: "right", color: "var(--ink3)" }}>
              {agoLabel(f.ago)}
            </span>
          </div>
        ))}
      </div>

      <p className="feed-note">
        Parallel settles against a vault, not an order book — every row is a
        filled trade on devnet.
      </p>
    </aside>
  );
}
