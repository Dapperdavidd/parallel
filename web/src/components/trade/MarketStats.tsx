"use client";

import { useEffect, useState } from "react";
import { compactUsd, fmt, premium, statsFor, type Market } from "@/lib/mock";

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

  const gap = premium(market);
  const up = s.change24hPct >= 0;

  return (
    <div className="hstats">
      <Stat
        label="Mark"
        value={fmt(s.mark, market.dp)}
        hint="The engine's effective price. Positions are marked against this."
      />
      <Stat
        label="Index"
        value={fmt(s.index, market.dp)}
        hint="Median of the street sources. The mark walks toward it."
      />
      <Stat
        label="24h change"
        value={`${up ? "+" : ""}${s.change24hPct.toFixed(2)}%`}
        color={up ? "var(--up)" : "var(--dn)"}
      />
      <Stat
        label="Official"
        value={fmt(market.off, market.dp)}
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
    </div>
  );
}
