"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MARKETS, fmt } from "@/lib/mock";
import { useMarket } from "@/lib/live";
import { useDemo } from "@/lib/store";
import { useChainPortfolio } from "@/lib/useChainPortfolio";
import { usePercolatorTrade } from "@/lib/usePercolatorTrade";
import { useToast } from "@/components/Toast";
import { explorerTx } from "@/lib/explorer";

/**
 * F9 — hedge mode.
 *
 * The screen a person who is not a trader can use: say what you hold and when
 * you need it, and get one 1x position that cancels out a fall in your
 * currency. It opens through the same guarded route as the trade ticket — no
 * separate path, no local-only position — and files the amount and the due
 * date against the signature so the hedge can be recognised later.
 */

/** Moves the outcome table is built around, as percentages of the local currency. */
const MOVES = [-10, -5, 0, 5, 10];

interface StoredHedge {
  wallet: string;
  marketId: string;
  amountLocal: number;
  amountUsd: number;
  dueDate: string;
  txSignature: string;
  createdAt: string;
}

function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

const daysUntil = (date: string): number =>
  Math.max(0, Math.round((new Date(`${date}T00:00:00Z`).getTime() - Date.now()) / 86_400_000));

export default function HedgePage() {
  const { signedIn, signIn, walletAddress } = useDemo();
  const { hedge } = usePercolatorTrade();
  const toast = useToast();

  const [code, setCode] = useState("NGN");
  const [amount, setAmount] = useState(2_000_000);
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [hedges, setHedges] = useState<StoredHedge[]>([]);
  // The wallet balance comes from the shared chain snapshot, so opening a
  // hedge here updates the app bar and the portfolio with it.
  const { walletBalance, reload } = useChainPortfolio();

  const m = useMarket(code);
  const { positions } = useChainPortfolio();
  const { close } = usePercolatorTrade();
  const [closing, setClosing] = useState("");

  /**
   * What is already protected on this currency.
   *
   * The page used to suggest the full amount every time, ignoring hedges the
   * person already holds — so hedging the same savings twice quietly left
   * them double-covered, which is a position, not protection. Existing
   * hedges on this market are summed and the suggestion is the **gap**.
   */
  const existing = useMemo(
    () => hedges.filter((h) => h.marketId === `USD/${code}`),
    [hedges, code],
  );
  const alreadyLocal = existing.reduce((total, h) => total + h.amountLocal, 0);
  const alreadyUsd = existing.reduce((total, h) => total + h.amountUsd, 0);

  const [coverGapOnly, setCoverGapOnly] = useState(true);
  const uncoveredLocal = Math.max(0, amount - alreadyLocal);
  const sizingLocal = coverGapOnly ? uncoveredLocal : amount;

  const usd = m.px > 0 ? sizingLocal / m.px : 0;
  const coveragePct = amount > 0 ? Math.min(100, (alreadyLocal / amount) * 100) : 0;
  const days = useMemo(() => daysUntil(date), [date]);

  /** Hedges that need attention: due soon, or past their date. */
  const attention = useMemo(
    () =>
      hedges
        .map((h) => ({ ...h, days: daysUntil(h.dueDate) }))
        .filter((h) => h.days <= 7)
        .sort((a, b) => a.days - b.days),
    [hedges],
  );

  const load = useCallback(async (): Promise<void> => {
    if (!walletAddress) return;
    const mine = await fetch(`/api/hedge?wallet=${encodeURIComponent(walletAddress)}`, {
      cache: "no-store",
    });
    if (mine.ok) setHedges(((await mine.json()) as { hedges: StoredHedge[] }).hedges);
    await reload();
  }, [walletAddress, reload]);

  useEffect(() => {
    if (!signedIn || !walletAddress) return;
    void load().catch(() => undefined);
  }, [signedIn, walletAddress, load]);

  /**
   * Outcome table.
   *
   * `pct` is what the LOCAL CURRENCY does, which is how a person thinks about
   * it: −10% means the naira loses a tenth of its value. That is the case you
   * hedge against. (Quoting it as a move in the NGN-per-USD rate inverts the
   * sign and reads backwards to everyone who is not a trader.)
   */
  // The table models the whole holding, because that is what the person is
  // asking about — not only the slice this new position would cover.
  const dollarsBefore = m.px > 0 ? amount / m.px : 0;
  const hedgedShare = amount > 0 ? Math.min(1, (alreadyLocal + sizingLocal) / amount) : 0;
  const outcomes = MOVES.map((pct) => {
    const dollarsAfter = dollarsBefore * (1 + pct / 100);
    const lossWithout = dollarsAfter - dollarsBefore;
    // A 1x long USD position gains what the savings lose, in proportion to
    // how much of the holding it covers. Showing a perfect offset for a
    // partial hedge would be the central lie this page could tell.
    const hedgeGain = -lossWithout * hedgedShare;
    // Keep -0 out of the display.
    const z = (v: number): number => (Object.is(v, -0) || Math.abs(v) < 0.005 ? 0 : v);
    return {
      pct,
      dollarsAfter,
      lossWithout: z(lossWithout),
      hedgeGain: z(hedgeGain),
      net: z(lossWithout + hedgeGain),
    };
  });

  const weakens = m.name.split(" ").slice(1).join(" ") || m.name;
  const blocked =
    !m.known
      ? "Pick a currency we have a market for"
      : !m.live
      ? "This market has no live price right now"
      : m.paused
        ? (m.reason ?? "This market is paused")
        : usd <= 0
          ? alreadyLocal >= amount && amount > 0
            ? "This amount is already fully hedged"
            : "Enter the amount you hold"
          : walletBalance !== null && usd > walletBalance
            ? `Not enough tUSDC — you have ${fmt(walletBalance)}`
            : "";

  const place = (): void => {
    if (!signedIn) {
      signIn();
      return;
    }
    if (blocked) {
      toast(blocked);
      return;
    }
    setBusy(true);
    void hedge({ code: m.c, amountLocal: sizingLocal, marginUsdc: usd, dueDate: date })
      .then(async ({ signature, recorded }) => {
        toast(
          recorded
            ? `Hedge on · long USD/${m.c} 1x · ${signature.slice(0, 8)}…`
            : `Position opened · ${signature.slice(0, 8)}… but the hedge note was not saved`,
        );
        await load();
      })
      .catch((error: unknown) => toast(error instanceof Error ? error.message : "The hedge failed"))
      .finally(() => setBusy(false));
  };

  /**
   * Close the position behind a hedge, from the page that opened it.
   *
   * "Close one from your portfolio at any time" was true and unhelpful: the
   * person reading this screen is the one who wants to stop hedging, and
   * sending them somewhere else to do it is the sort of small friction that
   * leaves a position open.
   */
  const closeHedge = (marketId: string): void => {
    const currency = marketId.split("/")[1] ?? "";
    const held = positions.find((p) => p.portfolio.marketId === marketId);
    if (!held) {
      toast("There is no open position on that market — it may already be closed.");
      return;
    }
    setClosing(marketId);
    void close({ code: currency, portfolio: held.portfolio.address })
      .then(async (signature) => {
        toast(`Hedge closed · ${signature.slice(0, 8)}…`);
        await load();
      })
      .catch((error: unknown) =>
        toast(error instanceof Error ? error.message : "The close failed"),
      )
      .finally(() => setClosing(""));
  };

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <span style={{ fontSize: 12, letterSpacing: ".1em", color: "var(--amb)" }}>HEDGE MODE</span>
      <h1 style={{ fontSize: 36, letterSpacing: "-.035em", margin: "10px 0 8px" }}>
        Protect what your money is worth.
      </h1>
      <p style={{ margin: "0 0 24px", color: "var(--ink2)", fontSize: 16, lineHeight: 1.6 }}>
        Tell us what you hold and when you need it. We suggest one position that cancels out a
        fall in your currency. No forms, no bank.
      </p>

      {/* Monitoring, such as it can be without sending anybody an email: a
          hedge has a date it was needed by, and nothing used to say when that
          date arrived. */}
      {attention.length > 0 && (
        <div className="hedge-due" role="status">
          <b>
            {attention.length === 1 ? "A hedge needs" : `${attention.length} hedges need`} your
            attention
          </b>
          <ul>
            {attention.map((h) => (
              <li key={h.txSignature}>
                {h.marketId} · {fmt(h.amountUsd)} tUSDC ·{" "}
                {h.days === 0 ? (
                  <b>due today</b>
                ) : (
                  <>
                    due in <b>{h.days} {h.days === 1 ? "day" : "days"}</b>
                  </>
                )}
                <button
                  type="button"
                  className="closebtn"
                  disabled={closing !== ""}
                  onClick={() => closeHedge(h.marketId)}
                >
                  {closing === h.marketId ? "Closing…" : "Close it"}
                </button>
              </li>
            ))}
          </ul>
          <span>
            A hedge does not expire by itself. Closing it returns the margin and ends the
            protection.
          </span>
        </div>
      )}

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label htmlFor="hc">Currency you hold</label>
            <select
              id="hc"
              className="inp"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ marginTop: 6 }}
            >
              {MARKETS.map((x) => (
                <option key={x.c} value={x.c}>
                  {x.name} ({x.c})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ha">Amount ({m.sym})</label>
            <input
              id="ha"
              className="inp mono"
              type="number"
              min={0}
              step={1000}
              value={amount}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
              style={{ marginTop: 6 }}
            />
          </div>

          <div>
            <label htmlFor="hd">You need it by</label>
            <input
              id="hd"
              className="inp"
              type="date"
              value={date}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
              style={{ marginTop: 6 }}
            />
          </div>
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--ink3)", letterSpacing: ".08em" }}>
            SUGGESTED POSITION
          </span>
          <div className="row">
            Position<b>Long USD/{m.c} at 1x</b>
          </div>
          <div className="row">
            Size<b>{fmt(usd)} tUSDC</b>
          </div>
          <div className="row">
            You hold<b>{m.sym}{fmt(amount, 0)}</b>
          </div>
          {alreadyLocal > 0 && (
            <>
              <div className="row">
                Already hedged
                <b>
                  {m.sym}
                  {fmt(alreadyLocal, 0)}{" "}
                  <small style={{ color: "var(--ink3)" }}>{coveragePct.toFixed(0)}%</small>
                </b>
              </div>
              <div className="hedge-cover" aria-hidden>
                <span style={{ width: `${Math.max(2, coveragePct)}%` }} />
              </div>
              <label className="hedge-gap">
                <input
                  type="checkbox"
                  checked={coverGapOnly}
                  onChange={(event) => setCoverGapOnly(event.target.checked)}
                />
                <span>
                  Only cover what is not hedged yet
                  <small>
                    {coverGapOnly
                      ? `Sizing for the ${m.sym}${fmt(uncoveredLocal, 0)} still exposed.`
                      : `Sizing for the full ${m.sym}${fmt(amount, 0)}, on top of ${fmt(alreadyUsd)} tUSDC already open.`}
                  </small>
                </span>
              </label>
            </>
          )}
          <div className="row">
            Holding for<b>{days} days</b>
          </div>
          <div className="row">
            Rate<b>{fmt(m.px, m.dp)}{m.live ? "" : " (last known)"}</b>
          </div>
          <button
            type="button"
            className="btn btn-pri"
            style={{ height: 48, marginTop: 4 }}
            onClick={place}
            disabled={busy || (signedIn && blocked !== "")}
          >
            {!signedIn
              ? "Sign in / Sign up to hedge"
              : busy
                ? "Opening on devnet…"
                : "Turn on hedge"}
          </button>
          <span style={{ fontSize: 12, color: "var(--ink3)", lineHeight: 1.5 }}>
            {signedIn && blocked ? blocked : "One tap. You can close it at any time."}
          </span>
        </div>
      </div>

      {hedges.length > 0 && (
        <>
          <h2 style={{ fontSize: 20, margin: "32px 0 12px" }}>Your hedges</h2>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="postable" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Protecting</th>
                  <th>Position</th>
                  <th>Needed by</th>
                  <th>Transaction</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {hedges.map((h) => (
                  <tr key={h.txSignature}>
                    <td>{h.marketId}</td>
                    <td className="mono">{fmt(h.amountLocal, 0)}</td>
                    <td className="mono">{fmt(h.amountUsd)} tUSDC</td>
                    <td>
                      {h.dueDate}
                      <span style={{ color: "var(--ink3)" }}> · {daysUntil(h.dueDate)}d</span>
                    </td>
                    <td className="mono">
                      <a
                        href={explorerTx(h.txSignature)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--ink2)" }}
                      >
                        {h.txSignature.slice(0, 8)}…
                      </a>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="closebtn"
                        disabled={closing !== ""}
                        onClick={() => closeHedge(h.marketId)}
                      >
                        {closing === h.marketId ? "Closing…" : "Close"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 13, color: "var(--ink3)", marginTop: 10 }}>
            Each row is a confirmed devnet position. Closing one here ends the protection and
            returns its margin.
          </p>
        </>
      )}

      <h2 style={{ fontSize: 20, margin: "32px 0 12px" }}>What happens if the {weakens} moves</h2>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="postable" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>{m.c} moves</th>
              <th>Your {m.c} is worth</th>
              <th>Without a hedge</th>
              <th>Hedge pays</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map((o) => (
              <tr key={o.pct}>
                <td style={{ color: o.pct < 0 ? "var(--dn)" : o.pct > 0 ? "var(--up)" : undefined }}>
                  {o.pct > 0 ? "+" : ""}
                  {o.pct}%
                </td>
                <td>${fmt(o.dollarsAfter)}</td>
                <td style={{ color: o.lossWithout < 0 ? "var(--dn)" : "var(--ink2)" }}>
                  {o.lossWithout > 0 ? "+" : ""}
                  {fmt(o.lossWithout)}
                </td>
                <td style={{ color: o.hedgeGain > 0 ? "var(--up)" : "var(--ink2)" }}>
                  {o.hedgeGain > 0 ? "+" : ""}
                  {fmt(o.hedgeGain)}
                </td>
                <td style={{ color: "var(--ink)" }}>{fmt(o.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink3)", marginTop: 12, lineHeight: 1.6 }}>
        A negative move means the {weakens} loses value against the dollar — the case you are
        protecting against.{" "}
        {hedgedShare >= 0.999
          ? "The hedge is sized so the two columns cancel out."
          : `This covers ${(hedgedShare * 100).toFixed(0)}% of what you hold, so the columns offset by that much and no more.`}
      </p>

      {/* The assumptions, where somebody deciding can see them. A table of
          outcomes with no stated assumptions is a promise. */}
      <details className="hedge-assumptions">
        <summary>What this table assumes</summary>
        <ul>
          <li>
            <b>The street rate, not a bank rate.</b> The price is Parallel&apos;s own index — the
            median of the exchanges and peer-to-peer desks people actually transact at. Your bank
            will quote something else, and the gap between them is currently{" "}
            {m.off > 0 ? `${(((m.px / m.off) - 1) * 100).toFixed(1)}%` : "unknown"}.
          </li>
          <li>
            <b>The position is marked against the engine, not the index.</b> The two sit close
            together because the keeper pushes on a 0.1% move or every ten minutes, but they are
            not identical, and a fill lands at the engine&apos;s price.
          </li>
          <li>
            <b>A move happens and stays.</b> The table is the value at a single moment, not a
            path. A currency that falls and recovers before your date leaves you roughly where
            you started, minus costs.
          </li>
          <li>
            <b>Costs are not in it.</b> No trading fee on devnet, and this deployment accrues no
            funding — but a real venue would charge both, and both come out of the net column.
          </li>
          <li>
            <b>Nothing here is money.</b> Devnet test tokens, no cash value.
          </li>
        </ul>
      </details>
    </div>
  );
}
