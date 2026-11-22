"use client";

import { useCallback, useState } from "react";
import { fmt } from "@/lib/mock";
import { localQuote } from "@/lib/portfolio";
import { useDemo } from "@/lib/store";
import { useChainPortfolio, usdc, type ChainPortfolio } from "@/lib/useChainPortfolio";
import { useToast } from "@/components/Toast";
import { usePercolatorTrade } from "@/lib/usePercolatorTrade";

/**
 * The positions panel on the trade screen.
 *
 * Reads the chain, not this browser. Through Phase 2 this kept a local list
 * and computed P&L against a remembered entry price and a sample mark, which
 * could disagree with the engine; and §7.7 had to bolt on a "close the
 * on-chain position anyway" button for the case where the local row vanished
 * but the leg was still open. Both problems go away by reading the only source
 * that is authoritative.
 */

export function PositionsTable() {
  const { signedIn } = useDemo();
  const { positions, snapshot, error, refresh, reload } = useChainPortfolio();
  const { close } = usePercolatorTrade();
  const toast = useToast();
  const [closing, setClosing] = useState("");

  const onClose = useCallback(
    (portfolio: ChainPortfolio): void => {
      setClosing(portfolio.address);
      void close({ code: portfolio.code, portfolio: portfolio.address })
        .then(async (signature) => {
          toast(`Closed on devnet · ${signature.slice(0, 8)}…`);
          await reload();
        })
        .catch((e: unknown) => toast(e instanceof Error ? e.message : "The close failed"))
        .finally(() => setClosing(""));
    },
    [close, reload, toast],
  );

  if (!signedIn) {
    return (
      <p style={{ padding: "6px 16px 18px", margin: 0, fontSize: 13, color: "var(--ink3)" }}>
        Sign in to see your positions.
      </p>
    );
  }

  if (error) {
    return (
      <p style={{ padding: "6px 16px 18px", margin: 0, fontSize: 13, color: "var(--dn)" }}>
        {error}{" "}
        <button type="button" className="closebtn" onClick={refresh}>
          Retry
        </button>
      </p>
    );
  }

  if (positions.length === 0) {
    return (
      <p style={{ padding: "6px 16px 18px", margin: 0, fontSize: 13, color: "var(--ink3)" }}>
        {snapshot ? "No open positions on-chain." : "Reading your positions…"}
      </p>
    );
  }

  return (
    <table className="postable">
      <thead>
        <tr>
          <th>Market</th>
          <th>Side</th>
          <th>Notional</th>
          <th>Mark</th>
          <th>Stored P&amp;L</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {positions.map(({ portfolio, position }) => {
          const quote = localQuote(portfolio.unit, portfolio.effectivePriceE6);
          const pnl = usdc(portfolio.pnlAtoms);
          return (
            <tr key={`${portfolio.address}-${position.sizeQ}`}>
              <td>{portfolio.marketId}</td>
              <td style={{ color: position.side === "long" ? "var(--up)" : "var(--dn)" }}>
                {position.side === "long" ? "Long" : "Short"}
              </td>
              <td className="mono">{fmt(usdc(position.notionalAtoms))}</td>
              <td className="mono">{quote === null ? "—" : fmt(quote, 2)}</td>
              <td className="mono" style={{ color: pnl >= 0 ? "var(--up)" : "var(--dn)" }}>
                {pnl >= 0 ? "+" : "−"}
                {fmt(Math.abs(pnl))}
              </td>
              <td style={{ textAlign: "right" }}>
                <button
                  type="button"
                  className="closebtn"
                  disabled={closing !== ""}
                  onClick={() => onClose(portfolio)}
                >
                  {closing === portfolio.address ? "Closing…" : "Close"}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
