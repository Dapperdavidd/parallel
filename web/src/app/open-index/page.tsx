import type { Metadata } from "next";
import Link from "next/link";
import { SiteTop } from "@/components/SiteTop";
import { Footer } from "@/components/Footer";
import { fmt } from "@/lib/mock";
import { latestTicks, listMarkets, registryMeta } from "@/lib/server/data";
import { MARKETS } from "@/lib/mock";
import { explorerTx } from "@/lib/explorer";

export const metadata: Metadata = {
  title: "Open index — Parallel",
  description:
    "Every price Parallel uses, every source behind it, and the rules that turn " +
    "them into one number. Published so you can check it.",
};

// Prices move every two minutes; this page must never be served from a cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The open index page (PRD F11).
 *
 * "Shows method, rules, every source and its latest price for every market."
 *
 * Rendered on the server straight from what the index service wrote, so the
 * page is the data rather than a description of it. Every reading is shown —
 * the ones in the median, the ones dropped as outliers with how far out they
 * were, and the ones that failed with the reason. A market that is paused says
 * so and says why. The point of the product is that the number is checkable,
 * so nothing here is rounded away or quietly omitted.
 */

const sourceLabel = (id: string): string =>
  ({
    quidax: "Quidax",
    luno: "Luno",
    okx_p2p: "OKX P2P",
    valr: "VALR",
    binance_spot: "Binance spot",
    binance_p2p: "Binance P2P",
    criptoya: "CriptoYa",
    bitso: "Bitso",
    btcturk: "BtcTurk",
    wazirx: "WazirX",
    coinsph: "Coins.ph",
  })[id] ?? id;

