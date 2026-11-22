"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { compactUsd, fmt } from "@/lib/mock";
import { localQuote, summarize, type VerifiedTrade } from "@/lib/portfolio";
import { useDemo } from "@/lib/store";
import { usePercolatorTrade } from "@/lib/usePercolatorTrade";
import { useToast } from "@/components/Toast";
import { EquityChart } from "@/components/EquityChart";

/**
 * F12 — the portfolio, from the chain and from verified trade records.
 *
 * Two sources, both confirmed:
 *   - `/api/portfolio` reads the wallet's token balance and every Percolator
 *     portfolio it owns at one slot, including open legs and stored PnL;
 *   - `/api/trades` returns only trades the server matched against a confirmed
 *     devnet transaction, which is what the realised curve is built from.
 *
 * Where neither source has a figure, the screen shows a dash. The seeded
 * equity curve and the placeholder wallet that stood here through Phase 2 are
 * gone.
 */

interface ChainPosition {
  side: "long" | "short";
  sizeQ: string;
  notionalAtoms: string;
}

interface ChainPortfolio {
  address: string;
  marketId: string;
  code: string;
  unit: number;
  unitLabel: string;
  maxLeverage: number;
  capitalAtoms: string;
  pnlAtoms: string;
  equityAtoms: string;
  effectivePriceE6: string;
  positions: ChainPosition[];
}

interface PortfolioSnapshot {
  wallet: string;
  slot: number;
  walletAtoms: string;
  portfolioEquityAtoms: string;
  storedPnlAtoms: string;
  totalEquityAtoms: string;
  portfolios: ChainPortfolio[];
}

