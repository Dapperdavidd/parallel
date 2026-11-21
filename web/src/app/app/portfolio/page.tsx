"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ACCOUNT_FEES,
  ACCOUNT_TRADES,
  ACCOUNT_VOLUME,
  DEMO_WALLET,
  DEVNET_TOPUP,
  EQUITY_RANGES,
  STARTING_BALANCE,
  accountStats,
  compactUsd,
  equitySeries,
  fmt,
  type EquityRange,
} from "@/lib/mock";
import { useDemo } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { EquityChart } from "@/components/EquityChart";
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

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="ptile">
      <div className="ptile-label">{label}</div>
      <div className="ptile-value mono" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {sub && <div className="ptile-sub mono">{sub}</div>}
    </div>
  );
}

const TABS = ["Positions", "Balances", "Account"] as const;
type Tab = (typeof TABS)[number];

export default function PortfolioPage() {
  const { signedIn, user, balance, positions, openPnl, ready, topUp, signOut } = useDemo();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [range, setRange] = useState<EquityRange>("1W");
  const [tab, setTab] = useState<Tab>("Positions");

  const margin = positions.reduce((a, p) => a + p.size, 0);
  const equity = balance + margin + openPnl;

  // The chart and every figure under it come from one series, so they cannot
  // drift apart.
  const series = useMemo(() => equitySeries(equity, range), [equity, range]);
  const stats = useMemo(() => accountStats(series), [series]);
  const up = stats.pnl >= 0;

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

      {/* Performance: the curve, then the figures it produces. */}
      <section className="perf">
        <div className="perf-top">
          <div>
            <div className="ptile-label">Performance</div>
            <div className="perf-pnl mono" style={{ color: up ? "var(--up)" : "var(--dn)" }}>
              {up ? "+" : "−"}
              {fmt(Math.abs(stats.pnl))}
              <span className="perf-pct">
                {up ? "+" : "−"}
                {Math.abs(stats.pnlPct).toFixed(2)}%
              </span>
            </div>
          </div>

          <div className="perf-ranges" role="tablist" aria-label="Chart range">
            {EQUITY_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={r === range}
                className={r === range ? "on" : undefined}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <EquityChart data={series} up={up} />

        <div className="ptiles">
          <Tile
            label="P&L"
            value={`${up ? "+" : "−"}${fmt(Math.abs(stats.pnl))}`}
            sub={`${range} · tUSDC`}
            tone={up ? "var(--up)" : "var(--dn)"}
          />
          <Tile
            label="Max drawdown"
            value={`−${fmt(stats.maxDrawdown)}`}
            sub={`${stats.maxDrawdownPct.toFixed(2)}% from peak`}
          />
          <Tile label="Total equity" value={fmt(stats.equity)} sub="tUSDC" />
          <Tile label="Volume traded" value={compactUsd(ACCOUNT_VOLUME)} sub={`${ACCOUNT_TRADES} trades`} />
          <Tile label="Fees paid" value={fmt(ACCOUNT_FEES)} sub="0.06% per trade" />
        </div>
      </section>

      <section className="pcard">
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

        <div className="pcard-body">
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
                  <td className="mono">{fmt(balance)}</td>
                  <td className="mono">{fmt(margin)}</td>
                  <td className="mono">{fmt(balance + margin)}</td>
                </tr>
              </tbody>
            </table>
          )}

          {tab === "Account" && (
            <div className="pacct">
              <div className="row">
                Starting balance<b>{fmt(STARTING_BALANCE)} tUSDC</b>
              </div>
              <div className="row">
                Network<b>Solana devnet</b>
              </div>
              <div className="row">
                Wallet<b>Created at sign-in, no seed phrase</b>
              </div>
              <p>
                Balances are devnet test tokens with no cash value. Your wallet is yours — you
                can export it at any time.
              </p>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ height: 38, fontSize: 13, alignSelf: "flex-start" }}
                onClick={() => {
                  signOut();
                  toast("Signed out");
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
