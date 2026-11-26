"use client";

import type { PortfolioSnapshot } from "./useChainPortfolio";
import type { RealizedSummary, VerifiedTrade } from "./portfolio";

/**
 * The account, in a file somebody can keep.
 *
 * Everything on the portfolio screen is derived from two confirmed sources,
 * and none of it could be taken away. That is a poor deal for a person whose
 * own trading record it is — and it is the one thing a tax year, a dispute or
 * a spreadsheet actually needs.
 *
 * Deliberately CSV rather than PDF: it opens in anything, it is readable
 * without us, and it carries no formatting to misrepresent the numbers. The
 * header block records what the figures are and when they were read, because
 * a column of numbers with no provenance is worth very little.
 */

const field = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const row = (...cells: (string | number)[]): string => cells.map(field).join(",");

export function buildStatement(input: {
  snapshot: PortfolioSnapshot | null;
  trades: VerifiedTrade[];
  summary: RealizedSummary;
  walletBalance: number;
  portfolioEquity: number;
  equity: number;
  unrealized: number;
}): string {
  const lines: string[] = [];
  const now = new Date().toISOString();

  lines.push(row("Parallel account statement"));
  lines.push(row("generated_utc", now));
  lines.push(row("network", "Solana devnet"));
  lines.push(row("note", "Devnet test tokens. No cash value."));
  lines.push(row("wallet", input.snapshot?.wallet ?? ""));
  lines.push(row("read_at_slot", input.snapshot?.slot ?? ""));
  lines.push("");

  lines.push(row("Balances (tUSDC)"));
  lines.push(row("in_wallet", input.walletBalance.toFixed(6)));
  lines.push(row("in_portfolios", input.portfolioEquity.toFixed(6)));
  lines.push(row("total_equity", input.equity.toFixed(6)));
  lines.push(row("unrealised_pnl_stored_on_chain", input.unrealized.toFixed(6)));
  lines.push(row("realised_pnl_from_verified_closes", input.summary.realized.toFixed(6)));
  lines.push(row("volume_traded", input.summary.volume.toFixed(6)));
  lines.push(row("verified_trades", input.summary.trades));
  lines.push(row("settled_closes", input.summary.closes));
  lines.push("");

  lines.push(row("Open positions"));
  lines.push(
    row("market", "side", "notional_usdc", "portfolio_account", "engine_price_e6"),
  );
  for (const portfolio of input.snapshot?.portfolios ?? []) {
    for (const position of portfolio.positions) {
      lines.push(
        row(
          portfolio.marketId,
          position.side,
          (Number(BigInt(position.notionalAtoms)) / 1e6).toFixed(6),
          portfolio.address,
          portfolio.effectivePriceE6,
        ),
      );
    }
  }
  lines.push("");

  lines.push(row("Verified trades"));
  lines.push(
    row(
      "time_utc",
      "market",
      "side",
      "action",
      "size_usdc",
      "leverage",
      "unit_price_usd",
      "transaction",
    ),
  );
  for (const trade of [...input.trades].sort((a, b) => (a.ts < b.ts ? 1 : -1))) {
    lines.push(
      row(
        trade.ts,
        trade.marketId,
        trade.side,
        trade.action,
        trade.sizeUsdc.toFixed(6),
        trade.leverage,
        trade.price.toFixed(8),
        trade.txSignature,
      ),
    );
  }

  return lines.join("\n");
}

export function downloadStatement(body: string, wallet: string): void {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `parallel-statement-${wallet.slice(0, 6)}-${stamp}.csv`;
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}