const usdc = (atoms: string): number => Number(BigInt(atoms)) / 1_000_000;
const short = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

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
  const { signedIn, user, walletAddress, ready, topUp, signOut } = useDemo();
  const { close } = usePercolatorTrade();
  const toast = useToast();

  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<Tab>("Positions");
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [trades, setTrades] = useState<VerifiedTrade[] | null>(null);
  const [readError, setReadError] = useState("");
  const [closing, setClosing] = useState("");

  const load = useCallback(async (): Promise<void> => {
    if (!walletAddress) return;
    const wallet = encodeURIComponent(walletAddress);
    const [chain, history] = await Promise.all([
      fetch(`/api/portfolio?wallet=${wallet}`, { cache: "no-store" }),
      fetch(`/api/trades?wallet=${wallet}&limit=100`, { cache: "no-store" }),
    ]);
    const body = (await chain.json()) as PortfolioSnapshot & { error?: string };
    if (!chain.ok) throw new Error(body.error ?? "The portfolio read failed");
    setSnapshot(body);
    // History is supporting detail: a failure here must not blank the balances.
    setTrades(history.ok ? ((await history.json()) as { trades: VerifiedTrade[] }).trades : []);
    setReadError("");
  }, [walletAddress]);

  const refresh = useCallback((): void => {
    void load().catch((error: unknown) => {
      setReadError(error instanceof Error ? error.message : "The portfolio read failed");
    });
  }, [load]);

  useEffect(() => {
    if (!signedIn || !walletAddress) return;
    refresh();
  }, [signedIn, walletAddress, refresh]);

  const walletBalance = snapshot ? usdc(snapshot.walletAtoms) : 0;
  const portfolioEquity = snapshot ? usdc(snapshot.portfolioEquityAtoms) : 0;
  const equity = snapshot ? usdc(snapshot.totalEquityAtoms) : 0;
  const unrealized = snapshot ? usdc(snapshot.storedPnlAtoms) : 0;

  const summary = useMemo(() => summarize(trades ?? []), [trades]);
  const up = summary.realized >= 0;

  const positions = useMemo(
    () =>
      (snapshot?.portfolios ?? []).flatMap((portfolio) =>
        portfolio.positions.map((position) => ({ portfolio, position })),
      ),
    [snapshot],
  );

  const onClose = useCallback(
    (portfolio: ChainPortfolio): void => {
      setClosing(portfolio.address);
      void close({ code: portfolio.code, portfolio: portfolio.address })
        .then(async (signature) => {
          toast(`Closed on devnet · ${short(signature)}`);
          await load();
        })
        .catch((error: unknown) => toast(error instanceof Error ? error.message : "The close failed"))
        .finally(() => setClosing(""));
    },
    [close, load, toast],
  );

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
          {snapshot ? fmt(equity) : "—"} <span className="bal-unit">tUSDC</span>
        </div>
        <div className="bal-sub">
          <span>
            In wallet <b className="mono">{snapshot ? fmt(walletBalance) : "—"}</b>
          </span>
          <span>
            In portfolios <b className="mono">{snapshot ? fmt(portfolioEquity) : "—"}</b>
          </span>
          <span>
            Unrealised P&amp;L{" "}
            <b className="mono" style={{ color: unrealized >= 0 ? "var(--up)" : "var(--dn)" }}>
              {snapshot ? `${unrealized >= 0 ? "+" : "−"}${fmt(Math.abs(unrealized))}` : "—"}
            </b>
          </span>
        </div>

        <div className="bal-actions">
          <Action
            label="Add money"
            primary
            hint="Tops your devnet wallet up from the faucet. Devnet only — it is not real money."
            onClick={() => {
              void topUp()
                .then(async (amount) => {
                  await load();
                  toast(
                    amount > 0
                      ? `Added ${fmt(amount, 0)} tUSDC from the devnet faucet`
                      : "Devnet balance is already funded",
                  );
                })
                .catch((error: unknown) =>
                  toast(error instanceof Error ? error.message : "Devnet funding failed"),
                );
            }}
          />
          <Action
            label="Send"
            hint="Send tUSDC to another Parallel username or a Solana address."
            disabled
          />
          <Action
            label="Receive"
            hint="Copy your wallet address so someone can send you tUSDC."
            onClick={() => {
              void navigator.clipboard?.writeText(walletAddress);
              setCopied(true);
              toast("Wallet address copied");
              setTimeout(() => setCopied(false), 1800);
            }}
          />
        </div>

        <div className="bal-wallet">
          <span style={{ color: "var(--ink3)" }}>@{user}.parallel</span>
          <span className="mono">{walletAddress ? short(walletAddress) : "—"}</span>
          {copied && <span style={{ color: "var(--up)" }}>copied</span>}
        </div>
      </section>

      {readError && (
        <p style={{ color: "var(--dn)", margin: "0 0 10px" }}>
          {readError}{" "}
          <button type="button" className="btn btn-ghost" style={{ height: 28, fontSize: 12 }} onClick={refresh}>
            Retry
          </button>
        </p>
      )}

      {/* Realised P&L only. Each step is a settled close, so the curve is flat
          between them rather than drifting through invented values. */}
      <section className="perf">
        <div className="perf-top">
          <div>
            <div className="ptile-label">Realised performance</div>
            <div className="perf-pnl mono" style={{ color: up ? "var(--up)" : "var(--dn)" }}>
              {trades ? `${up ? "+" : "−"}${fmt(Math.abs(summary.realized))}` : "—"}
              <span className="perf-pct">
                {summary.closes} {summary.closes === 1 ? "close" : "closes"}
              </span>
            </div>
          </div>
          <div className="ptile-label mono">
            {snapshot ? `slot ${snapshot.slot.toLocaleString()}` : "reading…"}
          </div>
        </div>

        {summary.curve.length >= 2 ? (
          <EquityChart data={summary.curve} up={up} />
        ) : (
          <div
            className="eq-host"
            style={{
              display: "grid",
              placeItems: "center",
              color: "var(--ink3)",
              fontSize: 13,
              textAlign: "center",
              padding: "0 20px",
            }}
          >
            Your curve starts at your first settled close. Nothing is drawn before then.
          </div>
        )}

        <div className="ptiles">
          <Tile
            label="Realised P&L"
            value={trades ? `${up ? "+" : "−"}${fmt(Math.abs(summary.realized))}` : "—"}
            sub="From verified closes"
            tone={up ? "var(--up)" : "var(--dn)"}
          />
          <Tile
            label="Unrealised P&L"
            value={snapshot ? `${unrealized >= 0 ? "+" : "−"}${fmt(Math.abs(unrealized))}` : "—"}
            sub="Stored on-chain"
            tone={unrealized >= 0 ? "var(--up)" : "var(--dn)"}
          />
          <Tile label="Total equity" value={snapshot ? fmt(equity) : "—"} sub="Wallet + portfolios" />
          <Tile
            label="Volume traded"
            value={trades ? compactUsd(summary.volume) : "—"}
            sub={`${summary.trades} verified ${summary.trades === 1 ? "trade" : "trades"}`}
          />
          <Tile
            label="Fees paid"
            value={fmt(0)}
            sub="No trading fee on devnet"
          />
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
          {tab === "Positions" &&
            (positions.length === 0 ? (
              <p style={{ padding: "6px 16px 18px", color: "var(--ink3)" }}>
                {snapshot ? "No open positions on-chain." : "Reading your portfolios…"}
              </p>
            ) : (
              <table className="postable">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Side</th>
                    <th>Notional</th>
                    <th>Mark</th>
                    <th>Portfolio</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {positions.map(({ portfolio, position }) => {
                    const quote = localQuote(portfolio.unit, portfolio.effectivePriceE6);
                    return (
                      <tr key={`${portfolio.address}-${position.sizeQ}`}>
                        <td>{portfolio.marketId}</td>
                        <td style={{ color: position.side === "long" ? "var(--up)" : "var(--dn)" }}>
                          {position.side === "long" ? "Long" : "Short"}
                        </td>
                        <td className="mono">{fmt(usdc(position.notionalAtoms))} tUSDC</td>
                        <td className="mono">
                          {quote === null ? "—" : `${quote.toFixed(2)} ${portfolio.code}`}
                        </td>
                        <td className="mono">{short(portfolio.address)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ height: 30, fontSize: 12 }}
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
            ))}

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
                  <td className="mono">{snapshot ? fmt(walletBalance) : "—"}</td>
                  <td className="mono">{snapshot ? fmt(portfolioEquity) : "—"}</td>
                  <td className="mono">{snapshot ? fmt(equity) : "—"}</td>
                </tr>
              </tbody>
            </table>
          )}

          {tab === "Account" && (
            <div className="pacct">
              <div className="row">
                Network<b>Solana devnet</b>
              </div>
              <div className="row">
                Wallet<b className="mono">{walletAddress || "—"}</b>
              </div>
              <div className="row">
                On-chain portfolios<b>{snapshot?.portfolios.length ?? "—"}</b>
              </div>
              <div className="row">
                Read at slot<b className="mono">{snapshot ? snapshot.slot.toLocaleString() : "—"}</b>
              </div>
              <p>
                Balances are devnet test tokens with no cash value. Every figure on this page is a
                confirmed account read or a verified transaction — nothing here is simulated. Your
                wallet is yours, and you can export it at any time.
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
