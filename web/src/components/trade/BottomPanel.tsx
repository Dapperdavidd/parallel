"use client";

import { useState } from "react";
import { useWallets } from "@privy-io/react-auth/solana";
import { fmt } from "@/lib/mock";
import type { MarketView } from "@/lib/live";
import { useDemo } from "@/lib/store";
import { useChainPortfolio } from "@/lib/useChainPortfolio";
import { PositionsTable } from "./PositionsTable";
import { TradeHistory } from "./TradeHistory";

const TABS = ["Positions", "Open orders", "Trade history", "Balances", "Funding"] as const;
type Tab = (typeof TABS)[number];

export function BottomPanel({ market }: { market: MarketView }) {
  const [tab, setTab] = useState<Tab>("Positions");
  const { signedIn } = useDemo();
  const { positions, walletBalance, portfolioEquity, equity, snapshot } = useChainPortfolio();
  const { wallets } = useWallets();
  const wallet = wallets[0]?.address;

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

        {tab === "Open orders" && (
          <div className="bpanel-empty orders-empty">
            <b>No resting orders</b>
            <span>
              Parallel currently supports immediate market execution against an isolated vault.
              Limit, trigger, TP/SL, and reduce-only orders are not enabled by this deployed
              devnet program, so nothing is hidden here.
            </span>
          </div>
        )}

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

        {tab === "Trade history" && (
          <TradeHistory market={market} wallet={wallet} signedIn={signedIn} />
        )}

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
