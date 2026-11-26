import Link from "next/link";
import { SiteTop } from "@/components/SiteTop";
import { IntroStage } from "@/components/IntroStage";
import { FeatureScroll } from "@/components/FeatureScroll";
import { CtaCanvas } from "@/components/CtaCanvas";
import { Footer } from "@/components/Footer";
import { FAUCET_USDC_TARGET } from "@/lib/faucet";
import { fmt } from "@/lib/mock";

export default function HomePage() {
  return (
    <main id="main">
      {/* Persistent: the nav stays visible for the whole page. */}
      <SiteTop />
      <IntroStage />

      <div className="after-hero">
      <FeatureScroll />

      <section style={{ padding: "120px 24px 40px" }}>
        <div className="cta">
          <CtaCanvas />
          <div className="cta-copy">
            <h2 style={{ fontSize: "clamp(44px,5.6vw,84px)", letterSpacing: "-.045em", lineHeight: 1 }}>
              Sign up. Get {fmt(FAUCET_USDC_TARGET, 0)}
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
            {/* "Mainnet coming soon" was a promise with no date behind it.
                The FAQ answers this honestly — audited contracts and a clear
                legal position in each country first — and this line should
                not contradict it. */}
            <span style={{ fontSize: 13, color: "var(--ink3)" }}>
              Devnet beta · test money only · no mainnet date yet
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
      </div>
    </main>
  );
}
