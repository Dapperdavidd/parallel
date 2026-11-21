"use client";

import { useEffect, useRef, useState } from "react";
import { byCode, fmt, premium, FEATURES } from "@/lib/mock";
import { Mark } from "./Brand";

function MockTop({ label }: { label: string }) {
  return (
    <div className="mock-top">
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--ink)" }}>
        <Mark size={18} />
        Parallel
      </span>
      <span>{label}</span>
    </div>
  );
}

/** Deterministic candle sketch, so screenshots are reproducible. */
function MiniCandles({ seed, height = 140 }: { seed: number; height?: number }) {
  let r = seed;
  const rnd = (): number => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
  const n = 34;
  let p = 50;
  const bars: { o: number; c: number; h: number; l: number }[] = [];
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = o + (rnd() - 0.42) * 4;
    bars.push({ o, c, h: Math.max(o, c) + rnd() * 2, l: Math.min(o, c) - rnd() * 2 });
    p = c;
  }
  const all = bars.flatMap((b) => [b.h, b.l]);
  const hi = Math.max(...all);
  const lo = Math.min(...all);
  const y = (v: number): number => ((hi - v) / (hi - lo || 1)) * height;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${n * 7} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b, i) => {
        const x = i * 7 + 3.5;
        const col = b.c >= b.o ? "#2EBD85" : "#E5484D";
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth="1" />
            <rect x={x - 2.2} y={y(Math.max(b.o, b.c))} width="4.4" height={Math.max(1.5, Math.abs(y(b.o) - y(b.c)))} fill={col} />
          </g>
        );
      })}
    </svg>
  );
}

function ScreenTrade() {
  const m = byCode("NGN");
  return (
    <div className="mock">
      <MockTop label="USD/NGN · devnet" />
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "baseline" }}>
          <b className="mono" style={{ fontSize: 26 }}>{fmt(m.px, m.dp)}</b>
          <span style={{ fontSize: 13, color: "var(--amb)" }}>+{premium(m).toFixed(1)}% vs official</span>
          <span style={{ fontSize: 13, color: "var(--ink3)" }}>{m.lev}x max</span>
        </div>
        <MiniCandles seed={1337} />
        <div style={{ display: "flex", gap: 8 }}>
          <span className="btn" style={{ flex: 1, height: 40, background: "var(--up)", color: "#06150E", fontSize: 13 }}>Long USD</span>
          <span className="btn btn-ghost" style={{ flex: 1, height: 40, fontSize: 13 }}>Short USD</span>
        </div>
      </div>
    </div>
  );
}

function ScreenHedge() {
  return (
    <div className="mock">
      <MockTop label="Hedge mode" />
      <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
        <span style={{ fontSize: 12, letterSpacing: ".1em", color: "var(--amb)" }}>HEDGE MODE</span>
        <span style={{ fontSize: 21, lineHeight: 1.35 }}>Protect ₦2,000,000 against the naira falling.</span>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="kv">
            <span style={{ fontSize: 12, color: "var(--ink3)" }}>Hedge size</span>
            <b className="mono">1,391.30 tUSDC</b>
          </div>
          <div className="kv">
            <span style={{ fontSize: 12, color: "var(--ink3)" }}>If naira −10%</span>
            <b className="mono" style={{ color: "var(--up)" }}>+139.13</b>
          </div>
        </div>
        <span className="btn btn-pri" style={{ height: 44, fontSize: 14 }}>Turn on hedge</span>
      </div>
    </div>
  );
}

function ScreenIndex() {
  const m = byCode("NGN");
  return (
    <div className="mock">
      <MockTop label="Index · USD/NGN" />
      <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <b style={{ fontSize: 16 }}>Median of {m.src.length} sources</b>
          <span className="mono" style={{ fontSize: 16 }}>{fmt(m.px, m.dp)}</span>
        </div>
        {m.src.map((s, i) => (
          <div className="row" key={s}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="dot" style={{ background: "var(--up)" }} />
              {s}
            </span>
            <b>{fmt(m.px * (1 + (i - 1) * 0.0012), m.dp)}</b>
          </div>
        ))}
        <div className="row" style={{ borderTop: "1px solid var(--ln)", paddingTop: 10 }}>
          <span>Official rate</span>
          <b>{fmt(m.off, m.dp)}</b>
        </div>
        <span style={{ fontSize: 12, color: "var(--ink3)" }}>Pushed on-chain 47 seconds ago</span>
      </div>
    </div>
  );
}

