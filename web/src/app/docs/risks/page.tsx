import type { Metadata } from "next";
import { DocShell } from "../DocShell";

export const metadata: Metadata = {
  title: "Risks — Parallel docs",
  description:
    "Leverage, street prices, source failures, thin markets and beta software — what can go wrong on Parallel.",
};

export default function RisksPage() {
  return (
    <DocShell
      href="/docs/risks"
      title="Risks"
      lead="Read this part properly."
    >
      <ul className="doc-list">
        <li>
          <b>Leverage can wipe out your position.</b> A position can be liquidated and you
          lose the margin you committed. The higher the leverage, the smaller the move
          needed.
        </li>
        <li>
          <b>Street prices are not official prices.</b> Our index tracks what people
          actually pay, which can differ sharply from any government rate. That gap is the
          point of the product, but it means our number will not match a bank&apos;s.
        </li>
        <li>
          <b>Sources can fail.</b> The venues we read are public services with no guarantee
          to us. If too few respond, the market pauses — deliberately, so it never prices
          off thin air.
        </li>
        <li>
          <b>Thin markets move.</b> Newer markets have fewer participants, so prices can
          jump further than you expect. They are capped at lower leverage for that reason.
        </li>
        <li>
          <b>This is beta software on a test network.</b> It has not been audited. Do not
          treat it as a finished financial product.
        </li>
        <li>
          <b>Nothing here is financial advice.</b> You are responsible for your own
          decisions.
        </li>
      </ul>
      <div className="doc-note">
        <b>Risk disclosure.</b> Parallel is a beta running on Solana devnet. Balances are
        test tokens with no cash value. Perpetual futures are leveraged products: a
        position can be liquidated and you can lose the margin you committed. Prices come
        from public exchange and peer-to-peer venues and can differ from any official rate.
      </div>
    </DocShell>
  );
}
