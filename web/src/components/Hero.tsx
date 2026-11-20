"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TopBanner, LandingNav } from "./LandingNav";

/**
 * Full-bleed hero.
 *
 * The background video covers the entire viewport; the banner, nav, glass logo
 * and headline all sit on top of it. The footage is bright daylight, so the
 * scrim (.hero-scrim) does real work — without it white type on the sky is
 * unreadable.
 *
 * The source has no audio track at all, so there is nothing to mute and no
 * reason for a sound control. It is still marked `muted` because browsers
 * refuse to autoplay otherwise.
 *
 * The glass logo behaviour is unchanged and still pure CSS, per the design
 * hand-off notes: an 8-second cycle matching the loop — float to 5.4% of its
 * own height, −1.5deg tilt, shadow shrinking to 82% and fading to 55%, and one
 * light sweep across the glass from 5s to 6.2s clipped to the logo's shape.
 * All of it stops under prefers-reduced-motion.
 */
export function Hero() {
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

    // Serve the lighter encode to small screens and to anyone on a metered
    // connection. 2.7 MB instead of 7.1 MB, and at phone size it is
    // indistinguishable.
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
      /* autoplay can still be refused; the poster carries the frame */
    });
  }, []);

  // Gentle parallax: the video drifts and dims as the hero scrolls away.
  useEffect(() => {
    if (reduced) return;
    const onScroll = (): void => {
      const v = videoRef.current;
      if (!v) return;
      const t = Math.min(1, Math.max(0, window.scrollY / window.innerHeight));
      v.style.transform = `scale(${1 + t * 0.08}) translateY(${t * 4}%)`;
      v.style.opacity = `${1 - t * 0.35}`;
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, [reduced]);

  return (
    <section className="hero-full" aria-label="Hero">
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

      <div className="hero-scrim" />

      <div className="hero-chrome">
        <TopBanner />
        <LandingNav />
      </div>

      {/* Glass logo — floats over the video, behind the headline. */}
      <div className="logo-float" aria-hidden="true">
        <div className="logo-shadow" />
        <div className="logo-bob">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/media/parallel-logo-glass.png" alt="" />
          <div className="logo-sweep" />
        </div>
      </div>

      <div className="hero-copy">
        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 720 }}>
          <span
            className="pill-tag"
            style={{
              alignSelf: "flex-start",
              border: "1px solid #F2A93B66",
              background: "rgba(242,169,59,.14)",
              color: "var(--amb)",
              backdropFilter: "blur(6px)",
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
            Long or short the dollar against the naira, the peso, the rupee and more. Priced
            from the street rate people actually pay.
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

      <div className="hero-cue" aria-hidden="true">
        <i />
        SCROLL
      </div>
    </section>
  );
}
