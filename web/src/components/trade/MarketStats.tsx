"use client";

import { useEffect, useState } from "react";
import { compactUsd, fmt, premium, statsFor, type Market } from "@/lib/mock";
import { useLive } from "@/lib/live";

function Stat({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: string;
  color?: string;
  hint?: string;
}) {
  return (
    <div className="hstat">
      <span className="hstat-l" title={hint}>{label}</span>
      <b className="hstat-v mono" style={color ? { color } : undefined}>{value}</b>
    </div>
  );
}

const countdown = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

export function MarketStats({ market }: { market: Market }) {
  const s = statsFor(market);
  const { byCode } = useLive();
  const live = byCode.get(market.c);

  // Mark, index and official have a live source; volume, open interest and
  // funding do not yet — they stay sample values until there are real trades
  // to measure, and the devnet chip on the top bar says this is a test net.
  const index = live?.median ?? s.index;
  const mark = live?.median ?? s.mark;
  const official = live?.official ?? market.off;
  const change = live?.change24hPct ?? s.change24hPct;
  const paused = live ? !live.acceptingPositions : false;

  /**
   * The funding countdown depends on the wall clock, so rendering it during
   * SSR guarantees a hydration mismatch. Start blank, fill in after mount,
   * then tick — which is what a countdown should do anyway.
   */
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = (): void => setLeft(3600 - (Math.floor(Date.now() / 1000) % 3600));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const gap =
    live?.premiumPct ?? premium(market);
  const up = change >= 0;
  const span = Math.max(s.high24h - s.low24h, 1e-9);
  const markPos = Math.min(100, Math.max(0, ((s.mark - s.low24h) / span) * 100));

  return (
    <div className="hstats">
      <Stat
        label="Mark"
        value={fmt(mark, market.dp)}
        hint="The engine's effective price. Positions are marked against this."
      />
      <Stat
        label="Index"
        value={fmt(index, market.dp)}
        hint="Median of the street sources. The mark walks toward it."
      />
      <Stat
        label="24h change"
        value={`${up ? "+" : ""}${change.toFixed(2)}%`}
        color={up ? "var(--up)" : "var(--dn)"}
      />
      <Stat
        label="Official"
        value={fmt(official, market.dp)}
        hint="The official rate, for comparison. Never part of the median."
      />
      <Stat
        label="Street gap"
        value={`${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`}
        color="var(--amb)"
        hint="How far the street price sits above the official rate."
      />
      <Stat label="24h volume" value={compactUsd(s.volume24hUsd)} />
      <Stat label="Open interest" value={compactUsd(s.openInterestUsd)} />
      <Stat
        label={`Funding / ${left === null ? "--:--" : countdown(left)}`}
        value={`${s.fundingPct >= 0 ? "+" : ""}${s.fundingPct.toFixed(4)}%`}
        color={s.fundingPct >= 0 ? "var(--up)" : "var(--dn)"}
        hint="Positive means longs pay shorts."
      />
      <Stat label="Contract" value={market.unitLabel} hint="Each contract is this much local currency." />

      {paused && (
        <div className="hstat" title={live?.reason ?? undefined}>
          <span className="hstat-l">Status</span>
          <b className="hstat-v" style={{ color: "var(--dn)" }}>
            Paused
          </b>
        </div>
      )}

      {/* Where the mark sits in the day's range — the one thing the numbers
          above cannot show you at a glance. */}
      <div className="hstat hrange" title="24h range, with the mark price marked">
        <span className="hstat-l">24h range</span>
        <div className="hrange-row">
          <b className="mono">{fmt(s.low24h, market.dp)}</b>
          <span className="hrange-track">
            <span className="hrange-dot" style={{ left: `${markPos}%` }} />
          </span>
          <b className="mono">{fmt(s.high24h, market.dp)}</b>
        </div>
      </div>
    </div>
  );
}
