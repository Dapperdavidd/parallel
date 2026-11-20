"use client";

import { useMemo, useState } from "react";
import { MARKETS, byCode, fmt } from "@/lib/mock";
import { useDemo } from "@/lib/store";
import { useToast } from "@/components/Toast";

/** Dates the outcome table is built around. */
const MOVES = [-10, -5, 0, 5, 10];

function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

export default function HedgePage() {
  const { signedIn, balance, openPosition } = useDemo();
  const toast = useToast();

  const [code, setCode] = useState("NGN");
  const [amount, setAmount] = useState(2_000_000);
  const [date, setDate] = useState(defaultDate);

  const m = byCode(code);
  const usd = amount / m.px;

  const days = useMemo(() => {
    const ms = new Date(date).getTime() - Date.now();
    return Math.max(1, Math.round(ms / 86_400_000));
  }, [date]);

  // Outcome table: what the hedge is worth if the local currency moves.
  const outcomes = MOVES.map((pct) => {
    // A weaker local currency means more units per dollar.
    const newRate = m.px * (1 + pct / 100);
    const localValueOfSavings = amount; // unchanged in local terms
    const dollarsBefore = amount / m.px;
    const dollarsAfter = localValueOfSavings / newRate;
    const lossWithout = dollarsAfter - dollarsBefore;
    // A 1x long USD position of the same dollar size gains what the savings lose.
    const hedgeGain = -lossWithout;
    return { pct, dollarsAfter, lossWithout, hedgeGain, net: lossWithout + hedgeGain };
  });

  const place = (): void => {
    if (!signedIn) {
      window.location.href = "/signin";
      return;
    }
    if (usd > balance) {
      toast("Not enough tUSDC for this hedge");
      return;
    }
    openPosition({ c: m.c, side: "long", size: usd, lev: 1, entry: m.px });
    toast(`Hedge on · long USD/${m.c} 1x for ${fmt(usd)} tUSDC`);
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
            Today worth<b>${fmt(usd)}</b>
          </div>
          <div className="row">
            Holding for<b>{days} days</b>
          </div>
          <div className="row">
            Entry<b>{fmt(m.px, m.dp)}</b>
          </div>
          <button
            type="button"
            className="btn btn-pri"
            style={{ height: 48, marginTop: 4 }}
            onClick={place}
          >
            {signedIn ? "Turn on hedge" : "Sign in / Sign up to hedge"}
          </button>
          <span style={{ fontSize: 12, color: "var(--ink3)", lineHeight: 1.5 }}>
            One tap. You can close it at any time.
          </span>
        </div>
      </div>

      <h2 style={{ fontSize: 20, margin: "32px 0 12px" }}>What happens if the {m.name.split(" ").slice(1).join(" ")} moves</h2>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="postable" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>Move</th>
              <th>Your {m.c} is worth</th>
              <th>Without a hedge</th>
              <th>Hedge pays</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map((o) => (
              <tr key={o.pct}>
                <td>
                  {o.pct > 0 ? "+" : ""}
                  {o.pct}%
                </td>
                <td>${fmt(o.dollarsAfter)}</td>
                <td style={{ color: o.lossWithout < 0 ? "var(--dn)" : "var(--ink2)" }}>
                  {o.lossWithout >= 0 ? "+" : ""}
                  {fmt(o.lossWithout)}
                </td>
                <td style={{ color: o.hedgeGain > 0 ? "var(--up)" : "var(--ink2)" }}>
                  {o.hedgeGain >= 0 ? "+" : ""}
                  {fmt(o.hedgeGain)}
                </td>
                <td style={{ color: "var(--ink)" }}>{fmt(o.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink3)", marginTop: 12, lineHeight: 1.6 }}>
        A negative move means the {m.name.split(" ").slice(1).join(" ")} weakens against the
        dollar. The hedge is sized so the two columns cancel. Devnet test funds only.
      </p>
    </div>
  );
}
