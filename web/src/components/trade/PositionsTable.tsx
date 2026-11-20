"use client";

import { byCode, fmt, positionPnl } from "@/lib/mock";
import { useDemo } from "@/lib/store";
import { useToast } from "@/components/Toast";

export function PositionsTable() {
  const { positions, signedIn, closePosition } = useDemo();
  const toast = useToast();

  if (positions.length === 0) {
    return (
      <p style={{ margin: 0, padding: "6px 16px 18px", fontSize: 13, color: "var(--ink3)" }}>
        {signedIn
          ? "No open positions yet. Open one from the panel."
          : "Sign in to see your positions."}
      </p>
    );
  }

  return (
    <table className="postable">
      <thead>
        <tr>
          <th>Market</th>
          <th>Side</th>
          <th>Size</th>
          <th>Entry</th>
          <th>Mark</th>
          <th>P&amp;L</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => {
          const m = byCode(p.c);
          const v = positionPnl(p);
          const up = v >= 0;
          return (
            <tr key={p.id}>
              <td>USD/{p.c}</td>
              <td style={{ color: p.side === "long" ? "var(--up)" : "var(--dn)" }}>
                {p.side === "long" ? "Long" : "Short"} {p.lev}x
              </td>
              <td>{fmt(p.size * p.lev)}</td>
              <td>{fmt(p.entry, m.dp)}</td>
              <td>{fmt(m.px, m.dp)}</td>
              <td style={{ color: up ? "var(--up)" : "var(--dn)" }}>
                {up ? "+" : ""}
                {fmt(v)}
              </td>
              <td style={{ textAlign: "right" }}>
                <button
                  type="button"
                  className="closebtn"
                  onClick={() => {
                    const realised = closePosition(p.id);
                    toast(`Closed · ${realised >= 0 ? "+" : ""}${fmt(realised)} tUSDC`);
                  }}
                >
                  Close
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
