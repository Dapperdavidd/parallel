"use client";

import { useEffect, useState } from "react";
import { compactUsd, fmt, statsFor } from "@/lib/mock";
import type { MarketView } from "@/lib/live";

/**
 * The numbers across the top of the terminal.
 *
 * Three kinds of figure share this row, and they are not equally real:
 *
 *   - **measured** — mark, index, official rate, the gap, the 24h change.
 *     These come from the index service and carry a timestamp.
 *   - **sample** — volume, open interest, funding, the day's range. There are
 *     no real trades to measure yet, so these are the mock file's values.
 *   - **stale** — a measured figure whose market has since paused, so what is
 *     on screen is the last thing we knew rather than the current price.
 *
 * Before, all three rendered identically. A trader reading "24h volume
 * $412,083" had no way to know nobody had traded, and a paused market showed
 * its sample price from the day the mock file was written as though it were
 * live. Every figure here now says which kind it is.
 */

/** Past this, "live" is not the right word for it. */
const STALE_AFTER_SECONDS = 360;

function Stat({
  label,
  value,
  color,
  hint,
  kind = "measured",
}: {
  label: string;
  value: string;
  color?: string;
  hint?: string;
  kind?: "measured" | "sample" | "stale";
}) {
  const suffix =
    kind === "sample"
      ? " · sample figure, not a measurement"
      : kind === "stale"
        ? " · the last figure we measured, not the current one"
        : "";
  return (
    <div className={kind === "measured" ? "hstat" : `hstat is-${kind}`}>
      <span className="hstat-l" title={hint ? `${hint}${suffix}` : suffix.slice(3) || undefined}>
        {label}
        {kind !== "measured" && <i className="hstat-tag">{kind}</i>}
      </span>
      <b className="hstat-v mono" style={color ? { color } : undefined}>
        {value}
      </b>
    </div>
  );
}

const countdown = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

/** "12s ago", "4m ago", "2h ago" — short enough to sit in a pill. */
function ago(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

export function MarketStats({ market }: { market: MarketView }) {
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

  const stale = market.ageSeconds !== null && market.ageSeconds > STALE_AFTER_SECONDS;
  // A measured figure is only "measured" while the measurement is current.
  const priceKind = market.priceIsSample ? "sample" : stale ? "stale" : "measured";

  const change = market.live ? market.change24hPct : null;
  const up = (change ?? 0) >= 0;
  const gap = market.off > 0 ? (market.px / market.off - 1) * 100 : null;
  const span = Math.max(s.high24h - s.low24h, 1e-9);
  const markPos = Math.min(100, Math.max(0, ((s.mark - s.low24h) / span) * 100));

  return (
    <div className="hstats">
      {/* Where the data stands, before any number that depends on it. */}
      <div
        className={`hstat hfresh is-${market.paused ? "down" : stale ? "stale" : market.live ? "live" : "sample"}`}
        title={
          market.pausedBecause ??
          (market.live
            ? `Measured from ${market.sourceCount} of ${market.sourcesTried} sources`
            : "Sample data: the index has not priced this market yet")
        }
      >
        <span className="hstat-l">Index</span>
        <b className="hstat-v">
          <span className="fresh-dot" />
          {market.paused
            ? "Paused"
            : market.live
              ? `${market.ageSeconds === null ? "live" : ago(market.ageSeconds)} · ${market.sourceCount}/${market.sourcesTried} sources`
              : "Sample data"}
        </b>
      </div>

      {/* Mark and index are different numbers, and the gap between them is
          where a fill actually lands. This row showed the index under both
          labels, which made the distinction the tooltip promised invisible. */}
      <Stat
        label="Mark"
        value={market.mark === null ? "—" : fmt(market.mark, market.dp)}
        hint={
          market.mark === null
            ? "The engine's price is not readable right now."
            : `The engine's effective price, read from the chain. Positions are marked against this.${
                market.basisBps === null
                  ? ""
                  : ` It sits ${(market.basisBps / 100).toFixed(2)}% from the index.`
              }`
        }
        kind={market.mark === null ? "sample" : stale ? "stale" : "measured"}
      />
      <Stat
        label="Index"
        value={fmt(market.px, market.dp)}
        hint="Median of the street sources. The mark walks toward it."
        kind={priceKind}
      />
      <Stat
        label="Basis"
        value={market.basisBps === null ? "—" : `${market.basisBps >= 0 ? "+" : ""}${(market.basisBps / 100).toFixed(2)}%`}
        color={market.basisBps === null ? undefined : "var(--ink2)"}
        hint="Mark against index. The keeper pushes a new price on a 0.1% move or every ten minutes, so this is how stale the engine's price is."
        kind={market.basisBps === null ? "sample" : "measured"}
      />
      <Stat
        label="24h change"
        value={change === null ? "—" : `${up ? "+" : ""}${change.toFixed(2)}%`}
        color={change === null ? undefined : up ? "var(--up)" : "var(--dn)"}
        hint={
          change === null
            ? "Needs a full day of measured prices. We do not estimate it."
            : "Measured against the index a day ago."
        }
        kind={change === null ? "sample" : priceKind}
      />
      <Stat
        label="Official"
        value={fmt(market.off, market.dp)}
        hint="The official rate, for comparison. Never part of the median."
        kind={priceKind}
      />
      <Stat
        label="Street gap"
        value={gap === null ? "—" : `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`}
        color="var(--amb)"
        hint="How far the street price sits above the official rate."
        kind={priceKind}
      />
      <Stat
        label="24h volume"
        value={compactUsd(s.volume24hUsd)}
        kind="sample"
        hint="No real volume to measure yet: this market has had no trades."
      />
      <Stat
        label="Open interest"
        value={
          market.openInterestUsdc === null
            ? compactUsd(s.openInterestUsd)
            : compactUsd(market.openInterestUsdc)
        }
        kind={market.openInterestUsdc === null ? "sample" : "measured"}
        hint={
          market.openInterestUsdc === null
            ? "Sample figure. The vault panel shows the real capital behind this market."
            : "Both sides of the engine's open interest, read from the chain."
        }
      />
      <Stat
        label={`Funding / ${left === null ? "--:--" : countdown(left)}`}
        value={`${s.fundingPct >= 0 ? "+" : ""}${s.fundingPct.toFixed(4)}%`}
        color={s.fundingPct >= 0 ? "var(--up)" : "var(--dn)"}
        kind="sample"
        hint="Positive means longs pay shorts. The deployed engine does not accrue funding yet."
      />
      <Stat
        label="Contract"
        value={market.unitLabel}
        hint="Each contract is this much local currency."
      />

      {/* Where the mark sits in the day's range — the one thing the numbers
          above cannot show you at a glance. */}
      <div className="hstat hrange" title="24h range, with the mark price marked">
        <span className="hstat-l">
          24h range
          <i className="hstat-tag">sample</i>
        </span>
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
