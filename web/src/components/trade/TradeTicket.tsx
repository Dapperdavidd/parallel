"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
import { useChainPortfolio } from "@/lib/useChainPortfolio";

const SIZE_PCTS = [25, 50, 75, 100];
const MAX_MARGIN = 5_000;
const FALLBACK_MAX_NOTIONAL = 5_000;

export function TradeTicket({ market }: { market: Market }) {
  const { signedIn } = useDemo();
  const toast = useToast();
  const router = useRouter();
  const trading = usePercolatorTrade();
  const { walletBalance, snapshot, reload } = useChainPortfolio();

  const [side, setSide] = useState<"long" | "short">("long");
  const [size, setSize] = useState(500);
  const [lev, setLev] = useState(2);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    setLev((value) => Math.min(value, market.lev));
    setReviewing(false);
  }, [market.c, market.lev]);

  const notional = size * lev;
  const maxNotional = market.maxNotionalUsdc ?? FALLBACK_MAX_NOTIONAL;
  const maxMarginForLeverage = Math.min(MAX_MARGIN, maxNotional / lev);
  const fee = notional * (TRADING_FEE_BPS / 10_000);
  const liq = liquidationPrice(market, side, lev);
  const liqDistance = Math.abs((liq - market.px) / market.px) * 100;
  const weakens = market.name.split(" ").slice(1).join(" ") || market.name;
  const leverageOptions = useMemo(
    () => [...new Set([1, 2, 3, market.lev].filter((value) => value <= market.lev))],
    [market.lev],
  );

  useEffect(() => {
    setSize((value) => Math.min(value, maxMarginForLeverage));
  }, [maxMarginForLeverage]);

  const validate = (): boolean => {
    if (!signedIn) {
      router.push("/signin");
      return false;
    }
    if (size < 10) {
      toast("Minimum margin is 10 tUSDC");
      return false;
    }
    if (size > MAX_MARGIN) {
      toast(`Maximum margin is ${fmt(MAX_MARGIN, 0)} tUSDC`);
      return false;
    }
    if (notional > maxNotional) {
      toast(`Maximum position for this market is ${fmt(maxNotional)} tUSDC`);
      return false;
    }
    if (size + fee > walletBalance) {
      toast(`Not enough tUSDC — you have ${fmt(walletBalance)}`);
      return false;
    }
    return true;
  };

  const review = (): void => {
    if (validate()) setReviewing(true);
  };

  const place = async (): Promise<void> => {
    if (!validate()) return;
    setBusy(true);
    try {
      const signature = await trading.open({ code: market.c, side, marginUsdc: size, leverage: lev });
      toast(`${side === "long" ? "Long" : "Short"} USD/${market.c} ${lev}x opened · ${signature.slice(0, 8)}…`);
      setReviewing(false);
      await reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Trade failed");
    } finally {
      setBusy(false);
    }
  };

  const setPercent = (pct: number): void => {
    const feeRate = (TRADING_FEE_BPS / 10_000) * lev;
    const spendable = walletBalance / (1 + feeRate);
    const next = Math.min(maxMarginForLeverage, spendable * (pct / 100));
    setSize(Math.max(0, Math.floor(next * 100) / 100));
    setReviewing(false);
  };

  const changeSide = (next: "long" | "short"): void => {
    setSide(next);
    setReviewing(false);
  };

  const changeLeverage = (next: number): void => {
    setLev(next);
    setSize((value) => Math.min(value, Math.min(MAX_MARGIN, maxNotional / next)));
    setReviewing(false);
  };

  return (
    <aside className="ticket">
      <div className="order-types" role="tablist" aria-label="Order type">
        <button type="button" className="on" role="tab" aria-selected>Market</button>
        <button type="button" disabled title="Resting limit orders are not supported by the deployed devnet program">Limit</button>
        <button type="button" disabled title="Trigger orders are not supported by the deployed devnet program">Trigger</button>
      </div>

      <div className="ticket-mode">
        <span><i className="status-dot" /> Isolated margin</span>
        <b>Devnet</b>
      </div>

      <div className="ls">
        <button type="button" className={`long${side === "long" ? " on" : ""}`} onClick={() => changeSide("long")}>
          Long USD
        </button>
        <button type="button" className={`short${side === "short" ? " on" : ""}`} onClick={() => changeSide("short")}>
          Short USD
        </button>
      </div>

      <p className="ticket-thesis">
        {side === "long"
          ? `Profit if the ${weakens} weakens against USD.`
          : `Profit if the ${weakens} strengthens against USD.`}
      </p>

      <div className="ticket-label">
        <label htmlFor="sz">Margin</label>
        <span>Available <b className="mono">{signedIn && snapshot ? fmt(walletBalance) : "—"} tUSDC</b></span>
      </div>
      <div className="amount-input">
        <input
          className="inp mono"
          id="sz"
          type="number"
          min={10}
          max={maxMarginForLeverage}
          step={10}
          value={size}
          disabled={busy}
          onChange={(event) => {
            setSize(Math.min(maxMarginForLeverage, Math.max(0, Number(event.target.value) || 0)));
            setReviewing(false);
          }}
        />
        <span>tUSDC</span>
      </div>

      <div className="ticket-presets">
        {SIZE_PCTS.map((pct) => (
          <button key={pct} type="button" onClick={() => setPercent(pct)} disabled={!signedIn || busy}>
            {pct === 100 ? "Max" : `${pct}%`}
          </button>
        ))}
      </div>

      <div className="ticket-label">
        <label htmlFor="lv">Leverage</label>
        <span>Max <b>{market.lev}x</b> · cap <b>{fmt(maxNotional, 0)}</b></span>
      </div>
      <div className="lev-presets">
        {leverageOptions.map((value) => (
          <button
            key={value}
            type="button"
            className={lev === value ? "on" : undefined}
            onClick={() => {
              changeLeverage(value);
            }}
          >
            {value}x
          </button>
        ))}
      </div>
      <input
        id="lv"
        type="range"
        min={1}
        max={market.lev}
        step={1}
        value={lev}
        disabled={busy}
        onChange={(event) => {
          changeLeverage(Number(event.target.value));
        }}
      />

      <div className="ticket-summary">
        <div><span>Position</span><b>{fmt(notional)} tUSDC</b></div>
        <div><span>Entry mark</span><b>{fmt(market.px, market.dp)}</b></div>
        <div><span>Liquidation</span><b>{fmt(liq, market.dp)} <small>{liqDistance.toFixed(1)}% away</small></b></div>
        <div><span>Trading fee</span><b>{fmt(fee)} tUSDC</b></div>
      </div>

      <div className="execution-note">
        <b>Immediate vault match</b>
        <span>The transaction uses the current engine mark and fails instead of resting if it cannot execute.</span>
      </div>

      {reviewing && (
        <div className="order-review" role="status">
          <div>
            <span>Review order</span>
            <b style={{ color: side === "long" ? "var(--up)" : "var(--dn)" }}>
              {side === "long" ? "Long" : "Short"} USD/{market.c}
            </b>
          </div>
          <p>{fmt(size)} tUSDC margin · {lev}x · {fmt(notional)} tUSDC position</p>
          <div className="review-actions">
            <button type="button" onClick={() => setReviewing(false)} disabled={busy}>Back</button>
            <button type="button" className={side} onClick={() => void place()} disabled={busy}>
              {busy ? "Waiting for wallet…" : "Confirm in wallet"}
            </button>
          </div>
        </div>
      )}

      {!reviewing && (
        <button
          type="button"
          className="btn order-submit"
          onClick={review}
          disabled={busy}
          style={{ background: side === "long" ? "var(--up)" : "var(--dn)", color: side === "long" ? "#06150E" : "#fff" }}
        >
          {signedIn ? `Review ${side}` : "Sign in / Sign up to trade"}
        </button>
      )}

      <details className="source-details">
        <summary>Price sources · median</summary>
        <div>
          {sourceReadings(market).map((source) => (
            <div className="row" key={source.name}>
              <span><i className="dot" style={{ background: source.inMedian ? "var(--up)" : "var(--ink3)" }} />{source.name}</span>
              <b>{fmt(source.rate, market.dp)}</b>
            </div>
          ))}
        </div>
      </details>
    </aside>
  );
}
