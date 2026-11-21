"use client";

import { useEffect, useRef, useState } from "react";
import { MARKETS, fmt, premium, type Market } from "@/lib/mock";
import { useDemo } from "@/lib/store";

/**
 * Market picker in the top-left of the trade header, the way a trading app
 * does it: the current pair with a chevron, opening a searchable list of
 * everything available.
 */
export function MarketSelect({ market }: { market: Market }) {
  const { setMarket } = useDemo();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const rows = needle
    ? MARKETS.filter(
        (m) => m.c.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle),
      )
    : MARKETS;

  return (
    <div className="mselect" ref={ref}>
      <button className="trig" type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="cur sm">{market.sym}</span>
        <span style={{ fontSize: 16 }}>USD/{market.c}</span>
        <span className="lev-chip">{market.lev}x</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="mdrop on">
          <div style={{ padding: 10, borderBottom: "1px solid var(--ln)" }}>
            <input
              className="inp"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search market"
              style={{ height: 38, fontSize: 14 }}
              aria-label="Search market"
            />
          </div>
          <div style={{ display: "flex", padding: "8px 14px", fontSize: 11, color: "var(--ink3)", letterSpacing: ".06em" }}>
            <span style={{ flex: 1 }}>MARKET</span>
            <span style={{ width: 80, textAlign: "right" }}>PRICE</span>
            <span style={{ width: 62, textAlign: "right" }}>GAP</span>
          </div>
          {rows.map((m) => {
            const p = premium(m);
            return (
              <button
                key={m.c}
                type="button"
                className={`mdrop-row${m.c === market.c ? " on" : ""}`}
                onClick={() => {
                  setMarket(m.c);
                  setOpen(false);
                  setQ("");
                }}
              >
                <span className="cur sm" style={{ fontSize: m.sym.length > 2 ? 10 : 12 }}>{m.sym}</span>
                <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <b style={{ fontWeight: 500, fontSize: 14, display: "block" }}>USD/{m.c}</b>
                  <span style={{ fontSize: 11, color: "var(--ink3)" }}>{m.lev}x · {m.st}</span>
                </span>
                <span className="mono" style={{ width: 80, textAlign: "right", fontSize: 13 }}>
                  {fmt(m.px, m.dp)}
                </span>
                <span className="mono" style={{ width: 62, textAlign: "right", fontSize: 12, color: "var(--amb)" }}>
                  {p >= 0 ? "+" : ""}{p.toFixed(1)}%
                </span>
              </button>
            );
          })}
          {rows.length === 0 && (
            <p style={{ padding: 16, margin: 0, fontSize: 13, color: "var(--ink3)" }}>No match.</p>
          )}
        </div>
      )}
    </div>
  );
}