function ScreenPortfolio() {
  return (
    <div className="mock">
      <MockTop label="Portfolio" />
      <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--ink3)" }}>Balance</div>
            <b className="mono" style={{ fontSize: 24 }}>10,000.00</b>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--ink3)" }}>Open P&amp;L</div>
            <b className="mono" style={{ fontSize: 24, color: "var(--up)" }}>+128.40</b>
          </div>
        </div>
        {[["USD/NGN", "Long 3x", "+84.20"], ["USD/ARS", "Long 2x", "+44.20"]].map(([a, b, c]) => (
          <div className="row" key={a}>
            <span>{a} <span style={{ color: "var(--ink3)" }}>{b}</span></span>
            <b style={{ color: "var(--up)" }}>{c}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

const SCREENS = [ScreenTrade, ScreenHedge, ScreenIndex, ScreenPortfolio];

/** Hash targets so the nav's Trade and Hedge links land on the right step. */
const ANCHORS = ["feature-trade", "feature-hedge", "feature-index", "feature-portfolio"];

/**
 * "Built for the gap" — a pinned scroll sequence.
 *
 * The track is tall (one viewport per feature); the stage inside is sticky and
 * fills the screen. Scrolling swaps the feature IN PLACE — text and mock screen
 * both crossfade from nothing and back to nothing — instead of the reader
 * scrolling past four stacked blocks.
 */
export function FeatureScroll() {
  const trackRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const n = FEATURES.length;

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    let raf = 0;
    const update = (): void => {
      raf = 0;
      const rect = track.getBoundingClientRect();
      const total = track.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      const p = Math.min(0.9999, Math.max(0, -rect.top / total));
      setActive(Math.min(n - 1, Math.floor(p * n)));
    };
    const onScroll = (): void => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [n]);

  /** Jump to the slice of the track that shows feature `i`. */
  const goTo = (i: number): void => {
    const track = trackRef.current;
    if (!track) return;
    const total = track.offsetHeight - window.innerHeight;
    const y = track.offsetTop + (total * (i + 0.5)) / n;
    scrollTo({ top: y, behavior: "smooth" });
  };

  return (
    <section
      className="feat-track"
      id="features"
      ref={trackRef}
      style={{ height: `${(n + 1) * 100}svh` }}
    >
      {/* Anchors the nav links target, one per step. */}
      {ANCHORS.map((id, i) => (
        <span
          key={id}
          id={id}
          aria-hidden="true"
          style={{ position: "absolute", top: `${i * 100}svh`, width: 1, height: 1 }}
        />
      ))}

      <div className="feat-stage">
        <div className="wrap">
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 36 }}>
            <span className="eyebrow">INSIDE THE APP</span>
            <h2 className="h2">Built for the gap.</h2>
          </div>

          <div className="feat-stage-inner">
            <div className="feat-screen">
              {SCREENS.map((S, i) => (
                <div key={i} className={i === active ? "on" : undefined}>
                  <div className="glowframe" style={{ borderRadius: 30, padding: 8 }}>
                    <S />
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div className="feat-text">
                {FEATURES.map(([title, body], i) => (
                  <div key={title} className={i === active ? "on" : undefined}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                ))}
              </div>

              <div className="feat-dots" role="tablist" aria-label="Features">
                {FEATURES.map(([title], i) => (
                  <button
                    key={title}
                    type="button"
                    role="tab"
                    aria-selected={i === active}
                    aria-label={title}
                    className={i === active ? "on" : undefined}
                    onClick={() => goTo(i)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
