import type { Metadata } from "next";
import Link from "next/link";
import { SiteTop } from "@/components/SiteTop";
import { Footer } from "@/components/Footer";
import { MARKETS, compactUsd, fmt } from "@/lib/mock";
import { vaultSnapshot } from "@/lib/server/vaults";

export const metadata: Metadata = {
  title: "Liquidity vaults — Parallel",
  description:
    "Parallel takes the other side of every trade from one isolated vault per " +
    "market. This page shows each vault's capital, its inventory and how close " +
    "the market is to its limits, read from the chain.",
};

// Vault state changes with every trade; never serve this from a cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The liquidity vault page (PRD F10, read half).
 *
 * Parallel is the counterparty, so "where is the money and how exposed is it"
 * is a fair question to ask of us. Every figure here is an account read at one
 * slot: the vault's capital and stored PnL, the inventory it is carrying, and
 * the market's open interest against the caps the trade route refuses to
 * exceed. A vault that cannot be read says so rather than showing a zero.
 *
 * Isolation is the point of the layout: one card per currency, because a loss
 * on one market cannot reach another's capital or another's key.
 */

export default async function VaultsPage() {
  const { slot, vaults, totals } = await vaultSnapshot();

  // Symbol and decimal places have no live source; they stay in the sample file.
  const look = new Map(MARKETS.map((m) => [m.c, m]));
  const unreadable = vaults.filter((v) => v.error).length;
  const carrying = vaults.filter((v) => v.inventorySide && v.inventorySide !== "flat").length;

  return (
    <main id="main">
      <SiteTop />

      <div className="doc" style={{ gridTemplateColumns: "1fr" }}>
        <article className="doc-body" style={{ maxWidth: 1080 }}>
          <p className="eyebrow">LIQUIDITY</p>
          <h1 className="doc-title">Who takes the other side</h1>
          <p className="doc-lead">
            Every position on Parallel is matched against a vault we control — one per
            currency, funded with devnet test USDC. Nothing is pooled across markets, so a bad
            day in one currency cannot reach another. These are the real accounts, read from
            the chain.
          </p>

          <div className="doc-note" style={{ marginBottom: 28 }}>
            {vaults.length} vault{vaults.length === 1 ? "" : "s"}, holding{" "}
            <b>{compactUsd(totals.equityUsdc)}</b> of test USDC between them.{" "}
            {carrying === 0 ? (
              <>No vault is carrying inventory right now.</>
            ) : (
              <>
                <b>{carrying}</b> carrying inventory.
              </>
            )}{" "}
            Read at slot <b className="mono">{slot.toLocaleString()}</b>.
            {unreadable > 0 && (
              <>
                {" "}
                <b style={{ color: "var(--amb)" }}>
                  {unreadable} account{unreadable === 1 ? "" : "s"} unreadable.
                </b>
              </>
            )}{" "}
            <Link href="/docs/app" className="doc-link">
              How trading works →
            </Link>
          </div>

          {vaults.length === 0 && (
            <p style={{ color: "var(--ink2)" }}>
              No liquidity vaults are registered yet. Run <code>npm run vaults:create</code> and
              reload.
            </p>
          )}

          <div className="idx-grid">
            {vaults.map((v) => {
              const meta = look.get(v.code);
              const pct = v.utilisation === null ? null : Math.min(100, v.utilisation * 100);
              const inventory = v.inventoryUsdc ?? 0;

              return (
                <section className="idx-card" key={v.marketId}>
                  <header className="idx-head">
                    <span
                      className="cur sm"
                      style={{ fontSize: (meta?.sym.length ?? 1) > 2 ? 10 : 12 }}
                    >
                      {meta?.sym ?? v.code.slice(0, 2)}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <b>{v.marketId}</b>
                      <span style={{ fontSize: 12, color: "var(--ink3)" }}>
                        {meta?.name ?? v.code} · up to {v.maxLeverage}x
                      </span>
                    </div>
                    <span className="grow" />
                    <span className="mono" style={{ fontSize: 13 }}>
                      {v.quote === null ? "—" : fmt(v.quote, meta?.dp ?? 2)}
                    </span>
                  </header>

                  {v.error ? (
                    <p style={{ color: "var(--amb)", fontSize: 13, margin: "10px 0 0" }}>
                      {v.error}
                    </p>
                  ) : (
                    <>
                      <div className="row">
                        Capital<b className="mono">{fmt(v.capitalUsdc ?? 0)}</b>
                      </div>
                      <div className="row">
                        Stored P&amp;L
                        <b
                          className="mono"
                          style={{ color: (v.pnlUsdc ?? 0) >= 0 ? "var(--up)" : "var(--dn)" }}
                        >
                          {(v.pnlUsdc ?? 0) >= 0 ? "+" : "−"}
                          {fmt(Math.abs(v.pnlUsdc ?? 0))}
                        </b>
                      </div>
                      <div className="row">
                        Inventory
                        <b
                          className="mono"
                          style={{
                            color:
                              v.inventorySide === "flat"
                                ? "var(--ink2)"
                                : inventory >= 0
                                  ? "var(--up)"
                                  : "var(--dn)",
                          }}
                        >
                          {v.inventorySide === "flat"
                            ? "flat"
                            : `${inventory >= 0 ? "long " : "short "}${fmt(Math.abs(inventory))}`}
                        </b>
                      </div>
                      <div className="row">
                        Open interest
                        <b className="mono">
                          {fmt(
                            Math.max(v.openInterestLongUsdc ?? 0, v.openInterestShortUsdc ?? 0),
                          )}{" "}
                          / {compactUsd(v.maxOpenInterestUsdc)}
                        </b>
                      </div>

                      {/* The cap the trade route enforces, as a bar, so "how
                          close is this market to full" is readable at a glance. */}
                      <div
                        aria-hidden
                        style={{
                          height: 4,
                          borderRadius: 4,
                          background: "var(--ln)",
                          overflow: "hidden",
                          margin: "4px 0 8px",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct ?? 0}%`,
                            background:
                              (pct ?? 0) > 80 ? "var(--dn)" : (pct ?? 0) > 50 ? "var(--amb)" : "var(--up)",
                          }}
                        />
                      </div>

                      <div className="row">
                        Max per trade<b className="mono">{compactUsd(v.maxNotionalUsdc)}</b>
                      </div>
                    </>
                  )}

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 10,
                      fontSize: 12,
                      marginTop: 10,
                    }}
                  >
                    <a
                      href={`https://explorer.solana.com/address/${v.portfolio}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      className="doc-link"
                    >
                      Vault portfolio ↗
                    </a>
                    <a
                      href={`https://explorer.solana.com/address/${v.market}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      className="doc-link"
                    >
                      Market ↗
                    </a>
                  </div>
                </section>
              );
            })}
          </div>

          <h2 className="doc-h2">Why the caps exist</h2>
          <p>
            The engine does not know about these limits — they are enforced by our own trade
            route before it will co-sign anything. A trade larger than the per-trade cap, or one
            that would push a market past its open-interest cap, is refused rather than matched.
            They are deliberately small: this is a devnet build, and a vault that cannot be
            drained by one position cannot be drained by one bug either.
          </p>

          <h2 className="doc-h2">What is not here yet</h2>
          <p>
            The PRD also describes letting anyone deposit into a vault and earn a share of the
            fees. That part is not built, and it is not a small addition: it needs share
            accounting, a withdrawal path, and a fee to actually share — trades on this build
            are matched with a zero fee. Until those exist, the vaults are funded by us alone,
            and this page says so rather than implying a yield that nobody is earning.
          </p>

          <p style={{ color: "var(--ink3)", fontSize: 13, marginTop: 18 }}>
            Devnet test USDC, with no cash value. Every address above is checkable on the
            Solana explorer.
          </p>
        </article>
      </div>

      <Footer />
    </main>
  );
}
