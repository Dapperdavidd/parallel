/**
 * Chart drawings — the model, the geometry and the storage.
 *
 * Lightweight Charts 4 has no drawing tools, so this is ours. The rules that
 * matter are here rather than in the component:
 *
 *  - A drawing is stored in **chart space** (a unix time and a price), never in
 *    pixels. Pan, zoom, resize or switch timeframe and it stays on the price
 *    it was put on, which is the whole point of drawing on a chart.
 *  - Because the anchor is a time, a line drawn on the 1H chart is the same
 *    line on the 1D chart. Drawings are therefore kept per market, not per
 *    timeframe.
 *  - Hit-testing takes a projection rather than computing one, so the same
 *    code answers "what is under the cursor" and "where do I paint this" from
 *    one source of coordinates.
 */

export type Tool =
  | "cursor"
  | "trend"
  | "ray"
  | "hline"
  | "vline"
  | "rect"
  | "fib"
  | "measure"
  | "long"
  | "short";

/** A point in chart space: a moment, and a price in the familiar quote. */
export interface Point {
  time: number;
  price: number;
}

/**
 * Each kind is its own member, including `hline` and `vline` separately. A
 * member whose `kind` is itself a union cannot be narrowed away by a `===`
 * check, so combining those two would cost the compiler's help everywhere a
 * drawing is handled.
 */
export interface TwoPointDrawing {
  id: string;
  kind: "trend" | "ray" | "rect" | "fib" | "measure";
  a: Point;
  b: Point;
}

export interface LevelDrawing {
  id: string;
  kind: "hline";
  a: Point;
}

export interface MomentDrawing {
  id: string;
  kind: "vline";
  a: Point;
}

export interface PositionDrawing {
  id: string;
  kind: "position";
  dir: "long" | "short";
  /** Entry. */
  a: Point;
  /** Right edge of the box, so the risk/reward has a horizon. */
  endTime: number;
  target: number;
  stop: number;
}

export type Drawing = TwoPointDrawing | LevelDrawing | MomentDrawing | PositionDrawing;

/** The kinds anchored on two points, which share all their handling. */
export const isTwoPoint = (d: Drawing): d is TwoPointDrawing => "b" in d;

/** Which part of a drawing a pointer is over. */
export type Handle = "a" | "b" | "body" | "target" | "stop" | "end";

export interface Hit {
  id: string;
  handle: Handle;
}

/** Chart space to pixels. `null` when the value is off the current scale. */
export interface Projection {
  x: (time: number) => number | null;
  y: (price: number) => number | null;
  /** Pane size in pixels, excluding the axes. */
  width: number;
  height: number;
}

export const newId = (): string => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ----------------------------------------------------------- geometry -- */

const sq = (v: number): number => v * v;

/** Distance from a point to a line segment, in pixels. */
export function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const len = sq(x2 - x1) + sq(y2 - y1);
  if (len === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / len));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

/**
 * How close a pointer has to be, in pixels, to grab something.
 *
 * Nine rather than a tighter few: a line is one pixel wide and a mouse is not
 * that accurate, and the labels sit over the lines they belong to, so a grab
 * aimed at a label's edge should still find its line.
 */
export const GRAB = 9;

/**
 * What the pointer is over, nearest first. A handle always wins over a body,
 * so a line can be re-anchored without being dragged bodily.
 */
