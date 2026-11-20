"use client";

import { useEffect, useRef } from "react";

interface Candle {
  x: number;
  o: number;
  c: number;
  dots: [number, number, number, number, number][];
  born: number;
  col: [number, number, number];
}

/**
 * The endless rising "particle candles" behind the sign-up CTA.
 * Ported from the design hand-off prototype.
 *
 * Pauses when the tab is hidden, and does not start at all when the visitor
 * prefers reduced motion — it draws one static frame instead.
 */
export function CtaCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0, dpr = 1;
    const cands: Candle[] = [];
    let price = 0, camY = 0, t = 0, last = 0, raf = 0;
    const CW = 62, SPEED = 16; // px per second

    const size = (): void => {
      dpr = Math.min(2, devicePixelRatio || 1);
      W = cv.clientWidth;
      H = cv.clientHeight;
      cv.width = W * dpr;
      cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const newCandle = (x: number): void => {
      const o = price;
      const c = o + (Math.random() * 1.0 + 0.45) * (Math.random() < 0.72 ? 1 : -0.75) * 42;
      const hi = Math.max(o, c) + Math.random() * 16 + 4;
      const lo = Math.min(o, c) - Math.random() * 16 - 4;
      price = c;
      const dots: Candle["dots"] = [];
      const n = 190;
      for (let i = 0; i < n; i++) {
        const body = i < n * 0.78;
        const y = body
          ? Math.min(o, c) + Math.random() * Math.max(6, Math.abs(c - o))
          : lo + Math.random() * (hi - lo);
        dots.push([
          body ? (Math.random() - 0.5) * CW * 0.5 : (Math.random() - 0.5) * 3,
          y,
          Math.random() * 1.3 + 0.5,
          Math.random() * 0.6 + 0.3,
          Math.random() * 6.28,
        ]);
      }
      cands.push({ x, o, c, dots, born: t, col: c >= o ? [123, 147, 255] : [242, 169, 59] });
    };

    size();
    const onResize = (): void => size();
    addEventListener("resize", onResize);

    let x0 = 0;
    for (let i = 0; i < Math.ceil((cv.clientWidth || 800) / CW) + 2; i++) {
      newCandle(x0);
      x0 += CW;
    }

    const draw = (): void => {
      const vis = cands.filter((k) => k.x > -CW && k.x < W + CW);
      if (vis.length === 0) return;
      const mid =
        (Math.max(...vis.map((k) => Math.max(k.o, k.c))) +
          Math.min(...vis.map((k) => Math.min(k.o, k.c)))) / 2;
      camY += (mid - camY) * 0.4;
      const span = Math.max(
        200,
        (Math.max(...vis.map((k) => k.c)) - Math.min(...vis.map((k) => k.c))) * 1.5,
      );
      const sc = (H * 0.78) / span;
      ctx.clearRect(0, 0, W, H);
      for (const k of cands) {
        const age = Math.min(1, (t - k.born) / 1.4);
        const fade = Math.min(1, Math.max(0, k.x / (W * 0.35)));
        for (const d of k.dots) {
          const yy = H / 2 - (d[1] - camY) * sc;
          const xx = k.x + d[0] + CW / 2;
          const tw = 0.75 + 0.25 * Math.sin(t * 2 + d[4]);
          ctx.fillStyle = `rgba(${k.col[0]},${k.col[1]},${k.col[2]},${d[3] * tw * age * fade})`;
          ctx.beginPath();
          ctx.arc(xx, yy, d[2], 0, 6.283);
          ctx.fill();
        }
      }
    };

    const frame = (ts: number): void => {
      const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
      last = ts;
      t += dt;
      if (!document.hidden) {
        if (cv.clientWidth && (cv.clientWidth !== W || cv.clientHeight !== H)) size();
        for (const k of cands) k.x -= SPEED * dt;
        if (cands.length && cands[0]!.x < -CW * 2) cands.shift();
        const lastC = cands[cands.length - 1];
        if (lastC && lastC.x < W + CW) newCandle(lastC.x + CW);
        draw();
      }
      raf = requestAnimationFrame(frame);
    };

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      t = 2;
      for (const k of cands) k.born = 0;
      draw();
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" />;
}
