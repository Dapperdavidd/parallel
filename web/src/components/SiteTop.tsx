"use client";

import { useEffect, useRef, useState } from "react";
import { LandingNav } from "./LandingNav";

/**
 * The persistent top panel.
 *
 * Over the hero it is completely bare — no glass, no blur, no panel — so the
 * mark and links simply sit on the video. It only takes on a background once
 * the page has scrolled far enough that content would otherwise run underneath
 * it, and it fades in rather than snapping to black.
 */
export function SiteTop() {
  const ref = useRef<HTMLDivElement>(null);
  const [solid, setSolid] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const set = (): void => {
      document.documentElement.style.setProperty("--top-h", `${el.offsetHeight}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);

    // Ramp the backdrop in across the second half of the hero rather than
    // flipping it on, so the panel never appears to "go black".
    const onScroll = (): void => {
      const h = window.innerHeight || 1;
      setSolid(Math.min(1, Math.max(0, (window.scrollY - h * 0.55) / (h * 0.45))));
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", set);

    return () => {
      ro.disconnect();
      removeEventListener("resize", set);
      removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div
      className="site-top"
      ref={ref}
      style={
        {
          "--solid": solid,
        } as React.CSSProperties
      }
    >
      <LandingNav />
    </div>
  );
}
