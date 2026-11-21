"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  fmt,
  liquidationPrice,
  sourceReadings,
  TRADING_FEE_BPS,
  type Market,
} from "@/lib/mock";
import { useDemo } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { usePercolatorTrade } from "@/lib/usePercolatorTrade";

const PRESETS = [100, 500, 1000, 2500];

export function TradeTicket({ market }: { market: Market }) {
  const { signedIn, balance, openPosition } = useDemo();
  const toast = useToast();
  const router = useRouter();
  const trading = usePercolatorTrade();

  const [side, setSide] = useState<"long" | "short">("long");
  const [size, setSize] = useState(500);
  const [lev, setLev] = useState(2);
  const [busy, setBusy] = useState(false);

  // Leverage is capped per market and the cap is fixed on-chain at creation,
  // so clamp rather than silently allowing an impossible position.
  useEffect(() => {
    setLev((l) => Math.min(l, market.lev));
  }, [market.lev]);

  const notional = size * lev;
  const fee = notional * (TRADING_FEE_BPS / 10_000);
  const liq = liquidationPrice(market, side, lev);
  const weakens = market.name.split(" ").slice(1).join(" ") || market.name;

  const place = async (): Promise<void> => {
    if (!signedIn) {
      router.push("/signin");
      return;
    }
    if (size < 10) {
      toast("Minimum size is 10 tUSDC");
      return;
    }
    if (size + fee > balance) {
      toast("Not enough tUSDC");
      return;
    }
    setBusy(true);
    try {
      const signature = await trading.open({ code: market.c, side, marginUsdc: size, leverage: lev });
      openPosition({ c: market.c, side, size, lev, entry: market.px });
      toast(`${side === "long" ? "Long" : "Short"} USD/${market.c} ${lev}x opened · ${signature.slice(0, 8)}…`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Trade failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="ticket">
      <div className="ls">
        <button
          type="button"
          className={`long${side === "long" ? " on" : ""}`}
          onClick={() => setSide("long")}
        >
          Long USD
        </button>
        <button
          type="button"
          className={`short${side === "short" ? " on" : ""}`}
          onClick={() => setSide("short")}
        >
          Short USD
        </button>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "var(--ink3)", lineHeight: 1.5 }}>
        {side === "long"
          ? `Long USD wins if the ${weakens} gets weaker.`
          : `Short USD wins if the ${weakens} gets stronger.`}
      </p>

      <label htmlFor="sz">Size (tUSDC)</label>
      <input
        className="inp mono"
        id="sz"
        type="number"
        min={10}
        step={10}
        value={size}
        onChange={(e) => setSize(Math.max(0, Number(e.target.value) || 0))}
      />

      <div style={{ display: "flex", gap: 6 }}>
        {PRESETS.map((v) => (
          <button
            key={v}
            type="button"
            className="btn btn-ghost"
            style={{ height: 30, padding: "0 10px", fontSize: 12, flex: 1 }}
            onClick={() => setSize(v)}
          >
            {v}
          </button>
        ))}
      </div>

      <label htmlFor="lv">
        Leverage · <span>{lev}x</span>{" "}
        <span style={{ color: "var(--ink3)" }}>(max {market.lev}x)</span>
      </label>
      <input
        id="lv"
        type="range"
        min={1}
        max={market.lev}
        step={1}
        value={lev}
        onChange={(e) => setLev(Number(e.target.value))}
      />

      <div className="row">
        Position<b>{fmt(notional)} tUSDC</b>
      </div>
      <div className="row">
        Entry<b>{fmt(market.px, market.dp)}</b>
      </div>
      <div className="row">
        Liquidation<b>{fmt(liq, market.dp)}</b>
      </div>
      <div className="row">
        Fee (0.06%)<b>{fmt(fee)} tUSDC</b>
      </div>

      <button
        type="button"
        className="btn"
        onClick={() => void place()}
        disabled={busy}
        style={{
          height: 52,
          marginTop: 6,
          background: side === "long" ? "var(--up)" : "var(--dn)",
          color: side === "long" ? "#06150E" : "#fff",
        }}
      >
        {busy ? "Waiting for wallet…" : signedIn ? (side === "long" ? "Open long" : "Open short") : "Sign in / Sign up to trade"}
      </button>

      <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--ink3)" }}>Price sources · median</span>
        {sourceReadings(market).map((s) => (
          <div className="row" style={{ fontSize: 12 }} key={s.name}>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span className="dot" style={{ background: s.inMedian ? "var(--up)" : "var(--ink3)" }} />
              {s.name}
            </span>
            <b>{fmt(s.rate, market.dp)}</b>
          </div>
        ))}
      </div>
    </aside>
  );
}
