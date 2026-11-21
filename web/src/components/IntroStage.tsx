"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MarketRows } from "./MarketsTable";
import { LANDING_ROWS } from "@/lib/mock";

/**
 * Hero → markets, as one continuous move.
 *
 * The reference does not scroll the hero away and bring a new section up. It
 * shrinks ONE rectangle: the video fills the viewport, then contracts to the
 * exact box the next card occupies, and the two contents cross-fade through
 * each other on the way. Mid-transition you can see both.
 *
 * So both live in the same frame here, and scroll drives the frame's geometry:
 *
 *   p = 0    frame is the full viewport, video at full opacity
 *   p ~ .5   heading fades in above the frame
 *   p ~ .6   video fades out as the markets table fades in
 *   p = 1    frame is an inset rounded card, markets only
 *
 * The markets table is deliberately short — it has to fit the frame at its
 * final size, which is the whole point of the effect.
 */
export function IntroStage() {
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduced(true);
      v.removeAttribute("autoplay");
      v.pause();
      return;
    }

    type Conn = { saveData?: boolean; effectiveType?: string };
    const conn = (navigator as Navigator & { connection?: Conn }).connection;
    const light =
      window.innerWidth <= 820 ||
      conn?.saveData === true ||
      (conn?.effectiveType ? /2g|3g/.test(conn.effectiveType) : false);

    if (light) {
      v.innerHTML = "";
      const s = document.createElement("source");
      s.src = "/media/parallel-hero-720.mp4";
      s.type = "video/mp4";
      v.append(s);
      v.load();
    }
    void v.play().catch(() => {
      /* autoplay can be refused; the poster carries the frame */
    });
  }, []);

  useEffect(() => {
    if (reduced) return;
    const track = trackRef.current;
    const stage = stageRef.current;
    const frame = frameRef.current;
    if (!track || !stage || !frame) return;

    let raf = 0;
    const apply = (): void => {
      raf = 0;
      const total = track.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      // Run the whole move over the first 62% of the pinned range, then hold
      // the finished card for the rest so it can actually be read before the
      // page carries on.
      const raw = Math.min(1, Math.max(0, -track.getBoundingClientRect().top / total) / 0.62);
      const c = Math.min(1, raw);
      const p = c * c * (3 - 2 * c); // smoothstep

      const w = stage.clientWidth;
      const h = stage.clientHeight;

      // Where the card ends up: centred, with room for the heading above.
      const gutter = Math.max(20, Math.min(72, w * 0.045));
      const targetW = Math.min(1180, w - gutter * 2);
      const headRoom = Math.min(252, Math.max(170, h * 0.28));
      const targetH = Math.min(h - headRoom - 40, 600);

      const sideInset = ((w - targetW) / 2) * p;
      const topInset = headRoom * p;
      const bottomInset = Math.max(0, h - headRoom - targetH) * p;

      // The heading owns exactly the band the card leaves empty above it.
      stage.style.setProperty("--head-h", `${headRoom}px`);

      frame.style.inset = `${topInset}px ${sideInset}px ${bottomInset}px ${sideInset}px`;
      frame.style.borderRadius = `${p * 26}px`;

      const band = (from: number, to: number): number =>
        Math.min(1, Math.max(0, (p - from) / (to - from)));

      stage.style.setProperty("--copy-o", String(1 - band(0.04, 0.3)));
      stage.style.setProperty("--head-o", String(band(0.64, 0.9)));
      stage.style.setProperty("--video-o", String(1 - band(0.52, 0.86)));
      stage.style.setProperty("--table-o", String(band(0.56, 0.9)));
      stage.style.setProperty("--logo-o", String(1 - band(0.3, 0.62)));
    };

    const onScroll = (): void => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    apply();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  return (
    <div className={`intro${reduced ? " intro-static" : ""}`} ref={trackRef} id="markets">
      <div className="intro-stage" ref={stageRef}>
        {/* The heading that the frame shrinks to sit beneath. */}
        <div className="intro-head">
          <span
            className="pill-tag"
            style={{ border: "1px solid #3D5CF566", background: "#3D5CF514", color: "var(--pri-t)" }}
          >
            Street-rate index
          </span>
          <h2 className="h2">Two prices. Trade the real one.</h2>
        </div>

        {/* One rectangle. Two contents. */}
        <div className="intro-frame" ref={frameRef}>
          <div className="intro-video">
            <video
              ref={videoRef}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster="/media/parallel-hero-poster.jpg"
              aria-hidden="true"
            >
              <source src="/media/parallel-hero-1080.webm" type="video/webm" />
              <source src="/media/parallel-hero-1080.mp4" type="video/mp4" />
            </video>

            <div className="logo-float" aria-hidden="true">
              <div className="logo-shadow" />
              <div className="logo-bob">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/media/parallel-logo-glass.png" alt="" />
                <div className="logo-sweep" />
              </div>
            </div>

            <div className="hero-copy">
              <div className="hero-copy-left">
                <span
                  className="pill-tag"
                  style={{
                    alignSelf: "flex-start",
                    border: "1px solid #F2A93B66",
                    background: "rgba(242,169,59,.16)",
                    color: "var(--amb)",
                  }}
                >
                  Live on Solana devnet
                </span>
                <h1>Trade the parallel rate.</h1>
              </div>
              <div className="hero-copy-right">
                <p>
                  Long or short the dollar against the naira, the peso, the rupee and more.
                  Priced from the street rate people actually pay.
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Link href="/app/trade" className="btn btn-light" style={{ height: 50, padding: "0 26px" }}>
                    Start trading
                  </Link>
                  <Link href="/docs" className="btn btn-glass" style={{ height: 50, padding: "0 22px" }}>
                    How it works
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <div className="intro-table">
            <div className="mtable">
              <MarketRows codes={LANDING_ROWS} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