export function hitTest(
  drawings: readonly Drawing[],
  proj: Projection,
  px: number,
  py: number,
): Hit | null {
  let best: { hit: Hit; d: number; rank: number } | null = null;
  const consider = (hit: Hit, d: number, rank: number): void => {
    if (d > GRAB) return;
    if (best === null || rank < best.rank || (rank === best.rank && d < best.d)) {
      best = { hit, d, rank };
    }
  };

  // Later drawings sit on top, so walk backwards.
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i]!;
    if (d.kind === "hline") {
      const y = proj.y(d.a.price);
      if (y === null) continue;
      consider({ id: d.id, handle: "a" }, Math.abs(py - y), 1);
      continue;
    }
    if (d.kind === "vline") {
      const x = proj.x(d.a.time);
      if (x === null) continue;
      consider({ id: d.id, handle: "a" }, Math.abs(px - x), 1);
      continue;
    }
    if (d.kind === "position") {
      const x1 = proj.x(d.a.time);
      const x2 = proj.x(d.endTime);
      const yEntry = proj.y(d.a.price);
      const yTarget = proj.y(d.target);
      const yStop = proj.y(d.stop);
      if (x1 === null || x2 === null || yEntry === null || yTarget === null || yStop === null) continue;
      const within = px >= Math.min(x1, x2) - GRAB && px <= Math.max(x1, x2) + GRAB;
      if (!within) continue;
      consider({ id: d.id, handle: "target" }, Math.abs(py - yTarget), 0);
      consider({ id: d.id, handle: "stop" }, Math.abs(py - yStop), 0);
      consider({ id: d.id, handle: "a" }, Math.abs(py - yEntry), 1);
      consider({ id: d.id, handle: "end" }, Math.abs(px - x2), 1);
      const top = Math.min(yTarget, yStop);
      const bottom = Math.max(yTarget, yStop);
      if (py > top && py < bottom) consider({ id: d.id, handle: "body" }, 0, 3);
      continue;
    }

    const xa = proj.x(d.a.time);
    const xb = proj.x(d.b.time);
    const ya = proj.y(d.a.price);
    const yb = proj.y(d.b.price);
    if (xa === null || xb === null || ya === null || yb === null) continue;
    consider({ id: d.id, handle: "a" }, Math.hypot(px - xa, py - ya), 0);
    consider({ id: d.id, handle: "b" }, Math.hypot(px - xb, py - yb), 0);

    if (d.kind === "rect" || d.kind === "fib") {
      const left = Math.min(xa, xb), right = Math.max(xa, xb);
      const top = Math.min(ya, yb), bottom = Math.max(ya, yb);
      const edge = Math.min(
        distToSegment(px, py, left, top, right, top),
        distToSegment(px, py, left, bottom, right, bottom),
        distToSegment(px, py, left, top, left, bottom),
        distToSegment(px, py, right, top, right, bottom),
      );
      consider({ id: d.id, handle: "body" }, edge, 2);
      if (px > left && px < right && py > top && py < bottom) {
        consider({ id: d.id, handle: "body" }, 0, 3);
      }
    } else {
      // A ray carries on past its second point to the right edge.
      const endX = d.kind === "ray" && xb !== xa ? (xb > xa ? proj.width : 0) : xb;
      const endY =
        d.kind === "ray" && xb !== xa
          ? ya + ((yb - ya) * (endX - xa)) / (xb - xa)
          : yb;
      consider({ id: d.id, handle: "body" }, distToSegment(px, py, xa, ya, endX, endY), 2);
    }
  }

  return best === null ? null : (best as { hit: Hit }).hit;
}

/** Move a whole drawing by a delta in chart space. */
export function translate(d: Drawing, dTime: number, dPrice: number): Drawing {
  const p = (pt: Point): Point => ({ time: pt.time + dTime, price: pt.price + dPrice });
  if (d.kind === "hline") return { ...d, a: { ...d.a, price: d.a.price + dPrice } };
  if (d.kind === "vline") return { ...d, a: { ...d.a, time: d.a.time + dTime } };
  if (d.kind === "position") {
    return {
      ...d,
      a: p(d.a),
      endTime: d.endTime + dTime,
      target: d.target + dPrice,
      stop: d.stop + dPrice,
    };
  }
  return { ...d, a: p(d.a), b: p(d.b) };
}

