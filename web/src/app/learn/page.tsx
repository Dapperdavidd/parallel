import type { Metadata } from "next";
import Link from "next/link";
import { SiteTop } from "@/components/SiteTop";
import { Footer } from "@/components/Footer";
import { MARKETS, fmt, premium } from "@/lib/mock";

export const metadata: Metadata = {
  title: "Learn — Parallel",
  description:
    "How Parallel works, in plain English: where the price comes from, what a " +
    "perpetual is, how hedging protects your savings, and what can go wrong.",
};

const SECTIONS: [string, string][] = [
  ["start", "Start here"],
  ["prices", "Where the price comes from"],
  ["trading", "How trading works"],
  ["hedging", "How hedging works"],
  ["app", "A tour of the app"],
  ["risks", "Risks"],
  ["faq", "Common questions"],
  ["about", "About Parallel"],
];

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="doc-h">
      {children}
    </h2>
  );
}

export default function LearnPage() {
  const ngn = MARKETS[0]!;

  return (
    <main id="main">
      <SiteTop />

      <div className="doc">
        <aside className="doc-nav" aria-label="Contents">
          <div className="doc-nav-title">Contents</div>
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </aside>

        <article className="doc-body">
          <p className="eyebrow">LEARN</p>
          <h1 className="doc-title">How Parallel works</h1>
          <p className="doc-lead">
            No jargon, no assumed knowledge. If you have never touched crypto, start at the
            top and read down — each part builds on the one before it.
          </p>

          {/* ---------------------------------------------------------- */}
          <H id="start">Start here</H>
          <p>
            In many countries there are <b>two prices for the US dollar</b>. There is the
            official rate a central bank publishes, and there is the rate people actually pay
            when they buy dollars — on the street, in a shop, through a friend. The second one
            is usually higher, and it is the one that decides what your money is really worth.
          </p>
          <p>
            Right now, {ngn.name.split(" ").slice(1).join(" ")} buyers pay about{" "}
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

          {/* ---------------------------------------------------------- */}
          <H id="prices">Where the price comes from</H>
          <p>
            A trading product is only as honest as its price. Ours is built in the open, and
            you can check every step.
          </p>
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

          {/* ---------------------------------------------------------- */}
          <H id="trading">How trading works</H>
          <h3 className="doc-h3">What a perpetual is</h3>
          <p>
            A <b>perpetual</b> is a contract that tracks a price. You are not buying dollars or
            naira — you are taking a position on which way the rate moves. There is no expiry
            date, so you hold it for as long as you like and close it whenever you want.
          </p>

          <h3 className="doc-h3">Long and short</h3>
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

          <h3 className="doc-h3">Leverage, and why it cuts both ways</h3>
          <p>
            Leverage lets you hold a position larger than the money you put in. Put in 100 and
            choose 5x, and you are holding 500 worth. A 1% move now changes your money by 5%,
            not 1% — <b>in both directions</b>.
          </p>
          <p>
            Live markets allow up to <b>5x</b>, newer ones up to <b>2x</b>. That cap is fixed
            when the market is created and cannot be raised later.
          </p>

          <h3 className="doc-h3">Liquidation</h3>
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

          <h3 className="doc-h3">Funding</h3>
          <p>
            Perpetuals have no expiry, so something has to keep them tethered to the real
            price. That is <b>funding</b>: a small payment that passes between the two sides
            periodically. When more people are long than short, longs pay shorts, and that
            nudges the contract price back toward the index. It is usually a tiny fraction of
            a percent.
          </p>

          <h3 className="doc-h3">Fees</h3>
          <p>
            A trading fee of <b>0.06%</b> of position size is charged when you open. On devnet
            the network fees are covered for you.
          </p>

          {/* ---------------------------------------------------------- */}
          <H id="hedging">How hedging works</H>
          <p>
            Hedging is not trading. You are not trying to make money — you are trying to
            <b> stop losing it</b>.
          </p>
          <p>
            Say you hold {ngn.sym}2,000,000 and you need it in a month. Today that is about{" "}
            <b>${fmt(2_000_000 / ngn.px)}</b>. If the {ngn.name.split(" ").slice(1).join(" ")}{" "}
            weakens 10% before you spend it, the same money buys roughly 10% fewer dollars. You
            did nothing wrong and you are poorer.
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
            <li>If your currency strengthens, the reverse happens. You gave up the upside to remove the downside. That is the trade.</li>
          </ol>
          <p>
            Hedge mode shows you the full table before you commit — what happens at −10%, −5%,
            no change, +5% and +10% — so there are no surprises.
          </p>

          {/* ---------------------------------------------------------- */}
          <H id="app">A tour of the app</H>
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
              <b>Hedge</b> — the plain-language flow described above.
            </li>
            <li>
              <b>Portfolio</b> — your balance, your open positions, and the Add money button.
            </li>
          </ul>
          <h3 className="doc-h3">Your wallet</h3>
          <p>
            When you sign in with an email, a Solana wallet is created for you. There is no
            seed phrase to write down and no extension to install. The wallet is yours and you
            can export it whenever you want.
          </p>

          {/* ---------------------------------------------------------- */}
          <H id="risks">Risks</H>
          <p>Read this part properly.</p>
          <ul className="doc-list">
            <li>
              <b>Leverage can wipe out your position.</b> A position can be liquidated and you
              lose the margin you committed. The higher the leverage, the smaller the move
              needed.
            </li>
            <li>
              <b>Street prices are not official prices.</b> Our index tracks what people
              actually pay, which can differ sharply from any government rate. That gap is the
              point of the product, but it means our number will not match a bank's.
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

          {/* ---------------------------------------------------------- */}
          <H id="faq">Common questions</H>

          <h3 className="doc-h3">Do I need to know crypto?</h3>
          <p>
            No. Sign in with an email and the wallet is made for you. You never handle a seed
            phrase or pay a network fee.
          </p>

          <h3 className="doc-h3">Is this real money?</h3>
          <p>
            Not today. Everything runs on Solana devnet with test tokens that have no value.
            That is why you can get 10,000 of them for free.
          </p>

          <h3 className="doc-h3">Why is your price different from my bank's?</h3>
          <p>
            Because banks quote the official rate and we quote the street rate. On the naira
            that gap is currently about {premium(ngn).toFixed(1)}%. Neither is wrong — they
            measure different things, and we show both side by side so you can see it.
          </p>

          <h3 className="doc-h3">What happens if a price source goes down?</h3>
          <p>
            If a market falls below two working sources it pauses. You cannot open new
            positions, but you can always close what you hold. We would rather stop than guess.
          </p>

          <h3 className="doc-h3">Can I lose more than I put in?</h3>
          <p>No. The most you can lose on a position is the margin you committed to it.</p>

          <h3 className="doc-h3">Which currencies can I trade?</h3>
          <p>
            Thirteen at launch: {MARKETS.map((m) => m.c).join(", ")}.{" "}
            <Link href="/app/markets" className="doc-link">
              See them all →
            </Link>
          </p>

          <h3 className="doc-h3">When is mainnet?</h3>
          <p>
            After the devnet beta has run properly, the contracts have been audited, and the
            legal position is clear in each country. We would rather be late than careless.
          </p>

          {/* ---------------------------------------------------------- */}
          <H id="about">About Parallel</H>
          <p>
            Billions of people earn and spend in currencies that move against the dollar, and
            the tools to do anything about it sit with offshore banks. No on-chain venue lists
            these currencies at all. Parallel puts them on Solana.
          </p>
          <p>
            The product is deliberately narrow: thirteen currencies, one open index, two ways
            to use it. Built in Lagos, settled on Solana.
          </p>
          <p>
            Parallel runs on <b>Percolator</b>, an open-source perpetuals engine. We did not
            write our own exchange — we supply the prices, the keeper and the app, and the
            engine handles margin, funding and liquidations.
          </p>

          <div className="doc-cta">
            <Link href="/app/trade" className="btn btn-pri" style={{ height: 50, padding: "0 26px" }}>
              Open the app
            </Link>
            <Link href="/open-index" className="btn btn-ghost" style={{ height: 50, padding: "0 22px" }}>
              See the live index
            </Link>
          </div>
        </article>
      </div>

      <Footer />
    </main>
  );
}
