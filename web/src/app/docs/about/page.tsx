import type { Metadata } from "next";
import Link from "next/link";
import { DocShell } from "../DocShell";

export const metadata: Metadata = {
  title: "About Parallel — Parallel docs",
  description:
    "Why Parallel exists, what it is deliberately not, and the engine it settles on.",
};

export default function AboutPage() {
  return (
    <DocShell
      href="/docs/about"
      title="About Parallel"
      lead="Why this exists, and what it runs on."
    >
      <p>
        Billions of people earn and spend in currencies that move against the dollar, and
        the tools to do anything about it sit with offshore banks. No on-chain venue lists
        these currencies at all. Parallel puts them on Solana.
      </p>
      <p>
        The product is deliberately narrow: thirteen currencies, one open index, two ways
        to use it. Built in Lagos, settled on Solana.
      </p>
      <p>
        Parallel runs on <b>Percolator</b>, an open-source perpetuals engine. We did not
        write our own exchange — we supply the prices, the keeper and the app, and the
        engine handles margin, funding and liquidations.
      </p>

      <h2 className="doc-h2">Credits</h2>
      <p>
        Charts are drawn with{" "}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" className="doc-link">
          TradingView
        </a>
        &rsquo;s Lightweight Charts, used under the Apache 2.0 licence. Prices are the
        venues&rsquo; own, listed on the{" "}
        <Link href="/open-index" className="doc-link">
          open index
        </Link>
        . The perpetuals engine is Percolator.
      </p>

      <div className="doc-cta">
        <Link href="/app/trade" className="btn btn-pri" style={{ height: 50, padding: "0 26px" }}>
          Open the app
        </Link>
        <Link href="/open-index" className="btn btn-ghost" style={{ height: 50, padding: "0 22px" }}>
          See the live index
        </Link>
      </div>
    </DocShell>
  );
}
