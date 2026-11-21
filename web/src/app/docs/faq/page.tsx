import type { Metadata } from "next";
import Link from "next/link";
import { MARKETS, premium } from "@/lib/mock";
import { DocShell, H3 } from "../DocShell";

export const metadata: Metadata = {
  title: "Common questions — Parallel docs",
  description: "Short answers to the questions people ask about Parallel first.",
};

export default function FaqPage() {
  const ngn = MARKETS[0]!;

  return (
    <DocShell
      href="/docs/faq"
      title="Common questions"
      lead="Short answers to the things people ask first."
    >
      <H3>Do I need to know crypto?</H3>
      <p>
        No. Sign in with an email and the wallet is made for you. You never handle a seed
        phrase or pay a network fee.
      </p>

      <H3>Is this real money?</H3>
      <p>
        Not today. Everything runs on Solana devnet with test tokens that have no value.
        That is why you can get 10,000 of them for free.
      </p>

      <H3>Why is your price different from my bank&apos;s?</H3>
      <p>
        Because banks quote the official rate and we quote the street rate. On the naira
        that gap is currently about {premium(ngn).toFixed(1)}%. Neither is wrong — they
        measure different things, and we show both side by side so you can see it.
      </p>

      <H3>What happens if a price source goes down?</H3>
      <p>
        If a market falls below two working sources it pauses. You cannot open new
        positions, but you can always close what you hold. We would rather stop than guess.
      </p>

      <H3>Can I lose more than I put in?</H3>
      <p>No. The most you can lose on a position is the margin you committed to it.</p>

      <H3>Which currencies can I trade?</H3>
      <p>
        Thirteen at launch: {MARKETS.map((m) => m.c).join(", ")}.{" "}
        <Link href="/app/markets" className="doc-link">
          See them all →
        </Link>
      </p>

      <H3>When is mainnet?</H3>
      <p>
        After the devnet beta has run properly, the contracts have been audited, and the
        legal position is clear in each country. We would rather be late than careless.
      </p>
    </DocShell>
  );
}
