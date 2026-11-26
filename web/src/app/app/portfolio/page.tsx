"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { compactUsd, fmt } from "@/lib/mock";
import { localQuote, openLots, positionRisk } from "@/lib/portfolio";
import { buildStatement, downloadStatement } from "@/lib/statement";
import { explorerAddress } from "@/lib/explorer";
import { useDemo } from "@/lib/store";
import { useChainPortfolio, usdc, type ChainPortfolio } from "@/lib/useChainPortfolio";
import { usePercolatorTrade } from "@/lib/usePercolatorTrade";
import { useExportWallet } from "@privy-io/react-auth/solana";
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

/** How far back the realised curve looks. */
const PERIODS = [
  { key: "7d", label: "7D", days: 7 },
  { key: "30d", label: "30D", days: 30 },
  { key: "90d", label: "90D", days: 90 },
  { key: "all", label: "All", days: null },
] as const;
type Period = (typeof PERIODS)[number]["key"];

export default function PortfolioPage() {
  const { signedIn, user, walletAddress, ready, topUp, signOut } = useDemo();
  const { close } = usePercolatorTrade();
  const { exportWallet } = useExportWallet();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<Tab>("Positions");
  const [closing, setClosing] = useState("");
  const [period, setPeriod] = useState<Period>("all");

  const {
    snapshot,
    trades,
    summary,
    positions,
    walletBalance,
    portfolioEquity,
    equity,
    unrealized,
    error: readError,
    refresh,
    reload,
  } = useChainPortfolio();

  const up = summary.realized >= 0;

  /**
   * The cost basis behind each open position.
   *
   * Keyed market|side, from the verified history, so the unrealised figure
   * beside a position is computed against what that position was actually
   * entered at rather than against the account's stored total.
   */
  const lots = useMemo(() => openLots(trades ?? []), [trades]);

  // The curve, cut to the chosen window. The first point is pinned to the
  // window's start value so a 7-day view does not open at zero and imply a
  // loss that was realised before it.
  const curve = useMemo(() => {
    const days = PERIODS.find((entry) => entry.key === period)?.days ?? null;
    if (days === null || summary.curve.length === 0) return summary.curve;
    const cutoff = Math.floor((Date.now() - days * 86_400_000) / 1000);
    const inside = summary.curve.filter((point) => point.time >= cutoff);
    if (inside.length === 0) return [];
    const before = summary.curve.filter((point) => point.time < cutoff).pop();
    return before ? [{ time: cutoff, value: before.value }, ...inside] : inside;
  }, [summary.curve, period]);

  // Realised inside the window, which is the number the period control
  // implies and not the lifetime total.
  const realizedInPeriod =
    curve.length > 0 ? curve[curve.length - 1]!.value - curve[0]!.value : 0;
  const periodUp = realizedInPeriod >= 0;

  const onClose = useCallback(
    (portfolio: ChainPortfolio): void => {
      setClosing(portfolio.address);
      void close({ code: portfolio.code, portfolio: portfolio.address })
        .then(async (signature) => {
          toast(`Closed on devnet · ${short(signature)}`);
          await reload();
        })
        .catch((error: unknown) => toast(error instanceof Error ? error.message : "The close failed"))
        .finally(() => setClosing(""));
    },
    [close, reload, toast],
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
                  await reload();
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
            <div className="perf-pnl mono" style={{ color: periodUp ? "var(--up)" : "var(--dn)" }}>
              {trades
                ? `${periodUp ? "+" : "−"}${fmt(Math.abs(period === "all" ? summary.realized : realizedInPeriod))}`
                : "—"}
              <span className="perf-pct">
                {period === "all"
                  ? `${summary.closes} ${summary.closes === 1 ? "close" : "closes"}`
                  : `over ${PERIODS.find((entry) => entry.key === period)?.label.toLowerCase()}`}
              </span>
            </div>
          </div>
          <div className="perf-controls">
            <div className="lev-presets" role="group" aria-label="Period">
              {PERIODS.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className={period === entry.key ? "on" : undefined}
                  onClick={() => setPeriod(entry.key)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="ptile-label mono">
              {snapshot ? `slot ${snapshot.slot.toLocaleString()}` : "reading…"}
            </div>
          </div>
        </div>

        {curve.length >= 2 ? (
          <EquityChart data={curve} up={periodUp} />
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
            {summary.curve.length >= 2
              ? "Nothing was realised in this window."
              : "Your curve starts at your first settled close. Nothing is drawn before then."}
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
          <Tile
            label="Funding paid"
            value={fmt(0)}
            sub="The devnet program accrues none"
          />
        </div>

        {/* A trading record somebody cannot take away is not much of a
            record. CSV on purpose: it opens anywhere and carries no
            formatting that could misrepresent the numbers. */}
        <div className="perf-foot">
          <button
            type="button"
            className="btn btn-ghost"
            style={{ height: 32, fontSize: 12.5 }}
            disabled={!snapshot}
            onClick={() => {
              downloadStatement(
                buildStatement({
                  snapshot,
                  trades: trades ?? [],
                  summary,
                  walletBalance,
                  portfolioEquity,
                  equity,
                  unrealized,
                }),
                walletAddress || "wallet",
              );
              toast("Statement downloaded");
            }}
          >
            Download statement (CSV)
          </button>
          <span style={{ fontSize: 12, color: "var(--ink3)" }}>
            Balances, open positions and every verified trade, with its signature.
          </span>
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
                    <th>Entry</th>
                    <th>Mark</th>
                    <th>Unrealised</th>
                    <th>Margin</th>
                    <th>Room left</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {positions.map(({ portfolio, position }) => {
                    const quote = localQuote(portfolio.unit, portfolio.effectivePriceE6);
                    const notional = usdc(position.notionalAtoms);
                    const lot = lots.get(`${portfolio.marketId}|${position.side}`);
                    const markPrice = Number(BigInt(portfolio.effectivePriceE6)) / 1e6;
                    const risk = positionRisk({
                      notionalUsdc: notional,
                      equityUsdc: usdc(portfolio.equityAtoms),
                      side: position.side,
                      markPrice,
                      entryPrice: lot?.entryPrice ?? null,
                    });
                    const entryQuote =
                      lot && lot.entryPrice > 0 ? portfolio.unit / lot.entryPrice : null;
                    return (
                      <tr key={`${portfolio.address}-${position.sizeQ}`}>
                        <td>{portfolio.marketId}</td>
                        <td style={{ color: position.side === "long" ? "var(--up)" : "var(--dn)" }}>
                          {position.side === "long" ? "Long" : "Short"}
                        </td>
                        <td className="mono">{fmt(notional)} tUSDC</td>
                        {/* From the verified history. A position opened before
                            the store existed has none, and shows a dash. */}
                        <td
                          className="mono"
                          title={
                            entryQuote === null
                              ? "No recorded open for this position, so there is no cost basis to show."
                              : "Size-weighted entry from your verified trades."
                          }
                        >
                          {entryQuote === null ? "—" : entryQuote.toFixed(2)}
                        </td>
                        <td className="mono">
                          {quote === null ? "—" : `${quote.toFixed(2)} ${portfolio.code}`}
                        </td>
                        <td
                          className="mono"
                          style={
                            risk.unrealizedUsdc === null
                              ? undefined
                              : { color: risk.unrealizedUsdc >= 0 ? "var(--up)" : "var(--dn)" }
                          }
                        >
                          {risk.unrealizedUsdc === null
                            ? "—"
                            : `${risk.unrealizedUsdc >= 0 ? "+" : "−"}${fmt(Math.abs(risk.unrealizedUsdc))}`}
                          {risk.returnPct !== null && (
                            <small style={{ marginLeft: 5, color: "var(--ink3)" }}>
                              {risk.returnPct >= 0 ? "+" : "−"}
                              {Math.abs(risk.returnPct).toFixed(1)}%
                            </small>
                          )}
                        </td>
                        <td className="mono">
                          {risk.marginRatio === null ? "—" : `${risk.marginRatio.toFixed(1)}%`}
                        </td>
                        {/* How far the engine price can move against this
                            position before its margin is gone. Approximate. */}
                        <td title="How far the engine's price can move against this position before its margin is gone. Approximate: before fees and funding.">
                          {risk.liquidationGapPct === null ? (
                            "—"
                          ) : (
                            <span className="room">
                              <span className="room-track">
                                <span
                                  className="room-fill"
                                  style={{
                                    width: `${Math.max(2, Math.min(100, risk.liquidationGapPct * 2))}%`,
                                    background:
                                      risk.liquidationGapPct < 8
                                        ? "var(--dn)"
                                        : risk.liquidationGapPct < 15
                                          ? "var(--amb)"
                                          : "var(--up)",
                                  }}
                                />
                              </span>
                              <b className="mono">{risk.liquidationGapPct.toFixed(1)}%</b>
                            </span>
                          )}
                        </td>
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
              {(snapshot?.portfolios ?? []).map((portfolio) => (
                <div className="row" key={portfolio.address}>
                  {portfolio.marketId}
                  <b className="mono">
                    <a
                      href={explorerAddress(portfolio.address)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "inherit" }}
                    >
                      {short(portfolio.address)} ↗
                    </a>
                  </b>
                </div>
              ))}
              <div className="row">
                Read at slot<b className="mono">{snapshot ? snapshot.slot.toLocaleString() : "—"}</b>
              </div>
              <p>
                Balances are devnet test tokens with no cash value. Every figure on this page is a
                confirmed account read or a verified transaction — nothing here is simulated.
              </p>

              {/* The claim "your wallet is yours" was made on three screens
                  and backed by nothing: there was no way to take the key out.
                  Privy shows it on an iframe from its own domain, so neither
                  this page nor anything on it can read what you are shown. */}
              <div className="pexport">
                <div>
                  <b>Take your wallet with you</b>
                  <span>
                    Export the private key and import it into Phantom, Backpack or any Solana
                    wallet. If Parallel stopped tomorrow, the wallet and everything in it would
                    still be yours. Anyone holding this key controls the wallet — treat it the
                    way you would treat cash.
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ height: 38, fontSize: 13 }}
                  disabled={exporting || !walletAddress}
                  onClick={() => {
                    setExporting(true);
                    void exportWallet({ address: walletAddress })
                      .catch((error: unknown) =>
                        toast(
                          error instanceof Error ? error.message : "The export did not open",
                        ),
                      )
                      .finally(() => setExporting(false));
                  }}
                >
                  {exporting ? "Opening…" : "Export private key"}
                </button>
              </div>

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
