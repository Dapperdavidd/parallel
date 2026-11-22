"use client";

import { useEffect, useState } from "react";
import { useWallets } from "@privy-io/react-auth/solana";
import { fmt, type Market } from "@/lib/mock";
import { useDemo } from "@/lib/store";
import { useChainPortfolio } from "@/lib/useChainPortfolio";
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
  const { signedIn } = useDemo();
  const { positions, walletBalance, portfolioEquity, equity, snapshot } = useChainPortfolio();
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
                <th>In wallet</th>
                <th>In portfolios</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>tUSDC</td>
                <td>{signedIn && snapshot ? fmt(walletBalance) : "—"}</td>
                <td>{signedIn && snapshot ? fmt(portfolioEquity) : "—"}</td>
                <td>{signedIn && snapshot ? fmt(equity) : "—"}</td>
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
          <div className="bpanel-empty" style={{ lineHeight: 1.6, maxWidth: 620 }}>
            <p style={{ margin: "0 0 8px" }}>
              <b>No funding has accrued.</b> These markets were created with a funding cap of
              about 0.05% per hour, but the Percolator program deployed on devnet does not
              generate funding through its AuthMark price path — verified on-chain, with the
              market&rsquo;s own funding counters reading zero after a full liquidation cycle.
            </p>
            <p style={{ margin: 0, color: "var(--ink3)" }}>
              So there is nothing to list here, and a list of plausible-looking payments would
              be a fiction. Liquidation does work and has been proven end to end; funding needs
              a newer program build than the one on devnet today.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
