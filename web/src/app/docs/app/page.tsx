import type { Metadata } from "next";
import { DocShell, H3 } from "../DocShell";

export const metadata: Metadata = {
  title: "A tour of the app — Parallel docs",
  description: "What each screen in Parallel does, and where your wallet comes from.",
};

export default function AppTourPage() {
  return (
    <DocShell
      href="/docs/app"
      title="A tour of the app"
      lead="Four screens. Here is what each one is for."
    >
      <ul className="doc-list">
        <li>
          <b>Trade</b> — the main screen. Pick a market at the top left, read the chart,
          and open a position from the panel on the right. The live trades column shows
          fills as they happen.
        </li>
        <li>
          <b>Markets</b> — all thirteen currencies with their street price, the official
          rate, the gap between them, and the leverage each allows.
        </li>
        <li>
          <b>Hedge</b> — the plain-language flow described in the previous page.
        </li>
        <li>
          <b>Portfolio</b> — your balance, your equity curve, your open positions and the
          Add money button.
        </li>
      </ul>

      <H3>Your wallet</H3>
      <p>
        When you sign in with an email, a Solana wallet is created for you. There is no
        seed phrase to write down and no extension to install. The wallet is yours and you
        can export it whenever you want.
      </p>
    </DocShell>
  );
}
