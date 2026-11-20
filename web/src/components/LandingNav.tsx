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

export function LandingNav() {
  return (
    <header className="lnav">
      <nav aria-label="Main">
        <Brand />
        <div className="navpill">
          <Link href="/#markets">Markets</Link>
          <Link href="/#features">Product</Link>
          <Link href="/app/trade">Trade</Link>
          <Link href="/app/hedge">Hedge</Link>
        </div>
        <Link href="/signin" className="btn btn-light" style={{ height: 44 }}>
          Sign in / Sign up
        </Link>
      </nav>
    </header>
  );
}
