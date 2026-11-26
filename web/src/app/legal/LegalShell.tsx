import Link from "next/link";
import { SiteTop } from "@/components/SiteTop";
import { Footer } from "@/components/Footer";

/**
 * The frame every legal page renders through.
 *
 * Short, plain, and honest about what Parallel is: a devnet beta holding test
 * tokens. Most of what a terms page usually asserts — custody, fees, orders,
 * fiat — does not apply yet, and saying so is better than pasting boilerplate
 * that claims otherwise. A document that overstates the product is a document
 * nobody can rely on.
 */
export function LegalShell({
  title,
  lead,
  updated,
  children,
}: {
  title: string;
  lead: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteTop />
      <main id="main" className="wrap" style={{ paddingTop: 110, paddingBottom: 50 }}>
        <p className="eyebrow">LEGAL</p>
        <h1
          style={{
            fontSize: "clamp(32px,4vw,50px)",
            letterSpacing: "-.035em",
            margin: "6px 0 10px",
          }}
        >
          {title}
        </h1>
        <p style={{ color: "var(--ink2)", fontSize: 17, lineHeight: 1.6, maxWidth: "62ch" }}>
          {lead}
        </p>
        <p className="updated" style={{ marginTop: 4 }}>
          Last updated {updated} · applies to the Solana devnet beta
        </p>

        <div className="legal">{children}</div>

        <p style={{ marginTop: 44, fontSize: 14, color: "var(--ink3)" }}>
          See also: <Link href="/docs/risks">risk disclosure</Link> ·{" "}
          <Link href="/legal/terms">terms</Link> · <Link href="/legal/privacy">privacy</Link> ·{" "}
          <Link href="/status">status</Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
