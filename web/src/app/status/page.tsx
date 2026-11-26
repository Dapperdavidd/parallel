import type { Metadata } from "next";
import Link from "next/link";
import { SiteTop } from "@/components/SiteTop";
import { Footer } from "@/components/Footer";
import { StatusBoard } from "@/components/StatusBoard";

export const metadata: Metadata = {
  title: "System status — Parallel",
  description:
    "Whether Parallel is trading, how fresh each market's price is, and which markets are paused and why.",
};

/**
 * The status page.
 *
 * Deliberately not a page of green ticks. It reads the same two endpoints the
 * app itself reads — `/api/ready` and `/api/markets` — so it cannot be green
 * while the app is broken, which is the failure mode of every status page
 * maintained by hand.
 *
 * It also states what we are aiming at, because "operational" means nothing
 * without a number beside it. The objectives are the ones in
 * docs/OPERATIONS.md, and they are modest on purpose: four of the thirteen
 * markets depend on peer-to-peer venues that block our egress, and promising
 * all thirteen would be a promise about somebody else's firewall.
 */
export default function StatusPage() {
  return (
    <>
      <SiteTop />
      <main id="main" className="wrap" style={{ paddingTop: 110, paddingBottom: 40 }}>
        <p className="eyebrow">STATUS</p>
        <h1 style={{ fontSize: "clamp(34px,4.4vw,56px)", letterSpacing: "-.035em", margin: "6px 0 10px" }}>
          Is Parallel working?
        </h1>
        <p style={{ color: "var(--ink2)", fontSize: 17, lineHeight: 1.6, maxWidth: "60ch", margin: 0 }}>
          Read live from the same endpoints the app uses, every thirty seconds. Nothing on this
          page is set by hand, so it cannot say &ldquo;operational&rdquo; while trading is down.
        </p>

        <StatusBoard />

        <section style={{ marginTop: 54 }}>
          <h2 style={{ fontSize: 22, letterSpacing: "-.02em" }}>What we are aiming at</h2>
          <div className="mtable" style={{ border: "1px solid var(--ln)", marginTop: 14 }}>
            {[
              [
                "Price freshness",
                "Under 6 minutes",
                "The keeper measures every 2 minutes, so 6 allows two bad passes before anyone is misled.",
              ],
              [
                "Markets priced",
                "At least 9 of 13",
                "Four markets depend on peer-to-peer venues that block our egress. Promising 13 would be a promise about somebody else's firewall.",
              ],
              [
                "On-chain mark",
                "Within 0.1% or 10 minutes",
                "The push rule itself. A breach means the keeper is not pushing.",
              ],
              [
                "Trading available",
                "99.5% of the month",
                "The only failure a trader experiences directly.",
              ],
            ].map(([what, target, why]) => (
              <div className="srow" key={what}>
                <b>{what}</b>
                <span className="mono">{target}</span>
                <span className="swhy">{why}</span>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginTop: 44 }}>
          <h2 style={{ fontSize: 22, letterSpacing: "-.02em" }}>Known limitations</h2>
          <ul
            style={{
              margin: "12px 0 0",
              paddingLeft: 20,
              color: "var(--ink2)",
              fontSize: 15,
              lineHeight: 1.7,
              maxWidth: "70ch",
            }}
          >
            <li>
              <b style={{ color: "var(--ink)" }}>Four markets pause themselves.</b> EGP, GHS, KES
              and PKR usually sit on one reachable price source. Two is our floor for a median, so
              they pause rather than quote a number we do not believe.
            </li>
            <li>
              <b style={{ color: "var(--ink)" }}>The price keeper runs on one machine.</b> If it
              stops, prices go stale and markets pause themselves — the safe failure, but still an
              outage.
            </li>
            <li>
              <b style={{ color: "var(--ink)" }}>No funding payments.</b> The Percolator build on
              devnet does not accrue funding through its price path. Verified on-chain, and the app
              shows zero rather than inventing payments.
            </li>
            <li>
              <b style={{ color: "var(--ink)" }}>Devnet only.</b> Test tokens, no cash value, no
              mainnet date. See the <Link href="/docs/risks">risk disclosure</Link>.
            </li>
          </ul>
        </section>

        <p style={{ marginTop: 40, fontSize: 14, color: "var(--ink3)" }}>
          A problem this page does not show?{" "}
          <Link href="/docs/faq">Start with the questions</Link>. Every API response carries an{" "}
          <code className="doc-code">X-Request-Id</code> header — quoting it leads us straight to
          what happened.
        </p>
      </main>
      <Footer />
    </>
  );
}
