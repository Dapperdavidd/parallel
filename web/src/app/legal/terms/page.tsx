import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "../LegalShell";
import { FAUCET_USDC_TARGET } from "@/lib/faucet";
import { fmt, MARKETS } from "@/lib/mock";

export const metadata: Metadata = {
  title: "Terms of use — Parallel",
  description:
    "What Parallel is, what it is not, and the terms on which you can use the devnet beta.",
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of use"
      updated="26 November 2026"
      lead="Short, because the product is small and the honest version of these terms is short. Parallel is a devnet beta. Nothing here involves money."
    >
      <h2>What Parallel is</h2>
      <p>
        Parallel is software that measures the street exchange rate for {MARKETS.length}{" "}
        emerging-market currencies, publishes every reading, and lets you open a perpetual futures
        position against that rate on the Solana <b>devnet</b> test network.
      </p>
      <p>
        We are the counterparty to your position. There is no order book and no other trader on
        the other side — the position settles against an isolated liquidity vault we fund. The{" "}
        <Link href="/vaults">vaults page</Link> shows the actual capital and caps behind each
        market.
      </p>

      <h2>What it is not</h2>
      <ul>
        <li>
          <b>Not real money.</b> Balances are devnet test tokens with no cash value and no
          redemption. The {fmt(FAUCET_USDC_TARGET, 0)} tUSDC you receive is created by us, for
          free, for testing.
        </li>
        <li>
          <b>Not investment advice, and not a solicitation.</b> Nothing on the site is a
          recommendation to take a position in anything.
        </li>
        <li>
          <b>Not a bank, a broker, a money transmitter or an exchange.</b> We hold no customer
          funds, settle no fiat, and provide no way to deposit or withdraw money.
        </li>
        <li>
          <b>Not a regulated venue.</b> Parallel is not registered with any financial authority.
          When this reaches real money, that changes, and these terms change with it.
        </li>
        <li>
          <b>Not audited.</b> Neither this application nor the Percolator program it settles on
          has had a security audit. Treat it as the experiment it is.
        </li>
      </ul>

      <h2>Your wallet</h2>
      <p>
        Signing in creates a Solana wallet for you through Privy, held in a key-management service
        rather than by us. We cannot spend from it, and we never see its key.
      </p>
      <p>
        You can export that key at any time from the portfolio screen and use it in any Solana
        wallet. That is the whole of your relationship with us: if Parallel disappeared tomorrow,
        the wallet and anything in it would still be yours and still work.
      </p>
      <p>
        <b>Recovery is through your sign-in.</b> Keep access to the email or account you signed in
        with. Exporting the key and keeping it somewhere safe is the only form of backup that does
        not depend on us or on Privy.
      </p>

      <h2>What you agree to</h2>
      <ul>
        <li>
          Not to use the devnet faucet beyond testing. It is rate-limited and has a cooldown; please
          do not try to work around them, because the funds come out of one wallet and draining it
          stops everyone else from testing.
        </li>
        <li>
          Not to attempt to extract, disrupt or overload the service — the limits are published in{" "}
          our <Link href="/docs/api">API documentation</Link> so you do not have to guess them.
        </li>
        <li>
          Not to use Parallel where doing so would break the law where you are. Several of these
          currencies have exchange controls; whether you may trade a derivative on their street
          rate is a question about your jurisdiction, not about us.
        </li>
        <li>That you are old enough to enter a contract where you live.</li>
      </ul>

      <h2>What we can do</h2>
      <p>
        We can pause a market, change its leverage cap, or stop the service, at any time and
        without notice. A market <b>pauses itself</b> when fewer than two independent price sources
        are reachable or the street price strays more than 15% from the official rate, which is a
        rule rather than a decision — see <Link href="/docs/prices">how prices work</Link>.
      </p>
      <p>
        <b>A paused market can still be closed out of.</b> That is deliberate: refusing to let
        somebody out of a position is worse than refusing to let them in.
      </p>
      <p>
        We can also change these terms. The date at the top is when they last changed. Because
        there is no money involved, we will not pretend a notice period means something here.
      </p>

      <h2>No warranty, and the limit of our liability</h2>
      <p>
        Parallel is provided as it is, with no warranty of any kind. The price index depends on
        third-party exchanges that can be slow, wrong or unreachable; the Solana devnet can be
        reset or interrupted by its operators; and the software has bugs we have not found yet.
      </p>
      <p>
        To the fullest extent the law allows, we are not liable for any loss arising from your use
        of Parallel. Since the balances have no cash value, there is nothing here to lose but time
        — and that is the only honest statement of the position.
      </p>

      <h2>Getting in touch</h2>
      <p>
        Every API response carries an <code className="doc-code">X-Request-Id</code> header, and
        error pages show the same reference. Quoting it leads us straight to what happened. The{" "}
        <Link href="/status">status page</Link> says whether the problem is ours.
      </p>
    </LegalShell>
  );
}
