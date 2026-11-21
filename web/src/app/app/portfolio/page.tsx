"use client";

import Link from "next/link";
import { useState } from "react";
import { fmt, DEMO_WALLET, DEVNET_TOPUP, STARTING_BALANCE } from "@/lib/mock";
import { useDemo } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { PositionsTable } from "@/components/trade/PositionsTable";

function Action({
  label,
  hint,
  primary,
  onClick,
  disabled,
}: {
  label: string;
  hint: string;
  primary?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <span className="act-wrap">
      <button
        type="button"
        className={`act${primary ? " act-primary" : ""}`}
        onClick={onClick}
        disabled={disabled}
      >
        {label}
      </button>
      <span className="act-hint" role="tooltip">{hint}</span>
    </span>
  );
}

export default function PortfolioPage() {
  const { signedIn, user, balance, positions, openPnl, ready, topUp, signOut } = useDemo();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

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

  const margin = positions.reduce((a, p) => a + p.size, 0);
  const equity = balance + margin + openPnl;

  return (
    <div className="page">
      {/* Balance leads, in the open — not boxed in with everything else. */}
      <section className="bal">
        <div className="bal-label">Total balance</div>
        <div className="bal-amount mono">
          {fmt(equity)} <span className="bal-unit">tUSDC</span>
        </div>
        <div className="bal-sub">
          <span>
            Available <b className="mono">{fmt(balance)}</b>
          </span>
          <span>
            In positions <b className="mono">{fmt(margin)}</b>
          </span>
          <span>
            Open P&amp;L{" "}
            <b className="mono" style={{ color: openPnl >= 0 ? "var(--up)" : "var(--dn)" }}>
              {openPnl >= 0 ? "+" : ""}
              {fmt(openPnl)}
            </b>
          </span>
        </div>

        <div className="bal-actions">
          <Action
            label="Add money"
            primary
            hint={`Adds ${fmt(DEVNET_TOPUP, 0)} test USDC to your wallet. Devnet only — it is not real money.`}
            onClick={() => {
              const amount = topUp();
              toast(`Added ${fmt(amount, 0)} tUSDC from the devnet faucet`);
            }}
          />
          <Action
            label="Send"
            hint="Send tUSDC to another Parallel username or a Solana address."
            disabled
          />
          <Action
            label="Receive"
            hint="Show your address and username so someone can send you tUSDC."
            onClick={() => {
              void navigator.clipboard?.writeText(DEMO_WALLET);
              setCopied(true);
              toast("Wallet address copied");
              setTimeout(() => setCopied(false), 1800);
            }}
          />
        </div>

        <div className="bal-wallet">
          <span style={{ color: "var(--ink3)" }}>@{user}.parallel</span>
          <span className="mono">{DEMO_WALLET}</span>
          {copied && <span style={{ color: "var(--up)" }}>copied</span>}
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 10px" }}>Open positions</h2>
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <PositionsTable />
        </div>
      </section>

      <section className="card" style={{ marginTop: 20 }}>
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
        <button
          type="button"
          className="btn btn-ghost"
          style={{ height: 38, marginTop: 16, fontSize: 13 }}
          onClick={() => {
            signOut();
            toast("Signed out");
          }}
        >
          Sign out
        </button>
      </section>
    </div>
  );
}
