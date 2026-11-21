import Link from "next/link";
import { Brand } from "./Brand";

export function TopBanner() {
  return (
    <div className="topbanner">
      Devnet beta · sign up and get 10,000 test dollars ·{" "}
      <span style={{ color: "var(--amb)" }}>mainnet coming soon</span>
    </div>
  );
}

/**
 * Landing nav.
 *
 * "Trade" and "Hedge" stay ON the landing page — they jump to the part of the
 * feature sequence that explains each one, rather than dropping a first-time
 * visitor straight into the app. Only the sign-in button leads out.
 */
export function LandingNav() {
  return (
    <header className="lnav">
      <nav aria-label="Main">
        <Brand />
        <div className="navpill">
          <Link href="/#markets">Markets</Link>
          <Link href="/#features">Product</Link>
          <Link href="/#feature-trade">Trade</Link>
          <Link href="/#feature-hedge">Hedge</Link>
        </div>
        <Link href="/signin" className="btn btn-glass" style={{ height: 44 }}>
          Sign in / Sign up
        </Link>
      </nav>
    </header>
  );
}
