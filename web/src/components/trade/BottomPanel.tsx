"use client";

import { useState } from "react";
import { agoLabel, byCode, fmt, recentTrades, type Market } from "@/lib/mock";
import { useDemo } from "@/lib/store";
import { PositionsTable } from "./PositionsTable";

const TABS = ["Positions", "Balances", "Trade history", "Funding"] as const;
type Tab = (typeof TABS)[number];

export function BottomPanel({ market }: { market: Market }) {
  const [tab, setTab] = useState<Tab>("Positions");
  const { signedIn, balance, positions } = useDemo();

  return (
    <div className="bpanel">
      <div className="bpanel-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === tab}
            className={t === tab ? "on" : undefined}
            onClick={() => setTab(t)}
          >
            {t}
            {t === "Positions" && positions.length > 0 ? ` (${positions.length})` : ""}
          </button>
        ))}
      </div>

      <div className="bpanel-body">
        {tab === "Positions" && <PositionsTable />}

        {tab === "Balances" && (
          <table className="postable">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Available</th>
                <th>In positions</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>tUSDC</td>
                <td>{signedIn ? fmt(balance) : "—"}</td>
                <td>{signedIn ? fmt(positions.reduce((a, p) => a + p.size, 0)) : "—"}</td>
                <td>
                  {signedIn
                    ? fmt(balance + positions.reduce((a, p) => a + p.size, 0))
                    : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {tab === "Trade history" &&
          (signedIn && positions.length > 0 ? (
            <table className="postable">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Size</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const m = byCode(p.c);
                  return (
                    <tr key={p.id}>
                      <td>{new Date(p.id).toLocaleTimeString("en-GB")}</td>
                      <td>USD/{p.c}</td>
                      <td style={{ color: p.side === "long" ? "var(--up)" : "var(--dn)" }}>
                        {p.side === "long" ? "Long" : "Short"}
                      </td>
                      <td>{fmt(p.size * p.lev)}</td>
                      <td>{fmt(p.entry, m.dp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="bpanel-empty">
              {signedIn ? "No trades yet." : "Sign in to see your trade history."}
            </p>
          ))}

        {tab === "Funding" && (
          <table className="postable">
            <thead>
              <tr>
                <th>Time</th>
                <th>Market</th>
                <th>Rate</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades(market, 6).map((f, i) => (
                <tr key={f.id}>
                  <td>{agoLabel(f.ago * 120)} ago</td>
                  <td>USD/{market.c}</td>
                  <td style={{ color: i % 2 ? "var(--dn)" : "var(--up)" }}>
                    {i % 2 ? "-" : "+"}0.00{(i + 1) * 3}%
                  </td>
                  <td>{signedIn && positions.length > 0 ? fmt((i + 1) * 0.11) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
