"use client";

import { useState } from "react";
import { byCode, fmt, positionPnl } from "@/lib/mock";
import { useDemo } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { usePercolatorTrade } from "@/lib/usePercolatorTrade";

export function PositionsTable() {
  const { positions, signedIn, market, closePosition } = useDemo();
  const toast = useToast();
  const { close } = usePercolatorTrade();
  const [closing, setClosing] = useState<number | null>(null);

  if (positions.length === 0) {
    return (
      <div style={{ padding: "6px 16px 18px", display: "flex", alignItems: "center", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink3)" }}>
          {signedIn
            ? "No browser position is saved. You can still close an on-chain position in this market."
            : "Sign in to see your positions."}
        </p>
        {signedIn && (
          <button
            type="button"
            className="closebtn"
            disabled={closing !== null}
            onClick={async () => {
              try {
                setClosing(-1);
                const signature = await close({ code: market });
                toast(`Closed on devnet · ${signature.slice(0, 8)}…`);
              } catch (error) {
                toast(error instanceof Error ? error.message : "Close failed");
              } finally {
                setClosing(null);
              }
            }}
          >
            {closing !== null ? "Closing…" : `Close on-chain ${market}`}
          </button>
        )}
      </div>
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
                  disabled={closing === p.id}
                  onClick={async () => {
                    try {
                      setClosing(p.id);
                      const signature = await close({ code: p.c });
                      const realised = closePosition(p.id);
                      toast(`Closed on devnet · ${realised >= 0 ? "+" : ""}${fmt(realised)} tUSDC · ${signature.slice(0, 8)}…`);
                    } catch (error) {
                      toast(error instanceof Error ? error.message : "Close failed");
                    } finally {
                      setClosing(null);
                    }
                  }}
                >
                  {closing === p.id ? "Closing…" : "Close"}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