const ago = (iso: string | null): string => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} seconds ago`;
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  return `${Math.round(s / 3600)} hours ago`;
};

export default async function IndexPage() {
  const [markets, ticks, meta] = await Promise.all([
    listMarkets(),
    latestTicks(),
    registryMeta(),
  ]);

  // Presentation details — symbol, long name, decimal places — have no live
  // source, so they still come from the one sample file.
  const meta_ = new Map(MARKETS.map((m) => [m.c, m]));

  const lastPush = [...ticks.values()]
    .filter((t) => t.pushedTx)
    .sort((a, b) => b.ts.localeCompare(a.ts))[0];
  const freshest = [...ticks.values()].sort((a, b) => b.ts.localeCompare(a.ts))[0];
  const paused = [...ticks.values()].filter((t) => t.status !== "ok");

  return (
    <main id="main">
      <SiteTop />

      <div className="doc" style={{ gridTemplateColumns: "1fr" }}>
        <article className="doc-body" style={{ maxWidth: 1080 }}>
          <p className="eyebrow">OPEN INDEX</p>
          <h1 className="doc-title">Every price, and where it came from</h1>
          <p className="doc-lead">
            Parallel prices each market as the median of several public venues where people
            actually buy and sell digital dollars. Nothing here is a quote we invented — this
            page shows each source, its latest reading, and whether it counted.
          </p>

          <div className="doc-note" style={{ marginBottom: 28 }}>
            Sources more than 3% from the median are dropped. A market needs at least two live
            sources or it pauses. The median is pushed on-chain when it moves more than 0.1%
            or ten minutes pass.
            {freshest && <> Index last calculated <b>{ago(freshest.ts)}</b>.</>}
            {lastPush && <> Last on-chain push <b>{ago(lastPush.ts)}</b>.</>}
            {paused.length > 0 && (
              <>
                {" "}
                <b style={{ color: "var(--amb)" }}>
                  {paused.length} market{paused.length === 1 ? "" : "s"} paused.
                </b>
              </>
            )}{" "}
            <Link href="/docs/prices" className="doc-link">
              Read the full method →
            </Link>
          </div>

          {markets.length === 0 && (
            <p style={{ color: "var(--ink2)" }}>
              No markets are registered yet. Run the index service and the market creation
              script, then reload.
            </p>
          )}

          <div className="idx-grid">
            {markets.map((m) => {
              const t = ticks.get(m.id);
              const look = meta_.get(m.currency);
              const dp = look?.dp ?? 2;
              const used = new Set(t?.sourcesUsed ?? []);
              const droppedBy = new Map((t?.dropped ?? []).map((d) => [d.id, d]));
              const failedBy = new Map((t?.failed ?? []).map((f) => [f.id, f]));
              const isPaused = !t || t.status !== "ok";

              return (
                <section className="idx-card" key={m.id}>
                  <header className="idx-head">
                    <span
                      className="cur sm"
                      style={{ fontSize: (look?.sym.length ?? 1) > 2 ? 10 : 12 }}
                    >
                      {look?.sym ?? m.currency.slice(0, 2)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ display: "block", fontWeight: 500 }}>{m.id}</b>
                      <span style={{ fontSize: 12, color: "var(--ink3)" }}>
                        {look?.name ?? m.currency}
                      </span>
                    </span>
                    <span className="status">
                      <span
                        className="dot"
                        style={{
                          background: isPaused
                            ? "var(--dn)"
                            : m.status === "live"
                              ? "var(--up)"
                              : "var(--amb)",
                        }}
                      />
                      {isPaused ? "Paused" : m.status === "live" ? "Live" : "Beta"}
                    </span>
                  </header>

                  <div className="idx-median">
                    <span>Median</span>
                    <b className="mono">{t?.median === null || !t ? "—" : fmt(t.median, dp)}</b>
                  </div>

                  {/* Every reading, labelled by what happened to it. */}
                  {(t?.breakdown ?? []).map((r) => {
                    const drop = droppedBy.get(r.id);
                    const fail = failedBy.get(r.id);
                    const inMedian = used.has(r.id);
                    return (
                      <div className="idx-row" key={r.id}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            className="dot"
                            style={{
                              background: inMedian
                                ? "var(--up)"
                                : fail
                                  ? "var(--dn)"
                                  : "var(--ink3)",
                            }}
                          />
                          {sourceLabel(r.id)}
                          {drop && (
                            <span style={{ fontSize: 11, color: "var(--ink3)" }}>
                              dropped {drop.deviationPct > 0 ? "+" : ""}
                              {drop.deviationPct.toFixed(1)}%
                            </span>
                          )}
                        </span>
                        <b className="mono" style={fail ? { color: "var(--ink3)" } : undefined}>
                          {fail ? fail.error.slice(0, 22) : r.rate !== undefined ? fmt(r.rate, dp) : "—"}
                        </b>
                      </div>
                    );
                  })}

                  {isPaused && t?.reason && (
                    <div style={{ fontSize: 12, color: "var(--amb)", lineHeight: 1.5 }}>
                      {t.reason} — no new positions; open positions can still close.
                    </div>
                  )}

                  <div className="idx-foot">
                    <span>
                      Official{" "}
                      <b className="mono">{t?.official ? fmt(t.official, dp) : "—"}</b>
                    </span>
                    {t?.premiumPct !== null && t?.premiumPct !== undefined && (
                      <span style={{ color: "var(--amb)" }}>
                        {t.premiumPct >= 0 ? "+" : ""}
                        {t.premiumPct.toFixed(1)}% street premium
                      </span>
                    )}
                  </div>

                  {/* The on-chain write, so a reader can verify it themselves. */}
                  <div className="idx-foot" style={{ borderTop: "none", paddingTop: 0 }}>
                    {t?.pushedTx ? (
                      <a
                        className="idx-link"
                        href={explorerTx(t.pushedTx)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        On-chain at slot {t.pushedSlot} →
                      </a>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--ink3)" }}>
                        Held — within 0.1% of the last push
                      </span>
                    )}
                  </div>

                  <Link href={`/app/trade?m=${m.currency}`} className="idx-link">
                    Trade {m.id} →
                  </Link>
                </section>
              );
            })}
          </div>

          {meta && (
            <div style={{ marginTop: 30 }}>
              <h2 className="doc-h">On-chain</h2>
              <table className="doc-table">
                <tbody>
                  <tr>
                    <th>Cluster</th>
                    <td>Solana devnet</td>
                  </tr>
                  <tr>
                    <th>Percolator program</th>
                    <td>
                      <code className="doc-code">{meta.percolatorProgram}</code>
                    </td>
                  </tr>
                  <tr>
                    <th>Collateral mint</th>
                    <td>
                      <code className="doc-code">{meta.collateralMint}</code>
                    </td>
                  </tr>
                  <tr>
                    <th>Oracle authority</th>
                    <td>
                      <code className="doc-code">{meta.oracleAuthority}</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <p style={{ fontSize: 13, color: "var(--ink3)", marginTop: 26, lineHeight: 1.7 }}>
            Devnet beta. The index recalculates every two minutes; this page shows the latest
            calculation at the moment it was loaded. Official rates are a sanity check only and
            never form part of the median.
          </p>
        </article>
      </div>

      <Footer />
    </main>
  );
}
