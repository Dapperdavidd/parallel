import type { Metadata } from "next";
import { MARKETS, fmt } from "@/lib/mock";
import { DocShell } from "../DocShell";

export const metadata: Metadata = {
  title: "How hedging works — Parallel docs",
  description:
    "Hedging is not trading. One 1x position, sized to your savings, to cancel out a falling currency.",
};

export default function HedgingPage() {
  const ngn = MARKETS[0]!;
  const currency = ngn.name.split(" ").slice(1).join(" ");

  return (
    <DocShell
      href="/docs/hedging"
      title="How hedging works"
      lead="Hedging is not trading. You are not trying to make money — you are trying to stop losing it."
    >
      <p>
        Say you hold {ngn.sym}2,000,000 and you need it in a month. Today that is about{" "}
        <b>${fmt(2_000_000 / ngn.px)}</b>. If the {currency} weakens 10% before you spend
        it, the same money buys roughly 10% fewer dollars. You did nothing wrong and you
        are poorer.
      </p>
      <p>A hedge cancels that out:</p>
      <ol className="doc-list">
        <li>You tell Parallel what you hold and when you need it.</li>
        <li>
          We suggest <b>one position</b> — long USD at 1x, sized to the dollar value of your
          savings. No leverage, nothing clever.
        </li>
        <li>
          If your currency falls, your savings lose value and the position gains almost
          exactly the same amount. The two cancel.
        </li>
        <li>
          If your currency strengthens, the reverse happens. You gave up the upside to
          remove the downside. That is the trade.
        </li>
      </ol>
      <p>
        Hedge mode shows you the full table before you commit — what happens at −10%, −5%,
        no change, +5% and +10% — so there are no surprises.
      </p>
    </DocShell>
  );
}
