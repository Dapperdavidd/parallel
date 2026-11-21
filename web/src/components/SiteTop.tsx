"use client";

import { useEffect, useRef, useState } from "react";
import { TopBanner, LandingNav } from "./LandingNav";

/**
 * The persistent top panel: banner plus nav, visible for the whole page.
 *
 * The hero is pulled up behind this block (`.hero-track` has a negative
 * margin) so the video still starts at the very top of the viewport. That
 * offset has to match this block's real height, which changes when the banner
 * text wraps on a phone, so it is measured rather than hard-coded.
 */
export function SiteTop() {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = (): void => {
      document.documentElement.style.setProperty("--top-h", `${el.offsetHeight}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    addEventListener("resize", set);
    // Over the hero the panel is glass on video; once content starts passing
    // underneath it needs a solid backdrop or the type collides.
    const onScroll = (): void => setScrolled(window.scrollY > 40);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });

    return () => {
      ro.disconnect();
      removeEventListener("resize", set);
      removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div className={`site-top${scrolled ? " scrolled" : ""}`} ref={ref}>
      <TopBanner />
      <LandingNav />
    </div>
  );
}
