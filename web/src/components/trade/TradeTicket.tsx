"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmt, sourceReadings, TRADING_FEE_BPS } from "@/lib/mock";
import type { MarketView } from "@/lib/live";
import { useDemo } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { usePercolatorTrade, type TradeStage } from "@/lib/usePercolatorTrade";
import { useChainPortfolio } from "@/lib/useChainPortfolio";
import { usePreferences, SLIPPAGE_CHOICES } from "@/lib/preferences";
import { explorerTx, shortSignature } from "@/lib/explorer";

/**
 * The order ticket.
 *
 * Three things were wrong with it, all of the same kind: it was pricing the
 * trade itself. The review screen used the index price from the market board,
 * computed a liquidation estimate in the browser, and said nothing about the
 * gap between the index and the price the engine would actually fill at — a
 * gap currently worth 5% on BRL. So the review could promise one number and
 * the fill deliver another.
 *
 * It now asks the server what the trade would cost (`/api/trade/quote`, which
 * signs nothing) and shows that: the fill price, how far it sits from the
 * index, where liquidation lands, and how much headroom this side of the
 * market has left. The same expected price is sent with the order, so the
 * server can refuse a fill that has drifted past the tolerance below rather
 * than filling it quietly.
 *
 * And it says where a trade has got to. One spinner for the whole flow meant
 * "Waiting for wallet…" stayed on screen while the transaction was already on
 * devnet, and a failure gave no clue which step had failed.
 */

const SIZE_PCTS = [25, 50, 75, 100];
const MAX_MARGIN = 5_000;
const FALLBACK_MAX_NOTIONAL = 5_000;
/** Re-ask for a price this often while the ticket is open. */
const QUOTE_REFRESH_MS = 12_000;

interface Quote {
  entryQuote: number;
  indexQuote: number | null;
  priceImpactBps: number;
  approximateLiquidationQuote: number;
  entryPrice: number;
  notionalUsdc: number;
  sideOpenInterestUsdc: number;
  maxOpenInterestUsdc: number | null;
  maxNotionalUsdc: number | null;
  tradable: boolean;
  blockedBecause: string | null;
  at: string;
}

const STAGE_WORDS: Record<TradeStage, string> = {
  portfolio: "Opening your position account…",
  preparing: "Pricing and preparing…",
  wallet: "Signing…",
  recording: "Confirmed. Filing it…",
  done: "Done",
};

