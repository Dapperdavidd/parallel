"use client";

import { useEffect, useState } from "react";
import { agoLabel, fmt, type Market } from "@/lib/mock";

interface VerifiedFill {
  txSignature: string;
  side: "long" | "short";
  action: string;
  sizeUsdc: number;
  price: number;
  ts: string;
}

/** A truthful devnet feed: only signatures the server verified on-chain. */
export function TradesFeed({ market }: { market: Market }) {
  const [fills, setFills] = useState<VerifiedFill[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/trades?marketId=${encodeURIComponent(`USD/${market.c}`)}&limit=40`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Trade feed unavailable");
        return response.json() as Promise<{ trades?: VerifiedFill[] }>;
      })
      .then((body) => {
        if (!cancelled) setFills(body.trades ?? []);
      })
      .catch(() => {
        if (!cancelled) setFills([]);
      });
    return () => { cancelled = true; };
  }, [market.c]);

  const biggest = Math.max(...fills.map((fill) => fill.sizeUsdc), 1);

  return (
    <aside className="panel feed">
      <div className="feed-head">
        <span className="feed-tab on">Trades</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink3)" }}>
          USD/{market.c}
        </span>
      </div>

      <div className="pressure" title="Only chain-verified devnet fills are shown">
        <div className="pressure-l">
          <span style={{ color: "var(--ink2)" }}>Verified devnet fills</span>
          <span>{fills.length}</span>
        </div>
      </div>

      <div className="feed-cols">
        <span>PRICE</span>
        <span style={{ textAlign: "right" }}>SIZE (tUSDC)</span>
        <span style={{ textAlign: "right" }}>TIME</span>
      </div>

      <div className="feed-rows">
        {fills.length === 0 && (
          <p style={{ padding: "18px 12px", color: "var(--ink3)", fontSize: 12 }}>
            No verified fills in this market yet.
          </p>
        )}
        {fills.map((fill) => {
          const quote = fill.price > 0 ? market.unitSize / fill.price : 0;
          const ago = Math.max(0, Math.floor((Date.now() - new Date(fill.ts).getTime()) / 1000));
          return (
            <div className="feed-row" key={fill.txSignature}>
              <span
                className="feed-bar"
                aria-hidden="true"
                style={{
                  width: `${(fill.sizeUsdc / biggest) * 100}%`,
                  background: fill.side === "long" ? "rgba(46,189,133,.13)" : "rgba(229,72,77,.13)",
                }}
              />
              <span className="mono" style={{ color: fill.side === "long" ? "var(--up)" : "var(--dn)" }}>
                {fmt(quote, market.dp)}
              </span>
              <span className="mono" style={{ textAlign: "right" }}>{fmt(fill.sizeUsdc)}</span>
              <span className="mono" style={{ textAlign: "right", color: "var(--ink3)" }}>
                {fill.action === "close" ? "Close · " : ""}{agoLabel(ago)}
              </span>
            </div>
          );
        })}
      </div>

      <p className="feed-note">
        Parallel settles against a vault, not an order book. Every row is a
        server-verified Percolator transaction; an empty market stays empty.
      </p>
    </aside>
  );
}
