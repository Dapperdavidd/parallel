import Link from "next/link";
import { byCode, fmt, premium, type Market } from "@/lib/mock";

function CurrencyBadge({ m, small = false }: { m: Market; small?: boolean }) {
  return (
    <span
      className={small ? "cur sm" : "cur"}
      style={{ fontSize: m.sym.length > 2 ? (small ? 10 : 12) : small ? 13 : 15 }}
    >
      {m.sym}
    </span>
  );
}

export function StatusPill({ m }: { m: Market }) {
  const live = m.st === "Live";
  return (
    <span className="status">
      <span
        className="dot"
        style={{ background: live ? "var(--up)" : "var(--amb)" }}
      />
      {m.st}
    </span>
  );
}

/**
 * The market rows used on the landing page and the in-app Markets board.
 * `codes` decides which markets show, so the landing can display a slice.
 */
export function MarketRows({ codes }: { codes: string[] }) {
  return (
    <>
      <div className="mrow head">
        <span>MARKET</span>
        <span className="hide-sm">MAX LEVERAGE</span>
        <span>STREET PRICE</span>
        <span>VS OFFICIAL</span>
        <span className="hide-sm">STATUS</span>
        <span className="hide-sm" style={{ textAlign: "right" }}>REGION</span>
      </div>
      {codes.map((c) => {
        const m = byCode(c);
        const p = premium(m);
        return (
          <Link className="mrow" key={c} href={`/app/trade?m=${m.c}`}>
            <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <CurrencyBadge m={m} />
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <b style={{ fontWeight: 500 }}>USD/{m.c}</b>
                <span style={{ fontSize: 13, color: "var(--ink3)" }}>{m.name}</span>
              </span>
            </span>
            <span className="mono hide-sm">{m.lev}x</span>
            <span className="mono">{fmt(m.px, m.dp)}</span>
            <span className="mono" style={{ color: p >= 0 ? "var(--amb)" : "var(--ink2)" }}>
              {p >= 0 ? "+" : ""}
              {p.toFixed(1)}%
            </span>
            <span className="hide-sm">
              <StatusPill m={m} />
            </span>
            <span className="hide-sm" style={{ textAlign: "right", color: "var(--ink2)", fontSize: 14 }}>
              {m.reg}
            </span>
          </Link>
        );
      })}
    </>
  );
}

export { CurrencyBadge };
