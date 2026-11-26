import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "../LegalShell";

export const metadata: Metadata = {
  title: "Privacy — Parallel",
  description:
    "What Parallel stores, what it does not, how long it keeps it, and what is public by design.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy"
      updated="26 November 2026"
      lead="What we store, what we deliberately do not, and how long any of it lasts. Short enough to read, because a privacy policy nobody finishes is not a disclosure."
    >
      <h2>The short version</h2>
      <p>
        We store your <b>wallet address</b> and the trades it made. We do not store your name,
        your location, your IP address, or anything about your device. Your sign-in details are
        held by Privy, not by us, and we never see them.
      </p>
      <p>
        A public blockchain is public: your wallet address and every transaction it signs are
        visible to anyone, permanently, whether or not we store them. Nothing we do can change
        that, so it is worth understanding before you trade — including on devnet.
      </p>

      <h2>What we hold</h2>
      <table>
        <tbody>
          <tr>
            <th>Wallet address</th>
            <td>
              To show you your own positions and history. It is already public on the chain.
            </td>
          </tr>
          <tr>
            <th>Your trades</th>
            <td>
              Market, side, size, leverage, price, time and the transaction signature. Each row is
              verified against the chain before it is stored, so this is a copy of public data
              rather than a separate record.
            </td>
          </tr>
          <tr>
            <th>Hedge intents</th>
            <td>
              The amount of local currency you said you were protecting, and the date you need it
              by. This is the only thing we store that is <b>not</b> on the chain, and it is kept
              private: the database grants no read access to anyone but the server.
            </td>
          </tr>
          <tr>
            <th>Faucet claims</th>
            <td>
              Your wallet address and when it last took test funds, so the cooldown survives a
              restart. Deliberately no IP address: the per-wallet cooldown is what the faucet
              needs, and an address log would be personal data we have no use for.
            </td>
          </tr>
          <tr>
            <th>Your own settings</th>
            <td>
              Starred markets, whether to confirm before trading, slippage tolerance, chart
              drawings. All of it stays in your browser&rsquo;s local storage and is never sent to
              us.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>What we do not hold</h2>
      <ul>
        <li>
          <b>No analytics, no advertising, no third-party trackers.</b> There is no tracking script
          on this site.
        </li>
        <li>
          <b>No IP addresses in storage.</b> Rate limiting counts requests per caller in the
          serving process&rsquo;s memory and that counter is never written down.
        </li>
        <li>
          <b>No private keys.</b> Your wallet key is held by Privy&rsquo;s key-management service.
          We cannot read it and cannot spend from your wallet.
        </li>
        <li>
          <b>No secrets in our logs.</b> Log lines redact any field whose name looks like a secret
          — keys, tokens, cookies, passwords, seed phrases — before anything is written.
        </li>
      </ul>

      <h2>How long we keep it</h2>
      <table>
        <tbody>
          <tr>
            <th>Index prices</th>
            <td>
              Kept indefinitely. It is a public measurement series, published on the{" "}
              <Link href="/open-index">open index</Link> page, and the charts are built from it.
            </td>
          </tr>
          <tr>
            <th>Trades</th>
            <td>
              Kept while the beta runs. The chain keeps them regardless, so deleting our copy would
              remove your history from your own portfolio screen without removing it from the
              world.
            </td>
          </tr>
          <tr>
            <th>Hedge intents</th>
            <td>Deleted on request. This is the one record only we have.</td>
          </tr>
          <tr>
            <th>Faucet claims</th>
            <td>
              Kept while the beta runs; they are what the cooldown is. A row is one address and one
              timestamp.
            </td>
          </tr>
          <tr>
            <th>Server logs</th>
            <td>
              Whatever the hosting platform retains, typically days rather than months. They hold
              request paths, timings and errors — not request bodies.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Who else is involved</h2>
      <ul>
        <li>
          <b>Privy</b> handles sign-in and holds your wallet key. Your email address goes to them,
          not to us.
        </li>
        <li>
          <b>Supabase</b> hosts the database described above.
        </li>
        <li>
          <b>Solana devnet</b> RPC providers see the transactions your browser and our server
          submit. That is inherent to using a blockchain.
        </li>
        <li>
          <b>Price sources</b> — the exchanges and peer-to-peer desks named on the{" "}
          <Link href="/open-index">open index</Link> page — are read by our server, never by your
          browser, so they do not see you.
        </li>
      </ul>

      <h2>Your choices</h2>
      <p>
        You can export your whole record from the portfolio screen as a CSV: balances, open
        positions, and every trade with its signature. You can export your wallet key and leave.
        You can ask us to delete your hedge intents.
      </p>
      <p>
        What we cannot do is remove your wallet&rsquo;s activity from the blockchain, because
        nobody can. If that matters to you, use a fresh wallet — and know that funding it from
        another wallet links the two.
      </p>

      <h2>Changes</h2>
      <p>
        The date at the top is when this last changed. If we start collecting something new, this
        page changes before that happens, not after.
      </p>
    </LegalShell>
  );
}
