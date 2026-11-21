import type { Metadata } from "next";
import { DocShell, H3 } from "../DocShell";

export const metadata: Metadata = {
  title: "How trading works — Parallel docs",
  description:
    "Perpetuals, going long or short the dollar, leverage, liquidation, funding and fees.",
};

export default function TradingPage() {
  return (
    <DocShell
      href="/docs/trading"
      title="How trading works"
      lead="Everything you need before you open a position, including the parts that can cost you money."
    >
      <H3>What a perpetual is</H3>
      <p>
        A <b>perpetual</b> is a contract that tracks a price. You are not buying dollars or
        naira — you are taking a position on which way the rate moves. There is no expiry
        date, so you hold it for as long as you like and close it whenever you want.
      </p>

      <H3>Long and short</H3>
      <p>
        Every market on Parallel is written as <b>USD/your currency</b>. So:
      </p>
      <ul className="doc-list">
        <li>
          <b>Long USD</b> — you think the dollar will get stronger, meaning your currency
          gets weaker. You profit if the rate goes up.
        </li>
        <li>
          <b>Short USD</b> — you think the dollar will get weaker, meaning your currency
          gets stronger. You profit if the rate goes down.
        </li>
      </ul>

      <H3>Leverage, and why it cuts both ways</H3>
      <p>
        Leverage lets you hold a position larger than the money you put in. Put in 100 and
        choose 5x, and you are holding 500 worth. A 1% move now changes your money by 5%,
        not 1% — <b>in both directions</b>.
      </p>
      <p>
        Live markets allow up to <b>5x</b>, newer ones up to <b>2x</b>. That cap is fixed
        when the market is created and cannot be raised later.
      </p>

      <H3>Liquidation</H3>
      <p>
        If the price moves far enough against you, the money you put in is no longer enough
        to cover the loss, and the position is <b>closed for you</b>. This is liquidation,
        and you lose what you committed to that position — never more.
      </p>
      <p>
        The app shows the liquidation price <b>before</b> you confirm anything. Higher
        leverage puts it closer to the current price. At 2x it is far away. At 5x it is
        much nearer.
      </p>

      <H3>Funding</H3>
      <p>
        Perpetuals have no expiry, so something has to keep them tethered to the real
        price. That is <b>funding</b>: a small payment that passes between the two sides
        periodically. When more people are long than short, longs pay shorts, and that
        nudges the contract price back toward the index. It is usually a tiny fraction of
        a percent.
      </p>

      <H3>Fees</H3>
      <p>
        A trading fee of <b>0.06%</b> of position size is charged when you open. On devnet
        the network fees are covered for you.
      </p>
    </DocShell>
  );
}
