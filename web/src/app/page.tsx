import Link from "next/link";
import { Hero } from "@/components/Hero";
import { MarketRows } from "@/components/MarketsTable";
import { FeatureScroll } from "@/components/FeatureScroll";
import { CtaCanvas } from "@/components/CtaCanvas";
import { Footer } from "@/components/Footer";
import { LANDING_ROWS } from "@/lib/mock";

export default function HomePage() {
  return (
    <main id="main">
      {/* The banner and nav now ride inside the hero, over the video. */}
      <Hero />

      <section className="sec" id="markets">
        <div className="wrap center">
          <span
            className="pill-tag"
            style={{ border: "1px solid #3D5CF566", background: "#3D5CF514", color: "var(--pri-t)" }}
          >
            Street-rate index
          </span>
          <h2 className="h2">Two prices. Trade the real one.</h2>
          <p className="lead">
            Every market tracks what people really pay for dollars on the street, checked
            against the official rate every two minutes.
          </p>
          <div className="glowbox">
            <div className="glowframe">
              <div className="mtable">
                <MarketRows codes={LANDING_ROWS} />
              </div>
            </div>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--ink3)" }}>
            Live markets use 3+ price sources and up to 5x. Beta markets use 2 sources and up
            to 2x. Devnet test funds only.
          </p>
        </div>
      </section>

      <FeatureScroll />

      <section style={{ padding: "120px 24px 40px" }}>
        <div className="cta">
          <CtaCanvas />
          <div className="cta-copy">
            <h2 style={{ fontSize: "clamp(44px,5.6vw,84px)", letterSpacing: "-.045em", lineHeight: 1 }}>
              Sign up. Get 10,000
              <br />
              test dollars.
            </h2>
            <p style={{ margin: 0, fontSize: 19, color: "var(--ink2)", lineHeight: 1.6 }}>
              Email or Google. Your wallet is made for you, funded, and fees are on us. You land
              on the naira market, ready to trade.
            </p>
            <div>
              <Link
                href="/signin"
                className="btn btn-light"
                style={{ height: 56, padding: "0 30px", fontSize: 16 }}
              >
                Create account
              </Link>
            </div>
            <span style={{ fontSize: 13, color: "var(--ink3)" }}>
              Devnet beta · test money only · mainnet coming soon
            </span>

            {/* Risk sits with the sign-up, where it is actually relevant,
                rather than buried at the bottom of the footer. */}
            <div
              id="risk"
              style={{
                marginTop: 14,
                paddingTop: 20,
                borderTop: "1px solid var(--ln)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                fontSize: 13.5,
                lineHeight: 1.7,
                color: "var(--ink3)",
                maxWidth: 560,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink2)" }}>
                Risk disclosure
              </span>
              <p style={{ margin: 0 }}>
                Parallel is a beta running on Solana devnet. Balances are test tokens with no
                cash value. Perpetual futures are leveraged products: a position can be
                liquidated and you can lose the margin you committed. Prices come from public
                exchange and peer-to-peer venues and can differ from any official rate. Nothing
                here is financial advice.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
