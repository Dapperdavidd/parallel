"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * Landing hero.
 *
 * The video fills the viewport with no dark gradients over it — the footage is
 * the point, so legibility comes from a text shadow on the copy rather than
 * from fading the picture out at the top and bottom.
 *
 * Exit: scrolling does not push the hero away. The stage ZOOMS OUT — shrinking
 * and rounding until it is a card the width of the section below — so the
 * video appears to become the frame that "Two prices. Trade the real one."
 * sits in. Scrolling back up reverses it exactly.
 *
 * The glass logo keeps the hand-off spec and is still pure CSS: an 8-second
 * cycle, float to 5.4% of its own height, −1.5deg tilt, shadow to 82%/55%, and
 * one light sweep from 5s to 6.2s clipped to the logo's shape. All of it stops
 * under prefers-reduced-motion. The glass mark is used ONLY here; the app's
 * logo is the flat amber/blue mark in <Mark />.
 */
export function Hero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLElement>(null);
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

    // Lighter encode for small screens and metered connections.
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

  // Zoom-out exit, driven by scroll position through the track.
  useEffect(() => {
    if (reduced) return;
    const stage = stageRef.current;
    if (!stage) return;

    let raf = 0;
    const apply = (): void => {
      raf = 0;
      const vh = window.innerHeight || 1;
      // The zoom runs over the first viewport of scrolling.
      const p = Math.min(1, Math.max(0, window.scrollY / vh));
      const ease = p * p * (3 - 2 * p); // smoothstep

      // Shrink toward the width of the content column below, and round off,
      // so the video reads as becoming that section's frame.
      // Shrink to roughly the width of the card in the section below, round
      // off, then hand over: the last stretch fades the stage out so the next
      // section's card appears to be what the video became.
      stage.style.transform = `scale(${1 - ease * 0.16})`;
      stage.style.borderRadius = `${ease * 30}px`;
      stage.style.opacity = `${1 - ease * 0.35}`;
      // Nothing to paint once it is fully covered.
      stage.style.visibility = p >= 1 ? "hidden" : "visible";

      const copy = stage.querySelector<HTMLElement>(".hero-copy");
      if (copy) copy.style.opacity = `${1 - Math.min(1, ease * 2.6)}`;
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
    <section className="hero-full" aria-label="Hero" ref={stageRef}>
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

        {/* Glass logo — floats over the video. Landing hero only. */}
        <div className="logo-float" aria-hidden="true">
          <div className="logo-shadow" />
          <div className="logo-bob">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/media/parallel-logo-thick-glass.png" alt="" />
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
                backdropFilter: "blur(6px)",
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
              <Link href="/#markets" className="btn btn-glass" style={{ height: 50, padding: "0 22px" }}>
                See markets ↓
              </Link>
            </div>
          </div>
        </div>
    </section>
  );
}
