import type { Metadata } from "next";
import Link from "next/link";
import { MARKETS, fmt, premium } from "@/lib/mock";
import { DocShell } from "./DocShell";
import { DOC_GROUPS } from "./nav";

export const metadata: Metadata = {
  title: "Start here — Parallel docs",
  description:
    "Two prices for the dollar, and what Parallel does with the gap between them.",
};

export default function StartHerePage() {
  const ngn = MARKETS[0]!;
  const currency = ngn.name.split(" ").slice(1).join(" ");

  return (
    <DocShell
      href="/docs"
      title="How Parallel works"
      lead="No jargon, no assumed knowledge. If you have never touched crypto, start at the top and read down — each page builds on the one before it."
    >
      <p>
        In many countries there are <b>two prices for the US dollar</b>. There is the
        official rate a central bank publishes, and there is the rate people actually pay
        when they buy dollars — on the street, in a shop, through a friend. The second one
        is usually higher, and it is the one that decides what your money is really worth.
      </p>
      <p>
        Right now, {currency} buyers pay about{" "}
        <b className="mono">{fmt(ngn.px, ngn.dp)}</b> per dollar on the street, while the
        official rate says <b className="mono">{fmt(ngn.off, ngn.dp)}</b> — a gap of{" "}
        <b>{premium(ngn).toFixed(1)}%</b>. Banks and brokers quote the official number.
        Parallel quotes the real one.
      </p>
      <p>
        Parallel lets you do two things with that: <b>trade</b> the dollar against your
        currency, or <b>protect</b> savings you already hold. Everything runs on Solana,
        and right now everything is on a test network with play money.
      </p>
      <div className="doc-note">
        <b>Devnet only.</b> Every balance on Parallel today is a test token. It has no cash
        value, you cannot withdraw it, and you cannot lose real money here.
      </div>

      <h2 className="doc-h">What is in here</h2>
      <div className="doc-index">
        {DOC_GROUPS.map((g) => (
          <div key={g.title}>
            <div className="doc-nav-title">{g.title.toUpperCase()}</div>
            {g.pages
              .filter((p) => p.href !== "/docs")
              .map((p) => (
                <Link key={p.href} href={p.href} className="doc-index-card">
                  <b>{p.label}</b>
                  <span>{p.blurb}</span>
                </Link>
              ))}
          </div>
        ))}
      </div>
    </DocShell>
  );
}
