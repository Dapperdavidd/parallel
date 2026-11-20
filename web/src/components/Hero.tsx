"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Hero: looping background video, the floating glass logo over it, headline
 * bottom-left.
 *
 * The glass logo behaviour is specified in the design hand-off notes and is
 * implemented entirely in CSS (classes .logo-float / .logo-bob / .logo-shadow
 * / .logo-sweep, keyframes bob / shadow / sweep):
 *
 *   8-second cycle, matching the video so they feel in sync
 *   1. float   rises 5.4% of its own height by 4s, back down by 8s, eased
 *   2. tilt    −1.5deg at the top of the float
 *   3. shadow  shrinks to 82% and fades to 55% as it rises
 *   4. sweep   one soft highlight crosses the glass right-to-left, 5s → 6.2s,
 *              clipped to the logo's shape with a CSS mask of the same PNG
 *   5. reduced motion stops all of it
 *
 * No JS animation loop and no canvas, so it stays cheap on a phone.
 */
export function Hero() {
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Portrait source for tall screens, chosen once on mount. Doing this in an
  // effect rather than markup keeps the server render identical for everyone.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      v.removeAttribute("autoplay");
      v.pause();
      return;
    }
    if (window.innerHeight > window.innerWidth) {
      const s = document.createElement("source");
      s.src = "/media/parallel-bg-portrait.mp4";
      s.type = "video/mp4";
      v.prepend(s);
      v.load();
      void v.play().catch(() => {
        /* autoplay can be refused; the poster still shows */
      });
    }
  }, []);

  // The hero shrinks and fades as it scrolls away.
  useEffect(() => {
    const onScroll = (): void => {
      const hc = cardRef.current;
      if (!hc) return;
      const r = hc.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, -r.top / (r.height * 0.9)));
      hc.style.transform = `scale(${1 - t * 0.16})`;
      hc.style.borderRadius = `${32 + t * 24}px`;
      hc.style.opacity = `${1 - t * 0.6}`;
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section className="hero" aria-label="Hero">
      <div className="hero-card" ref={cardRef}>
        <video
          ref={videoRef}
          className="hero-video"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster="/media/parallel-bg-poster.jpg"
        >
          <source src="/media/parallel-bg-1080.webm" type="video/webm" />
          <source src="/media/parallel-bg-1080.mp4" type="video/mp4" />
        </video>
        <div className="hero-video-shade" />

        {/* Glass logo — spec in the comment above. */}
        <div className="logo-float" aria-hidden="true">
          <div className="logo-shadow" />
          <div className="logo-bob">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/media/parallel-logo-glass.png" alt="" />
            <div className="logo-sweep" />
          </div>
        </div>

        <div className="hero-bottom">
          <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 720 }}>
            <span
              className="pill-tag"
              style={{
                alignSelf: "flex-start",
                border: "1px solid #F2A93B55",
                background: "#F2A93B14",
                color: "var(--amb)",
              }}
            >
              Live on Solana devnet
            </span>
            <h1>
              Trade the
              <br />
              parallel rate.
            </h1>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <p>
              Long or short the dollar against the naira, the peso, the rupee and more.
              Priced from the street rate people actually pay.
            </p>
            <div>
              <Link
                href="/app/trade"
                className="btn btn-pri"
                style={{ height: 54, padding: "0 34px", fontSize: 16 }}
              >
                Trade
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
