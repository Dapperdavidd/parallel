import type { Metadata } from "next";
import Link from "next/link";
import { SiteTop } from "@/components/SiteTop";
import { Footer } from "@/components/Footer";
import {
  MARKETS,
  fmt,
  premium,
  sourceReadings,
  LAST_PUSH_SECONDS_AGO,
} from "@/lib/mock";

export const metadata: Metadata = {
  title: "Open index — Parallel",
  description:
    "Every price Parallel uses, every source behind it, and the rules that turn " +
    "them into one number. Published so you can check it.",
};

/**
 * The open index page (PRD F11).
 *
 * This is what "Open index" in the footer points at: the price, every source
 * that produced it, which ones are in the median, and when it last went
 * on-chain. The whole pitch is that the number is checkable, so it has to be
 * published somewhere.
 *
 * PHASE 2 — figures come from the mock file. Phase 3 reads `index_ticks`,
 * which spike 5 already writes with exactly this shape.
 */
export default function IndexPage() {
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
            or ten minutes pass — last push{" "}
            <b>{LAST_PUSH_SECONDS_AGO} seconds ago</b>.{" "}
            <Link href="/docs/prices" className="doc-link">
              Read the full method →
            </Link>
          </div>

          <div className="idx-grid">
            {MARKETS.map((m) => {
              const reads = sourceReadings(m);
              const p = premium(m);
              return (
                <section className="idx-card" key={m.c}>
                  <header className="idx-head">
                    <span className="cur sm" style={{ fontSize: m.sym.length > 2 ? 10 : 12 }}>
                      {m.sym}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ display: "block", fontWeight: 500 }}>USD/{m.c}</b>
                      <span style={{ fontSize: 12, color: "var(--ink3)" }}>{m.name}</span>
                    </span>
                    <span className="status">
                      <span
                        className="dot"
                        style={{ background: m.st === "Live" ? "var(--up)" : "var(--amb)" }}
                      />
                      {m.st}
                    </span>
                  </header>

                  <div className="idx-median">
                    <span>Median</span>
                    <b className="mono">{fmt(m.px, m.dp)}</b>
                  </div>

                  {reads.map((r) => (
                    <div className="idx-row" key={r.name}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          className="dot"
                          style={{ background: r.inMedian ? "var(--up)" : "var(--ink3)" }}
                        />
                        {r.name}
                      </span>
                      <b className="mono">{fmt(r.rate, m.dp)}</b>
                    </div>
                  ))}

                  <div className="idx-foot">
                    <span>
                      Official <b className="mono">{fmt(m.off, m.dp)}</b>
                    </span>
                    <span style={{ color: "var(--amb)" }}>
                      {p >= 0 ? "+" : ""}
                      {p.toFixed(1)}% street premium
                    </span>
                  </div>

                  <Link href={`/app/trade?m=${m.c}`} className="idx-link">
                    Trade USD/{m.c} →
                  </Link>
                </section>
              );
            })}
          </div>

          <p style={{ fontSize: 13, color: "var(--ink3)", marginTop: 26, lineHeight: 1.7 }}>
            Devnet beta. Figures refresh every two minutes in production; on this page they are
            a snapshot. Official rates are a sanity check only and never form part of the
            median.
          </p>
        </article>
      </div>

      <Footer />
    </main>
  );
}