/** Move one handle of a drawing to a new place in chart space. */
export function moveHandle(d: Drawing, handle: Handle, at: Point): Drawing {
  if (d.kind === "hline") return { ...d, a: { time: d.a.time, price: at.price } };
  if (d.kind === "vline") return { ...d, a: { time: at.time, price: d.a.price } };
  if (d.kind === "position") {
    if (handle === "target") return { ...d, target: at.price };
    if (handle === "stop") return { ...d, stop: at.price };
    if (handle === "end") return { ...d, endTime: Math.max(at.time, d.a.time) };
    // Dragging the entry carries the target and the stop with it, so the
    // risk and the reward you set up are preserved.
    const shift = at.price - d.a.price;
    return {
      ...d,
      a: at,
      endTime: d.endTime + (at.time - d.a.time),
      target: d.target + shift,
      stop: d.stop + shift,
    };
  }
  return handle === "a" ? { ...d, a: at } : { ...d, b: at };
}

/* ------------------------------------------------------------ storage -- */

const KEY = (code: string): string => `parallel.drawings.v1.${code}`;

const isPoint = (v: unknown): v is Point =>
  typeof v === "object" &&
  v !== null &&
  Number.isFinite((v as Point).time) &&
  Number.isFinite((v as Point).price);

/** Anything that is not a drawing we wrote is dropped rather than trusted. */
function parse(raw: unknown): Drawing[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((d: unknown): d is Drawing => {
    if (typeof d !== "object" || d === null) return false;
    const c = d as Partial<Drawing> & { kind?: string };
    if (typeof c.id !== "string" || typeof c.kind !== "string") return false;
    if (!isPoint(c.a)) return false;
    if (c.kind === "hline" || c.kind === "vline") return true;
    if (c.kind === "position") {
      const p = d as Extract<Drawing, { kind: "position" }>;
      return (
        (p.dir === "long" || p.dir === "short") &&
        Number.isFinite(p.endTime) &&
        Number.isFinite(p.target) &&
        Number.isFinite(p.stop)
      );
    }
    return (
      (c.kind === "trend" ||
        c.kind === "ray" ||
        c.kind === "rect" ||
        c.kind === "fib" ||
        c.kind === "measure") &&
      isPoint((d as TwoPointDrawing).b)
    );
  });
}

export function loadDrawings(code: string): Drawing[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY(code));
    return raw ? parse(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveDrawings(code: string, drawings: readonly Drawing[]): void {
  if (typeof window === "undefined") return;
  try {
    if (drawings.length === 0) window.localStorage.removeItem(KEY(code));
    else window.localStorage.setItem(KEY(code), JSON.stringify(drawings));
  } catch {
    /* private mode, or the quota is full — drawings are not worth an error */
  }
}

/* ------------------------------------------------------- bar time map -- */

/**
 * Time to a fractional bar index and back.
 *
 * The library can only convert a time it has a bar for, and a drawing may well
 * be anchored between bars or beyond the last one. The bar times give the
 * spacing; everything outside the series is extrapolated from it.
 */
export interface BarMap {
  toLogical: (time: number) => number;
  toTime: (logical: number) => number;
  /** Seconds a bar covers, which is also the smallest meaningful step. */
  step: number;
}

export function barMap(times: readonly number[]): BarMap {
  const n = times.length;
  const step = n >= 2 ? Math.max(1, Math.round((times[n - 1]! - times[0]!) / (n - 1))) : 3600;
  return {
    step,
    toLogical: (time: number): number => {
      if (n === 0) return 0;
      if (time <= times[0]!) return (time - times[0]!) / step;
      if (time >= times[n - 1]!) return n - 1 + (time - times[n - 1]!) / step;
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid]! <= time) lo = mid;
        else hi = mid;
      }
      const span = times[hi]! - times[lo]!;
      return span > 0 ? lo + (time - times[lo]!) / span : lo;
    },
    toTime: (logical: number): number => {
      if (n === 0) return 0;
      if (logical <= 0) return Math.round(times[0]! + logical * step);
      if (logical >= n - 1) return Math.round(times[n - 1]! + (logical - (n - 1)) * step);
      const lo = Math.floor(logical);
      const frac = logical - lo;
      return Math.round(times[lo]! + frac * (times[lo + 1]! - times[lo]!));
    },
  };
}