export function TradeTicket({ market }: { market: MarketView }) {
  const { signedIn } = useDemo();
  const toast = useToast();
  const router = useRouter();
  const trading = usePercolatorTrade();
  const { walletBalance, snapshot, reload } = useChainPortfolio();
  const { preferences, set: setPreference } = usePreferences();

  const [side, setSide] = useState<"long" | "short">("long");
  const [size, setSize] = useState(500);
  const [lev, setLev] = useState(2);
  const [reviewing, setReviewing] = useState(false);
  const [settings, setSettings] = useState(false);

  const [stage, setStage] = useState<TradeStage | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [filled, setFilled] = useState<string | null>(null);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);

  const busy = stage !== null && stage !== "done";

  useEffect(() => {
    setLev((value) => Math.min(value, market.lev));
    setReviewing(false);
    setFilled(null);
    setFailure(null);
  }, [market.c, market.lev]);

  const notional = size * lev;
  const maxNotional = market.maxNotionalUsdc ?? FALLBACK_MAX_NOTIONAL;
  const maxMarginForLeverage = Math.min(MAX_MARGIN, maxNotional / lev);
  const fee = notional * (TRADING_FEE_BPS / 10_000);
  const weakens = market.name.split(" ").slice(1).join(" ") || market.name;
  const leverageOptions = useMemo(
    () => [...new Set([1, 2, 3, market.lev].filter((value) => value <= market.lev))],
    [market.lev],
  );

  useEffect(() => {
    setSize((value) => Math.min(value, maxMarginForLeverage));
  }, [maxMarginForLeverage]);

  /**
   * Ask the server what this trade would cost.
   *
   * Debounced, because it fires on every keystroke in the margin box, and
   * cancelled on change so a slow answer cannot overwrite a newer one.
   */
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => {
    if (size < 1 || !market.known) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setQuoting(true);
      void fetch("/api/trade/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketId: `USD/${market.c}`,
          side,
          marginUsdc: size,
          leverage: lev,
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json()) as Quote & { error?: string };
          if (cancelled) return;
          if (!response.ok) {
            setQuote(null);
            setQuoteError(body.error ?? "We could not price that right now");
            return;
          }
          setQuote(body);
          setQuoteError(null);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || cancelled) return;
          setQuote(null);
          setQuoteError(error instanceof Error ? error.message : "We could not price that");
        })
        .finally(() => {
          if (!cancelled) setQuoting(false);
        });
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [market.c, market.known, side, size, lev]);

  // Keep the price current while somebody is deciding.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), QUOTE_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (tick > 0) setSize((value) => value); // re-runs the quote effect
  }, [tick]);

  const validate = useCallback((): boolean => {
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
    if (quote && !quote.tradable) {
      toast(quote.blockedBecause ?? "This market will not take a position right now");
      return false;
    }
    return true;
  }, [signedIn, router, size, notional, maxNotional, fee, walletBalance, quote, toast]);

  const place = useCallback(async (): Promise<void> => {
    if (!validate()) return;
    setFailure(null);
    setFilled(null);
    setStage("preparing");
    try {
      const signature = await trading.open({
        code: market.c,
        side,
        marginUsdc: size,
        leverage: lev,
        // The price the review screen showed, so the server can refuse a fill
        // that has moved past the tolerance set below.
        expectedPriceE6: quote ? Math.round(quote.entryPrice * 1e6) : undefined,
        maxSlippageBps: preferences.maxSlippageBps,
        onStage: setStage,
      });
      setFilled(signature);
      setReviewing(false);
      await reload();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The trade did not go through");
    } finally {
      setStage(null);
    }
  }, [validate, trading, market.c, side, size, lev, quote, preferences.maxSlippageBps, reload]);

  const submit = useCallback((): void => {
    if (!validate()) return;
    // A confirmation nobody can switch off becomes a reflex. The default is
    // on; somebody who trades all day can turn it off in the ticket.
    if (preferences.confirmTrades) setReviewing(true);
    else void place();
  }, [validate, preferences.confirmTrades, place]);

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

  // What the ticket shows for the fill: the server's price when it has one,
  // the index as a clearly-labelled stand-in when it does not.
  const entry = quote?.entryQuote ?? market.px;
  const liquidation = quote?.approximateLiquidationQuote ?? null;
  const liquidationGap =
    liquidation !== null && entry > 0 ? Math.abs((liquidation - entry) / entry) * 100 : null;
  const impact = quote?.priceImpactBps ?? market.basisBps;
  const headroom =
    quote?.maxOpenInterestUsdc && quote.maxOpenInterestUsdc > 0
      ? Math.min(100, (quote.sideOpenInterestUsdc / quote.maxOpenInterestUsdc) * 100)
      : null;

  return (
    <aside className="ticket">
      <div className="order-types" role="tablist" aria-label="Order type">
        <button type="button" className="on" role="tab" aria-selected>
          Market
        </button>
        {/* Disabled, and the reason is on the face of it rather than in a
            tooltip nobody hovers. The engine genuinely cannot rest an order. */}
        <button
          type="button"
          disabled
          role="tab"
          aria-selected={false}
          title="Percolator settles against a vault, not an order book, so there is nothing for a limit order to rest on."
        >
          Limit
          <i className="why">not on devnet</i>
        </button>
        <button
          type="button"
          disabled
          role="tab"
          aria-selected={false}
          title="Trigger orders need a keeper to watch for the trigger and submit for you. Not deployed yet."
        >
          Trigger
          <i className="why">not on devnet</i>
        </button>
      </div>

      <div className="ticket-mode">
        <span>
          <i className="status-dot" /> Isolated margin
        </span>
        <button
          type="button"
          className="ticket-gear"
          aria-label="Order settings"
          aria-expanded={settings}
          onClick={() => setSettings((open) => !open)}
        >
          ⚙
        </button>
      </div>

      {settings && (
        <div className="ticket-settings">
          <label>
            <input
              type="checkbox"
              checked={preferences.confirmTrades}
              onChange={(event) => setPreference("confirmTrades", event.target.checked)}
            />
            <span>
              Review before sending
              <small>Off sends as soon as you press the button.</small>
            </span>
          </label>
          <div>
            <span className="ticket-settings-l">
              Max slippage
              <small>We refuse the fill if the price moves further than this.</small>
            </span>
            <div className="lev-presets">
              {SLIPPAGE_CHOICES.map((bps) => (
                <button
                  key={bps}
                  type="button"
                  className={preferences.maxSlippageBps === bps ? "on" : undefined}
                  onClick={() => setPreference("maxSlippageBps", bps)}
                >
                  {bps / 100}%
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="ls">
        <button
          type="button"
          className={`long${side === "long" ? " on" : ""}`}
          onClick={() => changeSide("long")}
          disabled={busy}
        >
          Long USD
        </button>
        <button
          type="button"
          className={`short${side === "short" ? " on" : ""}`}
          onClick={() => changeSide("short")}
          disabled={busy}
        >
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
        <span>
          Available{" "}
          <b className="mono">{signedIn && snapshot ? fmt(walletBalance) : "—"} tUSDC</b>
        </span>
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
        <span>
          Max <b>{market.lev}x</b> · cap <b>{fmt(maxNotional, 0)}</b>
        </span>
      </div>
      <div className="lev-presets">
        {leverageOptions.map((value) => (
          <button
            key={value}
            type="button"
            className={lev === value ? "on" : undefined}
            disabled={busy}
            onClick={() => changeLeverage(value)}
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
        onChange={(event) => changeLeverage(Number(event.target.value))}
      />

      <div className="ticket-summary">
        <div>
          <span>Position</span>
          <b>{fmt(notional)} tUSDC</b>
        </div>
        <div>
          <span>
            Fill price
            {quoting && <i className="why">pricing…</i>}
            {!quote && !quoting && <i className="why">index</i>}
          </span>
          <b>{fmt(entry, market.dp)}</b>
        </div>
        <div title="How far the engine's fill sits from the street index everything else here is quoted against.">
          <span>Vs index</span>
          <b style={impact === null ? undefined : { color: "var(--ink2)" }}>
            {impact === null ? "—" : `${impact >= 0 ? "+" : ""}${(impact / 100).toFixed(2)}%`}
          </b>
        </div>
        <div title="Approximate: the price at which this position's margin is gone. Before fees and funding, which bring it slightly nearer.">
          <span>Liquidation</span>
          <b>
            {liquidation === null ? "—" : fmt(liquidation, market.dp)}{" "}
            {liquidationGap !== null && <small>{liquidationGap.toFixed(1)}% away</small>}
          </b>
        </div>
        <div>
          <span>Trading fee</span>
          <b>{fmt(fee)} tUSDC</b>
        </div>
      </div>

      {/* How full this side of the market is. Better to see it before
          committing to a size the vault will refuse. */}
      {headroom !== null && (
        <div className="ticket-headroom" title="How much of this side's open-interest cap is already used.">
          <div className="ticket-label">
            <span>{side === "long" ? "Long" : "Short"} side capacity</span>
            <span className="mono">{headroom.toFixed(0)}% used</span>
          </div>
          <span className="headroom-track">
            <span
              className="headroom-fill"
              style={{
                width: `${Math.max(1, headroom)}%`,
                background: headroom > 85 ? "var(--dn)" : headroom > 60 ? "var(--amb)" : "var(--up)",
              }}
            />
          </span>
        </div>
      )}

      {quote && !quote.tradable && quote.blockedBecause && (
        <p className="ticket-blocked" role="status">
          {quote.blockedBecause}
        </p>
      )}
      {quoteError && !quote && (
        <p className="ticket-blocked" role="status">
          {quoteError}
        </p>
      )}

      <div className="execution-note">
        <b>Immediate vault match</b>
        <span>
          The transaction carries the engine&apos;s price and fails rather than resting if it
          cannot execute. Slippage beyond {preferences.maxSlippageBps / 100}% is refused.
        </span>
      </div>

      {/* Where the trade has got to, and what to do if it stopped. */}
      {stage !== null && (
        <p className="tx-stage" role="status" aria-live="polite">
          <i className="tx-spin" aria-hidden /> {STAGE_WORDS[stage]}
        </p>
      )}
      {filled && !busy && (
        <p className="tx-done" role="status">
          Filled.{" "}
          <a href={explorerTx(filled)} target="_blank" rel="noreferrer">
            {shortSignature(filled)} ↗
          </a>
        </p>
      )}
      {failure && !busy && (
        <div className="tx-failed" role="alert">
          <b>That did not go through</b>
          <span>{failure}</span>
          <button type="button" onClick={() => void place()}>
            Try again
          </button>
        </div>
      )}

      {reviewing && (
        <div className="order-review" role="status">
          <div>
            <span>Review order</span>
            <b style={{ color: side === "long" ? "var(--up)" : "var(--dn)" }}>
              {side === "long" ? "Long" : "Short"} USD/{market.c}
            </b>
          </div>
          <p>
            {fmt(size)} tUSDC margin · {lev}x · {fmt(notional)} tUSDC position
            <br />
            Fill near <b className="mono">{fmt(entry, market.dp)}</b>
            {liquidation !== null && (
              <>
                {" "}
                · liquidation <b className="mono">{fmt(liquidation, market.dp)}</b>
              </>
            )}
          </p>
          <div className="review-actions">
            <button type="button" onClick={() => setReviewing(false)} disabled={busy}>
              Back
            </button>
            <button type="button" className={side} onClick={() => void place()} disabled={busy}>
              {busy ? STAGE_WORDS[stage ?? "preparing"] : "Send it"}
            </button>
          </div>
        </div>
      )}

      {!reviewing && (
        <button
          type="button"
          className="btn order-submit"
          onClick={submit}
          disabled={busy || (quote ? !quote.tradable : market.paused)}
          style={{
            background: side === "long" ? "var(--up)" : "var(--dn)",
            color: side === "long" ? "#06150E" : "#fff",
          }}
        >
          {!signedIn
            ? "Sign in / Sign up to trade"
            : busy
              ? STAGE_WORDS[stage ?? "preparing"]
              : market.paused
                ? "Market paused"
                : preferences.confirmTrades
                  ? `Review ${side}`
                  : `${side === "long" ? "Long" : "Short"} USD/${market.c}`}
        </button>
      )}

      <details className="source-details">
        <summary>
          Price sources · {market.sourceCount > 0 ? `${market.sourceCount} in the median` : "median"}
        </summary>
        <div>
          {sourceReadings(market).map((source) => (
            <div className="row" key={source.name}>
              <span>
                <i
                  className="dot"
                  style={{ background: source.inMedian ? "var(--up)" : "var(--ink3)" }}
                />
                {source.name}
              </span>
              <b>{fmt(source.rate, market.dp)}</b>
            </div>
          ))}
        </div>
      </details>
    </aside>
  );
}
