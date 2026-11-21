import Link from "next/link";
import { Brand } from "./Brand";

/**
 * Landing nav: mark on the left, links centred, sign-in on the right.
 *
 * "Markets" and "Product" scroll the page. "Trade" goes straight into the app
 * — no sign-in required to look around; the app shows "Connect" until you
 * actually need a wallet. "Hedge" is gone from here: the feature sequence
 * already covers it and two links into the same section was noise.
 */
export function LandingNav() {
  return (
    <header className="lnav">
      <nav aria-label="Main">
        <Brand />
        <div className="navpill">
          <Link href="/#markets">Markets</Link>
          <Link href="/#features">Product</Link>
          <Link href="/app/trade">Trade</Link>
        </div>
        <div className="nav-right">
          <Link href="/signin" className="btn btn-light" style={{ height: 42 }}>
            Sign in / Sign up
          </Link>
        </div>
      </nav>
    </header>
  );
}
