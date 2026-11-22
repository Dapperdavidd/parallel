"use client";

import { useEffect, useState } from "react";
import { useWallets } from "@privy-io/react-auth/solana";
import { agoLabel, fmt, recentTrades, type Market } from "@/lib/mock";
import { useDemo } from "@/lib/store";
import { PositionsTable } from "./PositionsTable";

const TABS = ["Positions", "Balances", "Trade history", "Funding"] as const;
type Tab = (typeof TABS)[number];

interface StoredTrade {
  marketId: string;
  side: "long" | "short";
  action: "open" | "close" | "liquidation";
  sizeUsdc: number;
  leverage: number;
  price: number;
  txSignature: string;
  ts: string;
}

export function BottomPanel({ market }: { market: Market }) {
  const [tab, setTab] = useState<Tab>("Positions");
  const { signedIn, balance, positions } = useDemo();
  const { wallets } = useWallets();
  const [storedTrades, setStoredTrades] = useState<StoredTrade[]>([]);
  const wallet = wallets[0]?.address;

  useEffect(() => {
    if (!signedIn || !wallet || tab !== "Trade history") return;
    void fetch(`/api/trades?wallet=${encodeURIComponent(wallet)}&limit=40`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { trades?: StoredTrade[] }) => setStoredTrades(body.trades ?? []))
      .catch(() => setStoredTrades([]));
  }, [signedIn, wallet, tab]);

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
          (signedIn && storedTrades.length > 0 ? (
            <table className="postable">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Action</th>
                  <th>Size</th>
                  <th>Price</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {storedTrades.map((trade) => {
                  const localQuote = trade.price > 0 ? market.unitSize / trade.price : 0;
                  return (
                    <tr key={trade.txSignature}>
                      <td>{new Date(trade.ts).toLocaleTimeString("en-GB")}</td>
                      <td>{trade.marketId}</td>
                      <td style={{ color: trade.side === "long" ? "var(--up)" : "var(--dn)" }}>
                        {trade.side === "long" ? "Long" : "Short"}
                      </td>
                      <td style={{ textTransform: "capitalize" }}>{trade.action}</td>
                      <td>{fmt(trade.sizeUsdc)}</td>
                      <td>{trade.marketId === `USD/${market.c}` ? fmt(localQuote, market.dp) : fmt(trade.price, 6)}</td>
                      <td className="mono" title={trade.txSignature}>{trade.txSignature.slice(0, 8)}…</td>
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
