import type { Metadata } from "next";
import Link from "next/link";
import { MARKETS } from "@/lib/mock";
import { DocShell, H3 } from "../DocShell";

export const metadata: Metadata = {
  title: "API documentation — Parallel docs",
  description:
    "On-chain addresses, the index data model and the price conventions Parallel settles against on Solana devnet.",
};

const PROGRAM_ID = "Bu1J8eQQN2mNnUgisSEd5StBG6zDaRb7fwDjN34VzgLG";

function Code({ children }: { children: React.ReactNode }) {
  return <code className="doc-code">{children}</code>;
}

export default function ApiPage() {
  return (
    <DocShell
      href="/docs/api"
      eyebrow="REFERENCE"
      title="API documentation"
      lead="The chain Parallel runs on, the price conventions every market shares, the shape of an index reading, and the HTTP routes that serve them."
    >
      <div className="doc-note">
        <b>Devnet, and moving.</b> Addresses and schemas on this page are for the
        Solana devnet beta. Treat them as subject to change until mainnet.
      </div>

      <h2 className="doc-h">On-chain</h2>
      <table className="doc-table">
        <tbody>
          <tr>
            <th>Cluster</th>
            <td>Solana devnet</td>
          </tr>
          <tr>
            <th>RPC</th>
            <td>
              <Code>https://api.devnet.solana.com</Code>
            </td>
          </tr>
          <tr>
            <th>Perps engine</th>
            <td>Percolator v16</td>
          </tr>
          <tr>
            <th>Program</th>
            <td>
              <Code>{PROGRAM_ID}</Code>
            </td>
          </tr>
          <tr>
            <th>Collateral</th>
            <td>tUSDC, 6 decimals, devnet test mint</td>
          </tr>
        </tbody>
      </table>
      <p>
        Parallel does not run its own matching engine. It supplies the index, the keeper
        that pushes it, and this app; margin, funding and liquidations are the engine&apos;s.
      </p>

      <h2 className="doc-h">Price conventions</h2>
      <ul className="doc-list">
        <li>
          <b>Scale.</b> Prices are unsigned integers at <Code>1e6</Code> — a price of{" "}
          <Code>688_500</Code> means $0.6885.
        </li>
        <li>
          <b>Units.</b> The engine quotes USD per unit of the traded asset, and a single
          unit of local currency is too small to carry precision at that scale. So each
          market trades a <b>bundle</b>: 1,000 NGN, 10 ZAR, 100 INR and so on, chosen so
          the unit price lands between roughly $0.05 and $10. The app always shows the
          familiar quote — bundles are an internal detail.
        </li>
        <li>
          <b>Direction.</b> Markets are written <Code>USD/XXX</Code>. Long USD profits when
          the local currency weakens.
        </li>
        <li>
          <b>Circuit breaker.</b> Each market carries a maximum price move per slot. A push
          that exceeds it is rejected on-chain rather than clamped.
        </li>
      </ul>

      <h2 className="doc-h">The index</h2>
      <p>
        A reading is the median of the venues that responded, after sources more than 3%
        from that median are dropped and the median is taken again. A market needs two
        surviving sources, or it pauses.
      </p>
      <H3>Reading</H3>
      <table className="doc-table">
        <tbody>
          <tr>
            <th>
              <Code>market</Code>
            </th>
            <td>
              Market id, e.g. <Code>USD/NGN</Code>
            </td>
          </tr>
          <tr>
            <th>
              <Code>price_e6</Code>
            </th>
            <td>Median unit price in USD, scaled by 1e6</td>
          </tr>
          <tr>
            <th>
              <Code>street_rate</Code>
            </th>
            <td>Local currency per USD, as displayed</td>
          </tr>
          <tr>
            <th>
              <Code>official_rate</Code>
            </th>
            <td>Published central-bank rate for the same pair</td>
          </tr>
          <tr>
            <th>
              <Code>sources</Code>
            </th>
            <td>Per-venue readings, including any dropped as outliers</td>
          </tr>
          <tr>
            <th>
              <Code>slot</Code>, <Code>pushed_at</Code>
            </th>
            <td>Solana slot and wall-clock time the reading was written</td>
          </tr>
        </tbody>
      </table>
      <p>
        Every reading is kept with its per-source breakdown.{" "}
        <Link href="/open-index" className="doc-link">
          Browse them live →
        </Link>
      </p>
      <H3>Push cadence</H3>
      <p>
        The index is <b>measured</b> every two minutes. It is <b>written on-chain</b> when the
        median has moved more than <b>0.1%</b>, or ten minutes have passed since the last push —
        whichever comes first. So a quiet market&apos;s on-chain mark can be up to ten minutes
        behind the measurement, and the gap between the two is published as the market&apos;s
        basis.
      </p>

      <h2 className="doc-h">Markets</h2>
      <p>
        {MARKETS.length} pairs at launch. Live markets cap leverage at 5x, beta markets at
        2x; the cap is fixed when the market is created.
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Market</th>
            <th>Unit</th>
            <th>Max leverage</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {MARKETS.map((m) => (
            <tr key={m.c}>
              <td>
                <Code>USD/{m.c}</Code>
              </td>
              <td>{m.unitLabel}</td>
              <td>{m.lev}x</td>
              <td>{m.st}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="doc-h">The HTTP API</h2>
      <p>
        Thirteen routes under <Code>/api</Code>, all devnet. The market data routes need no
        key and are open cross-origin, so the index is embeddable.{" "}
        <a
          className="doc-link"
          href="https://github.com/Dapperdavidd/parallel/blob/main/docs/API.md"
          target="_blank"
          rel="noreferrer"
        >
          Full reference, with schemas and examples →
        </a>
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Route</th>
            <th>What it answers</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>
              <Code>GET /api/markets</Code>
            </th>
            <td>
              The board: index median, the engine&apos;s own mark, the basis between them, source
              health, measurement age, and why a market is paused
            </td>
          </tr>
          <tr>
            <th>
              <Code>GET /api/candles</Code>
            </th>
            <td>
              OHLC per timeframe, plus the raw ticks for a market too young for candles, plus the
              published official-rate series
            </td>
          </tr>
          <tr>
            <th>
              <Code>GET /api/index-feed</Code>
            </th>
            <td>
              Every source reading including failures and outliers, and the rules in force —
              enough to recompute our number
            </td>
          </tr>
          <tr>
            <th>
              <Code>GET /api/vaults</Code>
            </th>
            <td>The capital and caps standing behind each market, read from the chain</td>
          </tr>
          <tr>
            <th>
              <Code>POST /api/trade/quote</Code>
            </th>
            <td>What a trade would cost: fill price, gap to index, liquidation estimate</td>
          </tr>
          <tr>
            <th>
              <Code>GET /api/ready</Code>
            </th>
            <td>
              Whether a trade could be placed, and which dependency is missing if not —{" "}
              <Link href="/status" className="doc-link">
                see it rendered
              </Link>
            </td>
          </tr>
        </tbody>
      </table>

      <H3>Conventions</H3>
      <ul className="doc-list">
        <li>
          <b>No version in the path.</b> There is one consumer, the app shipped in the same
          commit, and a <Code>/v1/</Code> prefix that never changes value is decoration. If a
          second consumer appears, the version starts there.
        </li>
        <li>
          <b>Null means we do not have it</b>, never zero. A paused market has a null median; a
          24-hour change is null until there is a full day of history.
        </li>
        <li>
          <b>On-chain quantities are decimal strings</b>, because they exceed what a JavaScript
          number holds. Prices named <Code>…PriceE6</Code> are micro-dollars per contract.
        </li>
        <li>
          <b>Every response carries <Code>X-Request-Id</Code>.</b> Quote it and we can find
          exactly what happened.
        </li>
      </ul>

      <H3>Rate limits</H3>
      <p>
        Per caller per minute. Responses carry <Code>RateLimit-Limit</Code> and{" "}
        <Code>RateLimit-Remaining</Code>, so a well-behaved client can slow down before it is
        refused rather than after.
      </p>
      <table className="doc-table">
        <tbody>
          <tr>
            <th>Market data</th>
            <td>240</td>
          </tr>
          <tr>
            <th>Preparing a trade</th>
            <td>20</td>
          </tr>
          <tr>
            <th>Recording a trade or hedge</th>
            <td>30</td>
          </tr>
          <tr>
            <th>Devnet faucet</th>
            <td>4, plus a six-hour cooldown per wallet</td>
          </tr>
        </tbody>
      </table>

      <h2 className="doc-h">Not published yet</h2>
      <ul className="doc-list">
        <li>A websocket stream for live prices and fills.</li>
        <li>Signed index attestations, so a third party could verify a push independently.</li>
        <li>
          Resting orders of any kind — limit, trigger, stop-loss, reduce-only. The deployed
          devnet program settles against a vault and cannot rest an order, so there is nothing to
          expose.
        </li>
      </ul>
      <p>
        Until those ship, the on-chain account is the source of truth and can be read directly
        from any Solana RPC.
      </p>
    </DocShell>
  );
}
