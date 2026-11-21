import type { Metadata } from "next";
import Link from "next/link";
import { MARKETS } from "@/lib/mock";
import { DocShell } from "../DocShell";

export const metadata: Metadata = {
  title: "Where the price comes from — Parallel docs",
  description:
    "How the Parallel street-rate index is built: several public venues, the median, outliers dropped, published on-chain.",
};

export default function PricesPage() {
  const ngn = MARKETS[0]!;

  return (
    <DocShell
      href="/docs/prices"
      title="Where the price comes from"
      lead="A trading product is only as honest as its price. Ours is built in the open, and you can check every step."
    >
      <ol className="doc-list">
        <li>
          <b>We read several places at once.</b> For each currency we poll public exchanges
          and peer-to-peer markets where people genuinely buy and sell digital dollars —
          for {ngn.c} that is {ngn.src.join(", ")}.
        </li>
        <li>
          <b>We take the middle, not the average.</b> We sort the prices and take the
          median. One venue having a strange moment cannot drag the price around, which an
          average would allow.
        </li>
        <li>
          <b>We throw out anything wild.</b> Any source more than 3% away from the middle
          is dropped, and the middle is worked out again without it.
        </li>
        <li>
          <b>Two sources minimum.</b> If a market drops below two working sources it{" "}
          <b>pauses</b> — you cannot open a new position, but you can always close one you
          already have.
        </li>
        <li>
          <b>We sanity-check against the official rate.</b> If our price drifts more than
          15% from the official rate, the market pauses and we look at it.
        </li>
        <li>
          <b>We publish it on-chain.</b> Every two minutes, and whenever the price moves
          more than 0.1%, the number is written to Solana where anyone can read it.
        </li>
      </ol>
      <p>
        Every single calculation is stored with its per-source breakdown, so you can always
        see which venues produced a price and when.{" "}
        <Link href="/open-index" className="doc-link">
          See the live index →
        </Link>
      </p>
    </DocShell>
  );
}
