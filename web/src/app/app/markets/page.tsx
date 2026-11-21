"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { fmt, premium } from "@/lib/mock";
import { CurrencyBadge, StatusPill } from "@/components/MarketsTable";
import { useLive, useMarkets } from "@/lib/live";

export default function MarketsPage() {
  const [q, setQ] = useState("");
  // Live prices where the index has them; sample values where it does not.
  const MARKETS = useMarkets();
  const { isLive, at } = useLive();

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return MARKETS;
    return MARKETS.filter(
      (m) =>
        m.c.toLowerCase().includes(needle) ||
        m.name.toLowerCase().includes(needle) ||
        m.reg.toLowerCase().includes(needle),
    );
  }, [q, MARKETS]);

  return (
    <div className="page">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 32, letterSpacing: "-.03em" }}>Markets</h1>
          <p style={{ margin: "6px 0 0", color: "var(--ink2)", fontSize: 15 }}>
            {MARKETS.filter((m) => m.st === "Live" && !m.paused).length} live ·{" "}
            {MARKETS.filter((m) => m.st === "Beta" && !m.paused).length} beta
            {MARKETS.some((m) => m.paused) &&
              ` · ${MARKETS.filter((m) => m.paused).length} paused`}{" "}
            · all on devnet
            {isLive && at && (
              <span style={{ color: "var(--ink3)" }}>
                {" "}
                · index updated {new Date(at).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <input
          className="inp"
          style={{ maxWidth: 280 }}
          placeholder="Search currency or region"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search markets"
        />
      </div>

      <div className="mtable" style={{ border: "1px solid var(--ln)" }}>
        <div className="mrow head">
          <span>MARKET</span>
          <span>MAX LEV.</span>
          <span>STREET</span>
          <span>OFFICIAL</span>
          <span>VS OFFICIAL</span>
          <span style={{ textAlign: "right" }}>STATUS</span>
        </div>
        {rows.map((m) => {
          const p = premium(m);
          return (
            <Link className="mrow" key={m.c} href={`/app/trade?m=${m.c}`}>
              <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <CurrencyBadge m={m} />
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <b style={{ fontWeight: 500 }}>USD/{m.c}</b>
                  <span style={{ fontSize: 13, color: "var(--ink3)" }}>
                    {m.name} · {m.reg}
                  </span>
                </span>
              </span>
              <span className="mono">{m.lev}x</span>
              <span className="mono">{fmt(m.px, m.dp)}</span>
              <span className="mono" style={{ color: "var(--ink2)" }}>
                {fmt(m.off, m.dp)}
              </span>
              <span className="mono" style={{ color: p >= 0 ? "var(--amb)" : "var(--ink2)" }}>
                {p >= 0 ? "+" : ""}
                {p.toFixed(1)}%
              </span>
              <span style={{ display: "flex", justifyContent: "flex-end" }}>
                <StatusPill m={m} paused={m.paused} />
              </span>
            </Link>
          );
        })}
        {rows.length === 0 && (
          <p style={{ padding: "24px 28px", color: "var(--ink3)", margin: 0 }}>
            No market matches “{q}”.
          </p>
        )}
      </div>

      <p style={{ marginTop: 16, fontSize: 13, color: "var(--ink3)" }}>
        Live markets use 3 or more price sources and allow up to 5x. Beta markets use 2 sources
        and allow up to 2x. Leverage is fixed when a market is created and cannot be changed
        afterwards.
      </p>
    </div>
  );
}
