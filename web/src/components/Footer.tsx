import Link from "next/link";
import { Mark } from "./Brand";

function TileIcon({ d, stroke }: { d: string; stroke: string }) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function Footer() {
  return (
    <footer
      className="wrap"
      style={{ paddingTop: 120, paddingBottom: 12, display: "flex", flexDirection: "column", gap: 48 }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 48, justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 380 }}>
          <span className="brand" style={{ fontSize: 24 }}>
            <Mark size={32} />
            Parallel
          </span>
          <span style={{ fontSize: 17, fontWeight: 500 }}>
            Perpetuals on the currencies the world forgot to list.
          </span>
          <span style={{ fontSize: 15, color: "var(--ink3)" }}>
            Built in Lagos. Settled on Solana.
          </span>
        </div>

        <div className="fcols">
          <div>
            <h4>Trade</h4>
            <Link href="/app/markets">Markets</Link>
            <Link href="/app/trade">USD/NGN</Link>
            <Link href="/app/hedge">Hedge mode</Link>
          </div>
          <div>
            <h4>Learn</h4>
            <Link href="/#markets">How prices work</Link>
            <Link href="/#features">The app</Link>
            <Link href="/#risk">Risk</Link>
          </div>
          <div>
            <h4>Parallel</h4>
            <Link href="/">About</Link>
            <Link href="/signin">Sign in / Sign up</Link>
            <Link href="/#risk">Risk disclosure</Link>
          </div>
        </div>
      </div>

      <div className="tiles">
        <Link href="/app/trade" className="tile main">
          <TileIcon d="M3 17l6-6 4 4 7-7M14 8h7v7" stroke="currentColor" />
          <span>
            <b style={{ display: "block", fontWeight: 500 }}>Start trading</b>
            <span style={{ fontSize: 14, color: "var(--ink2)" }}>13 markets on devnet</span>
          </span>
        </Link>
        <div className="tile">
          <TileIcon d="M12 3v18M5 8h14M5 16h14" stroke="#A1A1A6" />
          <span>
            <b style={{ display: "block", fontWeight: 500 }}>Open index</b>
            <span style={{ fontSize: 14, color: "var(--ink2)" }}>Every source, published</span>
          </span>
        </div>
        <div className="tile">
          <TileIcon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#A1A1A6" />
          <span>
            <b style={{ display: "block", fontWeight: 500 }}>Devnet only</b>
            <span style={{ fontSize: 14, color: "var(--ink2)" }}>Test money, no risk</span>
          </span>
        </div>
      </div>


      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
          paddingTop: 24,
          borderTop: "1px solid var(--ln)",
          fontSize: 14,
          color: "var(--ink3)",
        }}
      >
        <span>© 2026 Parallel</span>
        <span style={{ display: "flex", gap: 20 }}>
          <Link href="/#risk">Risk</Link>
          <Link href="/#markets">Markets</Link>
          <Link href="/signin">Sign in</Link>
        </span>
      </div>
      <div className="wordmark" aria-hidden="true">
        <span className="wm">
          Parallel <span className="fx">FX</span>
        </span>
      </div>
    </footer>
  );
}
