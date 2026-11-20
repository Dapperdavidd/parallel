"use client";

import Link from "next/link";
import { fmt, DEMO_WALLET, STARTING_BALANCE } from "@/lib/mock";
import { useDemo } from "@/lib/store";
import { PositionsTable } from "@/components/trade/PositionsTable";

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card">
      <div style={{ fontSize: 13, color: "var(--ink3)" }}>{label}</div>
      <div className="mono" style={{ fontSize: 26, marginTop: 6, color }}>
        {value}
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const { signedIn, user, balance, positions, openPnl, ready } = useDemo();

  if (!ready) return null;

  if (!signedIn) {
    return (
      <div className="page" style={{ textAlign: "center", paddingTop: 100 }}>
        <h1 style={{ fontSize: 32 }}>Sign in to see your portfolio</h1>
        <p style={{ color: "var(--ink2)" }}>
          One login. We create or open your wallet automatically.
        </p>
        <Link className="btn btn-light" href="/signin" style={{ marginTop: 12 }}>
          Sign in / Sign up
        </Link>
      </div>
    );
  }

  const equity = balance + positions.reduce((a, p) => a + p.size, 0) + openPnl;

  return (
    <div className="page">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 32, letterSpacing: "-.03em" }}>Portfolio</h1>
        <div style={{ textAlign: "right", fontSize: 13, color: "var(--ink3)" }}>
          <div>@{user}.parallel</div>
          <div className="mono">{DEMO_WALLET}</div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
          gap: 14,
          marginBottom: 24,
        }}
      >
        <Stat label="Available" value={`${fmt(balance)} tUSDC`} />
        <Stat
          label="Open P&L"
          value={`${openPnl >= 0 ? "+" : ""}${fmt(openPnl)}`}
          color={openPnl >= 0 ? "var(--up)" : "var(--dn)"}
        />
        <Stat label="Equity" value={fmt(equity)} />
        <Stat label="Open positions" value={String(positions.length)} />
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "16px 16px 4px", fontSize: 15, fontWeight: 600 }}>
          Open positions
        </div>
        <PositionsTable />
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Account</div>
        <div className="row">
          Starting balance<b>{fmt(STARTING_BALANCE)} tUSDC</b>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          Network<b>Solana devnet</b>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          Wallet<b>Created at sign-in, no seed phrase</b>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink3)", margin: "14px 0 0", lineHeight: 1.6 }}>
          Balances are devnet test tokens with no cash value. Your wallet is yours — you can
          export it at any time.
        </p>
      </div>
    </div>
  );
}
