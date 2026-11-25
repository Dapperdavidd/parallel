"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { agoLabel, compactUsd, fmt, type Market } from "@/lib/mock";

interface VerifiedFill {
  txSignature: string;
  side: "long" | "short";
  action: string;
  sizeUsdc: number;
  price: number;
  ts: string;
}

interface LiquidityVault {
  marketId: string;
  capitalUsdc: number | null;
  equityUsdc: number | null;
  inventoryUsdc: number | null;
  inventorySide: "long" | "short" | "flat" | null;
  openInterestLongUsdc: number | null;
  openInterestShortUsdc: number | null;
  maxNotionalUsdc: number;
  maxOpenInterestUsdc: number;
  utilisation: number | null;
  error: string | null;
}

/** A truthful devnet feed: only signatures the server verified on-chain. */
export function TradesFeed({ market }: { market: Market }) {
  const [tab, setTab] = useState<"trades" | "liquidity">("trades");
  const [fills, setFills] = useState<VerifiedFill[]>([]);
  const [vault, setVault] = useState<LiquidityVault | null>(null);
  const [slot, setSlot] = useState<number | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/vaults", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Liquidity unavailable");
        return response.json() as Promise<{ slot?: number; vaults?: LiquidityVault[] }>;
      })
      .then((body) => {
        if (cancelled) return;
        setSlot(body.slot ?? null);
        setVault((body.vaults ?? []).find((row) => row.marketId === `USD/${market.c}`) ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setSlot(null);
          setVault(null);
        }
      });
    return () => { cancelled = true; };
  }, [market.c]);

  const biggest = Math.max(...fills.map((fill) => fill.sizeUsdc), 1);

  return (
    <aside className="panel feed">
      <div className="feed-head">
        <button
          type="button"
          className={`feed-tab${tab === "trades" ? " on" : ""}`}
          onClick={() => setTab("trades")}
        >
          Trades
        </button>
        <button
          type="button"
          className={`feed-tab${tab === "liquidity" ? " on" : ""}`}
          onClick={() => setTab("liquidity")}
        >
          Liquidity
        </button>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink3)" }}>
          USD/{market.c}
        </span>
      </div>

      {tab === "trades" ? (
        <>
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
            Every row is a server-verified Percolator transaction; an empty market stays empty.
          </p>
        </>
      ) : (
        <div className="liq-panel">
          {!vault ? (
            <p className="bpanel-empty">Liquidity could not be read at this slot.</p>
          ) : vault.error ? (
            <p className="bpanel-empty" style={{ color: "var(--amb)" }}>{vault.error}</p>
          ) : (
            <>
              <div className="liq-hero">
                <span>Available market capacity</span>
                <b>{compactUsd(Math.max(0, vault.maxOpenInterestUsdc - Math.max(vault.openInterestLongUsdc ?? 0, vault.openInterestShortUsdc ?? 0)))}</b>
                <small>isolated to USD/{market.c}</small>
              </div>

              <div className="liq-meter" aria-label={`${((vault.utilisation ?? 0) * 100).toFixed(1)}% utilised`}>
                <span style={{ width: `${Math.min(100, (vault.utilisation ?? 0) * 100)}%` }} />
              </div>
              <div className="pressure-l">
                <span>{((vault.utilisation ?? 0) * 100).toFixed(1)}% utilised</span>
                <span>cap {compactUsd(vault.maxOpenInterestUsdc)}</span>
              </div>

              <div className="liq-rows">
                <div><span>Vault capital</span><b>{fmt(vault.capitalUsdc ?? 0)} tUSDC</b></div>
                <div><span>Vault equity</span><b>{fmt(vault.equityUsdc ?? 0)} tUSDC</b></div>
                <div><span>Long OI</span><b>{compactUsd(vault.openInterestLongUsdc ?? 0)}</b></div>
                <div><span>Short OI</span><b>{compactUsd(vault.openInterestShortUsdc ?? 0)}</b></div>
                <div><span>Inventory</span><b className={vault.inventorySide === "long" ? "up" : vault.inventorySide === "short" ? "down" : undefined}>{vault.inventorySide === "flat" ? "Flat" : `${vault.inventorySide} ${compactUsd(Math.abs(vault.inventoryUsdc ?? 0))}`}</b></div>
                <div><span>Max per trade</span><b>{compactUsd(vault.maxNotionalUsdc)}</b></div>
              </div>

              <p className="feed-note">
                Parallel matches against this real devnet vault, not a central order book.
                {slot !== null ? ` Read at slot ${slot.toLocaleString()}.` : ""}
              </p>
              <Link href="/vaults" className="liq-link">Inspect every vault →</Link>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
