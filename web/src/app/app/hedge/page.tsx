"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MARKETS, fmt } from "@/lib/mock";
import { useMarket } from "@/lib/live";
import { useDemo } from "@/lib/store";
import { useChainPortfolio } from "@/lib/useChainPortfolio";
import { usePercolatorTrade } from "@/lib/usePercolatorTrade";
import { useToast } from "@/components/Toast";

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
  const { walletBalance, snapshot, reload } = useChainPortfolio();

  const m = useMarket(code);
  const usd = m.px > 0 ? amount / m.px : 0;
  const days = useMemo(() => daysUntil(date), [date]);

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
  const dollarsBefore = usd;
  const outcomes = MOVES.map((pct) => {
    const dollarsAfter = dollarsBefore * (1 + pct / 100);
    const lossWithout = dollarsAfter - dollarsBefore;
    // A 1x long USD position the same dollar size gains what the savings lose.
    const hedgeGain = -lossWithout;
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
    !m.live
      ? "This market has no live price right now"
      : m.paused
        ? (m.reason ?? "This market is paused")
        : usd <= 0
          ? "Enter the amount you hold"
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
    void hedge({ code: m.c, amountLocal: amount, marginUsdc: usd, dueDate: date })
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
                        href={`https://explorer.solana.com/tx/${h.txSignature}?cluster=devnet`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--ink2)" }}
                      >
                        {h.txSignature.slice(0, 8)}…
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 13, color: "var(--ink3)", marginTop: 10 }}>
            Each row is a confirmed devnet position. Close one from your portfolio at any time.
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
        protecting against. The hedge is sized so the two columns cancel out. Devnet test funds
        only.
      </p>
    </div>
  );
}
