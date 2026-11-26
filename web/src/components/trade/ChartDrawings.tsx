"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { coordinateOf, logicalAt, readScale } from "@/lib/chart-scale";
import {
  GRAB,
  barMap,
  hitTest,
  loadDrawings,
  moveHandle,
  newId,
  saveDrawings,
  translate,
  type Drawing,
  type Handle,
  type Point,
  type Projection,
  type Tool,
} from "@/lib/drawings";

/**
 * The drawing layer.
 *
 * Lightweight Charts has no drawing tools, and a trader will not use a chart
 * they cannot mark up: a trend line, a level, a measurement, and above all the
 * position tool — entry, target, stop, and the risk/reward that falls out of
 * them. So this is a canvas over the chart that converts between chart space
 * and pixels on every frame.
 *
 * Three decisions worth knowing:
 *
 *  - The canvas never takes pointer events. Everything is handled on the
 *    chart's wrapper in the **capture** phase, and the gesture is only taken
 *    away from the chart when this layer actually wants it. Anywhere it does
 *    not — empty space with the cursor tool — the chart pans and zooms exactly
 *    as before.
 *  - A drawing is kept against a time and a price, so it survives pan, zoom,
 *    resize, a live price poll and a change of timeframe. They are stored per
 *    market in this browser, which is where a chart annotation belongs: it is
 *    the viewer's note to themselves, not shared state.
 *  - The repaint is driven by a frame loop that compares a cheap signature of
 *    the view. The library has no event for "the price scale moved", so
 *    watching is more honest than subscribing to the half of it that is
 *    observable.
 */

const TOOLS: { tool: Tool; label: string; key?: string; icon: React.ReactNode }[] = [
  {
    tool: "cursor",
    label: "Cursor — pan, zoom, and pick up a drawing",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
        <path d="M3 2l9 5.5-4 .7L6.4 13 3 2z" fill="currentColor" />
      </svg>
    ),
  },
  {
    tool: "trend",
    label: "Trend line",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
        <path d="M2.5 12.5L13 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <circle cx="2.5" cy="12.5" r="1.6" fill="currentColor" />
        <circle cx="13" cy="3.5" r="1.6" fill="currentColor" />
      </svg>
    ),
  },
  {
    tool: "ray",
    label: "Ray — a trend line that carries on",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
        <path d="M2.5 12.5L14 3" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <circle cx="2.5" cy="12.5" r="1.6" fill="currentColor" />
      </svg>
    ),
  },
  {
    tool: "hline",
    label: "Horizontal line — a price level",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
        <path d="M1.5 8h13" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <circle cx="8" cy="8" r="1.6" fill="currentColor" />
      </svg>
    ),
  },
  {
    tool: "vline",
    label: "Vertical line — mark a moment",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
        <path d="M8 1.5v13" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <circle cx="8" cy="8" r="1.6" fill="currentColor" />
      </svg>
    ),
  },
  {
    tool: "rect",
    label: "Rectangle — mark a zone",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
        <rect x="2.5" y="4" width="11" height="8" stroke="currentColor" strokeWidth="1.4" fill="none" />
      </svg>
    ),
  },
  {
    tool: "fib",
    label: "Fibonacci retracement — levels between a high and a low",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
        <path d="M1.5 3h13M1.5 6.5h13M1.5 10h13M1.5 13.5h13" stroke="currentColor" strokeWidth="1.2" />
        <path d="M1.5 3L14.5 13.5" stroke="currentColor" strokeWidth="0.9" opacity="0.5" />
      </svg>
    ),
  },
  {
    tool: "measure",
    label: "Measure — price and time between two points",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
        <path d="M2 11.5L11.5 2 14 4.5 4.5 14z" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <path d="M5 9l1.5 1.5M7.5 6.5L9 8M10 4l1.5 1.5" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    ),
  },
  {
    tool: "long",
    label: "Long position — entry, target, stop",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
        <rect x="2.5" y="2.5" width="11" height="5" fill="#2EBD8533" stroke="#2EBD85" strokeWidth="1.1" />
        <rect x="2.5" y="8.5" width="11" height="5" fill="#E5484D22" stroke="#E5484D" strokeWidth="1.1" />
      </svg>
    ),
  },
  {
    tool: "short",
    label: "Short position — entry, target, stop",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
        <rect x="2.5" y="2.5" width="11" height="5" fill="#E5484D22" stroke="#E5484D" strokeWidth="1.1" />
        <rect x="2.5" y="8.5" width="11" height="5" fill="#2EBD8533" stroke="#2EBD85" strokeWidth="1.1" />
      </svg>
    ),
  },
];

/**
 * Where a fresh position tool puts its target and stop, as a share of the
 * price range on screen.
 *
 * Not a percentage of the entry: these markets move a few per cent a year and
 * a few hundredths of a per cent an hour, so a fixed 3% target on an intraday
 * chart is thirty panes above the top of the screen — the box is created
 * off-screen and only the entry line is visible. A share of the visible range
 * is in view at every zoom and on every timeframe, and the labels say what it
 * is worth in both price and per cent.
 */
const TARGET_SHARE = 0.25;
const STOP_SHARE = 0.12;
/**
 * How wide a fresh position box is, as a share of what is on screen.
 *
 * A count of bars is the wrong unit: two years of daily candles fitted to the
 * pane is about one pixel a bar, so a fixed twenty-four bars drew a box thirty
 * pixels wide with three labels hanging out of it. A share of the visible
 * range is the same gesture at every zoom.
 */
const DEFAULT_WIDTH_SHARE = 0.18;
const MIN_WIDTH_BARS = 6;

type Gesture =
  | { kind: "none" }
  | { kind: "new"; d: Drawing; from: { x: number; y: number }; moved: boolean }
  | { kind: "pending"; d: Drawing }
  | { kind: "move"; id: string; last: Point }
  | { kind: "handle"; id: string; handle: Handle };

const LINE = "#9FB0FF";
const SELECTED = "#3D5CF5";
const UP = "#2EBD85";
const DOWN = "#E5484D";
const MONO = "11px ui-monospace, SFMono-Regular, Menlo, monospace";

/** The retracements a trader expects, and the colour each is usually drawn in. */
const FIB_LEVELS: [number, string][] = [
  [0, "#C9CDD8"],
  [0.236, "#9FB0FF"],
  [0.382, "#2EBD85"],
  [0.5, "#F2A93B"],
  [0.618, "#2EBD85"],
  [0.786, "#9FB0FF"],
  [1, "#C9CDD8"],
];

export function ChartDrawings({
  chart,
  series,
  wrap,
  host,
  barTimes,
  code,
  dp,
}: {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  wrap: React.RefObject<HTMLDivElement | null>;
  host: React.RefObject<HTMLDivElement | null>;
  /** Bar open times in seconds, ascending. */
  barTimes: number[];
  /** Market code: drawings belong to a market, across every timeframe. */
  code: string;
  dp: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("cursor");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [shown, setShown] = useState(true);

  // The frame loop and the DOM listeners read the live values from refs, so
  // neither has to be rebuilt when any of them changes.
  const toolRef = useRef(tool);
  const drawingsRef = useRef(drawings);
  const selectedRef = useRef(selected);
  const shownRef = useRef(shown);
  const gestureRef = useRef<Gesture>({ kind: "none" });
  const barTimesRef = useRef(barTimes);
  const dpRef = useRef(dp);
  toolRef.current = tool;
  drawingsRef.current = drawings;
  selectedRef.current = selected;
  shownRef.current = shown;
  barTimesRef.current = barTimes;
  dpRef.current = dp;

  /** Nudges the frame loop to repaint even if the view has not moved. */
  const dirtyRef = useRef(true);
  const markDirty = (): void => {
    dirtyRef.current = true;
  };

  // Load this market's drawings, and switch sets when the market changes.
  useEffect(() => {
    const loaded = loadDrawings(code);
    setDrawings(loaded);
    drawingsRef.current = loaded;
    setSelected(null);
    gestureRef.current = { kind: "none" };
    markDirty();
  }, [code]);

  const commit = useCallback(
    (next: Drawing[]) => {
      drawingsRef.current = next;
      setDrawings(next);
      saveDrawings(code, next);
      markDirty();
    },
    [code],
  );

  /* ------------------------------------------------- chart space <-> px -- */

  const projection = useCallback((): Projection | null => {
    const hostEl = host.current;
    if (!hostEl) return null;
    const ts = chart.timeScale();
    const scale = readScale(ts);
    if (!scale) return null;
    const map = barMap(barTimesRef.current);
    const paneWidth = Math.max(0, hostEl.clientWidth - chart.priceScale("right").width());
    const paneHeight = Math.max(0, hostEl.clientHeight - ts.height());
    return {
      width: paneWidth,
      height: paneHeight,
      // Through the derived scale rather than `logicalToCoordinate`, which
      // answers 0 for a fractional index — and a drawing is anchored on a
      // moment, which is rarely exactly a bar.
      x: (time: number) => coordinateOf(scale, map.toLogical(time)),
      y: (price: number) => {
        const c = series.priceToCoordinate(price);
        return c === null ? null : (c as number);
      },
    };
  }, [chart, series, host]);

  /** Pointer position in pane pixels, and the chart-space point under it. */
  const locate = useCallback(
    (event: { clientX: number; clientY: number }): { x: number; y: number; at: Point } | null => {
      const hostEl = host.current;
      if (!hostEl) return null;
      const rect = hostEl.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const scale = readScale(chart.timeScale());
      const price = series.coordinateToPrice(y);
      if (!scale || price === null) return null;
      const map = barMap(barTimesRef.current);
      // `coordinateToLogical` rounds to the nearest bar, which would snap every
      // drawing to a bar centre. A drawing belongs where it was put.
      return { x, y, at: { time: map.toTime(logicalAt(scale, x)), price: price as number } };
    },
    [chart, series, host],
  );

  /* ----------------------------------------------------------- painting -- */

  useEffect(() => {
    let frame = 0;
    let signature = "";

    const paint = (): void => {
      const canvas = canvasRef.current;
      const hostEl = host.current;
      const wrapEl = wrap.current;
      if (!canvas || !hostEl || !wrapEl) return;
      const proj = projection();
      if (!proj) return;

      const dpr = window.devicePixelRatio || 1;
      const w = wrapEl.clientWidth;
      const h = wrapEl.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (!shownRef.current) return;

      // The pane is inset inside the wrapper by however the chart lays out its
      // axes; drawing in pane coordinates then means one translate here.
      const offsetX = hostEl.offsetLeft;
      const offsetY = hostEl.offsetTop;
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.beginPath();
      ctx.rect(0, 0, proj.width, proj.height);
      ctx.clip();

      const gesture = gestureRef.current;
      const draft =
        gesture.kind === "new" || gesture.kind === "pending" ? gesture.d : null;
      for (const d of drawingsRef.current) {
        paintDrawing(ctx, d, proj, d.id === selectedRef.current, dpRef.current);
      }
      if (draft) paintDrawing(ctx, draft, proj, true, dpRef.current);

      ctx.restore();
    };

    const loop = (): void => {
      const ts = chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      const probe = series.priceToCoordinate(1);
      const wrapEl = wrap.current;
      const next = [
        range ? `${range.from.toFixed(3)}:${range.to.toFixed(3)}` : "-",
        probe === null ? "-" : (probe as number).toFixed(2),
        wrapEl ? `${wrapEl.clientWidth}x${wrapEl.clientHeight}` : "-",
      ].join("|");
      if (next !== signature || dirtyRef.current) {
        signature = next;
        dirtyRef.current = false;
        paint();
      }
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [chart, series, host, wrap, projection]);

  // Repaint when the collection or the selection changes.
  useEffect(markDirty, [drawings, selected, shown, tool, barTimes]);

  /* ------------------------------------------------------------ gesture -- */

  useEffect(() => {
    const wrapEl = wrap.current;
    if (!wrapEl) return;

    /** Takes the gesture away from the chart. */
    const claim = (event: Event): void => {
      event.stopPropagation();
      event.preventDefault();
    };

    const startNew = (at: Point, x: number, y: number): Gesture | null => {
      const id = newId();
      const t = toolRef.current;
      if (t === "hline" || t === "vline") {
        commit([...drawingsRef.current, { id, kind: t, a: at }]);
        setSelected(id);
        setTool("cursor");
        return { kind: "none" };
      }
      if (t === "long" || t === "short") {
        const map = barMap(barTimesRef.current);
        const up = t === "long";
        const view = chart.timeScale().getVisibleLogicalRange();
        const bars = Math.max(
          MIN_WIDTH_BARS,
          Math.round((view ? view.to - view.from : 60) * DEFAULT_WIDTH_SHARE),
        );
        const proj = projection();
        const top = proj ? series.coordinateToPrice(0) : null;
        const bottom = proj ? series.coordinateToPrice(proj.height) : null;
        const span =
          top !== null && bottom !== null
            ? Math.abs((top as number) - (bottom as number))
            : at.price * 0.04;
        const d: Drawing = {
          id,
          kind: "position",
          dir: t,
          a: at,
          endTime: at.time + bars * map.step,
          target: at.price + span * TARGET_SHARE * (up ? 1 : -1),
          stop: at.price - span * STOP_SHARE * (up ? 1 : -1),
        };
        commit([...drawingsRef.current, d]);
        setSelected(id);
        setTool("cursor");
        return { kind: "none" };
      }
      if (t === "trend" || t === "ray" || t === "rect" || t === "fib" || t === "measure") {
        return { kind: "new", d: { id, kind: t, a: at, b: at }, from: { x, y }, moved: false };
      }
      return null;
    };

    const onDown = (event: MouseEvent | TouchEvent): void => {
      const touch = "touches" in event ? event.touches[0] : null;
      if ("touches" in event && event.touches.length > 1) return; // leave pinch to the chart
      const point = touch ?? (event as MouseEvent);
      const found = locate(point);
      if (!found) return;
      const { x, y, at } = found;
      const proj = projection();
      if (!proj || x > proj.width || y > proj.height) return; // an axis, not the pane

      const gesture = gestureRef.current;

      // Second click of a two-click line.
      if (gesture.kind === "pending") {
        const d = gesture.d;
        const finished = "b" in d ? { ...d, b: at } : d;
        gestureRef.current = { kind: "none" };
        commit([...drawingsRef.current, finished]);
        setSelected(finished.id);
        setTool("cursor");
        claim(event);
        return;
      }

      if (toolRef.current !== "cursor") {
        const started = startNew(at, x, y);
        if (started) {
          gestureRef.current = started;
          markDirty();
          claim(event);
        }
        return;
      }

      // Cursor: pick up a drawing if one is under the pointer, otherwise leave
      // the gesture to the chart so panning still works everywhere else.
      const hit = shownRef.current ? hitTest(drawingsRef.current, proj, x, y) : null;
      if (!hit) {
        if (selectedRef.current !== null) setSelected(null);
        return;
      }
      setSelected(hit.id);
      gestureRef.current =
        hit.handle === "body"
          ? { kind: "move", id: hit.id, last: at }
          : { kind: "handle", id: hit.id, handle: hit.handle };
      markDirty();
      claim(event);
    };

    const onMove = (event: MouseEvent | TouchEvent): void => {
      const gesture = gestureRef.current;
      const touch = "touches" in event ? event.touches[0] : null;
      const point = touch ?? (event as MouseEvent);
      const found = locate(point);

      if (gesture.kind === "none") {
        // Hover feedback, so it is discoverable that a drawing can be grabbed.
        if (!found || toolRef.current !== "cursor" || !shownRef.current) return;
        const proj = projection();
        if (!proj) return;
        const over = hitTest(drawingsRef.current, proj, found.x, found.y);
        wrapEl.style.cursor = over ? "move" : "";
        return;
      }
      if (!found) return;
      const { x, y, at } = found;

      if (gesture.kind === "pending") {
        if ("b" in gesture.d) gestureRef.current = { ...gesture, d: { ...gesture.d, b: at } };
        markDirty();
        return;
      }
      if (gesture.kind === "new") {
        const moved =
          gesture.moved || Math.hypot(x - gesture.from.x, y - gesture.from.y) > GRAB;
        gestureRef.current = {
          ...gesture,
          moved,
          d: "b" in gesture.d ? { ...gesture.d, b: at } : gesture.d,
        };
        markDirty();
        claim(event);
        return;
      }
      if (gesture.kind === "move") {
        const next = drawingsRef.current.map((d) =>
          d.id === gesture.id
            ? translate(d, at.time - gesture.last.time, at.price - gesture.last.price)
            : d,
        );
        drawingsRef.current = next;
        setDrawings(next);
        gestureRef.current = { ...gesture, last: at };
        markDirty();
        claim(event);
        return;
      }
      const next = drawingsRef.current.map((d) =>
        d.id === gesture.id ? moveHandle(d, gesture.handle, at) : d,
      );
      drawingsRef.current = next;
      setDrawings(next);
      markDirty();
      claim(event);
    };

    const onUp = (event: MouseEvent | TouchEvent): void => {
      const gesture = gestureRef.current;
      if (gesture.kind === "none") return;

      if (gesture.kind === "new") {
        if (gesture.moved) {
          // Take the second point from where the button came up, not from the
          // last move: they are the same for a real mouse, and this way a
          // release that outruns the move stream still lands where it looks.
          const end = "touches" in event ? null : locate(event as MouseEvent);
          const finished =
            end && "b" in gesture.d ? { ...gesture.d, b: end.at } : gesture.d;
          gestureRef.current = { kind: "none" };
          commit([...drawingsRef.current, finished]);
          setSelected(finished.id);
          setTool("cursor");
        } else {
          // A click rather than a drag: wait for the second click.
          gestureRef.current = { kind: "pending", d: gesture.d };
        }
      } else {
        gestureRef.current = { kind: "none" };
        saveDrawings(code, drawingsRef.current);
      }
      markDirty();
      claim(event);
    };

    const onDoubleClick = (event: MouseEvent): void => {
      // The chart fits its content on a double-click. Mid-drawing that would
      // throw the frame away under the viewer's hands.
      if (toolRef.current !== "cursor" || gestureRef.current.kind !== "none") claim(event);
    };

    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "Escape") {
        gestureRef.current = { kind: "none" };
        setTool("cursor");
        setSelected(null);
        markDirty();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedRef.current) {
        const id = selectedRef.current;
        commit(drawingsRef.current.filter((d) => d.id !== id));
        setSelected(null);
      }
    };

    const opts = { capture: true } as const;
    wrapEl.addEventListener("mousedown", onDown, opts);
    wrapEl.addEventListener("touchstart", onDown, opts);
    wrapEl.addEventListener("mousemove", onMove, opts);
    wrapEl.addEventListener("touchmove", onMove, opts);
    wrapEl.addEventListener("mouseup", onUp, opts);
    wrapEl.addEventListener("touchend", onUp, opts);
    wrapEl.addEventListener("dblclick", onDoubleClick, opts);
    window.addEventListener("keydown", onKey);
    return () => {
      wrapEl.removeEventListener("mousedown", onDown, opts);
      wrapEl.removeEventListener("touchstart", onDown, opts);
      wrapEl.removeEventListener("mousemove", onMove, opts);
      wrapEl.removeEventListener("touchmove", onMove, opts);
      wrapEl.removeEventListener("mouseup", onUp, opts);
      wrapEl.removeEventListener("touchend", onUp, opts);
      wrapEl.removeEventListener("dblclick", onDoubleClick, opts);
      window.removeEventListener("keydown", onKey);
      wrapEl.style.cursor = "";
    };
  }, [wrap, locate, projection, commit, code, chart, series]);

  /**
   * Delete the selected drawing, or ask before clearing the lot.
   *
   * `window.confirm` blocks the whole page, cannot be styled, and on some
   * mobile browsers offers "prevent this page from creating more dialogs",
   * which would disable the only guard on a destructive action. The ask is
   * now part of the toolbar: it appears in place, and anything else dismisses
   * it.
   */
  const clear = (): void => {
    if (selected) {
      commit(drawings.filter((d) => d.id !== selected));
      setSelected(null);
      return;
    }
    if (drawings.length === 0) return;
    setConfirmingClear(true);
  };

  return (
    <>
      <canvas ref={canvasRef} className="chart-draw" aria-hidden />
      {confirmingClear && (
        <div className="draw-confirm" role="alertdialog" aria-label="Clear all drawings">
          <b>
            Remove all {drawings.length} drawing{drawings.length === 1 ? "" : "s"} on USD/{code}?
          </b>
          <div>
            <button type="button" onClick={() => setConfirmingClear(false)}>
              Keep them
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                commit([]);
                setSelected(null);
                setConfirmingClear(false);
              }}
            >
              Remove all
            </button>
          </div>
        </div>
      )}
      <div className="chart-tools" role="toolbar" aria-label="Chart drawing tools">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            type="button"
            className={t.tool === tool ? "on" : undefined}
            title={t.label}
            aria-label={t.label}
            aria-pressed={t.tool === tool}
            onClick={() => {
              gestureRef.current = { kind: "none" };
              setTool(t.tool);
            }}
          >
            {t.icon}
          </button>
        ))}
        <i className="chart-tools-sep" />
        <button
          type="button"
          className={shown ? undefined : "on"}
          title={shown ? "Hide drawings" : "Show drawings"}
          aria-label={shown ? "Hide drawings" : "Show drawings"}
          onClick={() => setShown((v) => !v)}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
            <path
              d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
            <circle cx="8" cy="8" r="1.8" fill="currentColor" />
            {!shown && <path d="M2 14L14 2" stroke="currentColor" strokeWidth="1.3" />}
          </svg>
        </button>
        <button
          type="button"
          title={selected ? "Delete the selected drawing" : "Remove every drawing"}
          aria-label={selected ? "Delete the selected drawing" : "Remove every drawing"}
          disabled={drawings.length === 0}
          onClick={clear}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
            <path
              d="M3.5 5h9l-.8 8.5h-7.4L3.5 5zM6 5V3.2h4V5"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
          </svg>
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- painter -- */

const fmtPrice = (v: number, dp: number): string =>
  v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

const fmtPct = (v: number): string => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;

/** A time span in whole units a trader reads at a glance. */
function fmtSpan(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${(s / 3600).toFixed(s % 3600 === 0 ? 0 : 1)}h`;
  if (s < 2_592_000) return `${(s / 86_400).toFixed(s % 86_400 === 0 ? 0 : 1)}d`;
  return `${(s / 2_592_000).toFixed(1)}mo`;
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  align: "left" | "right" = "left",
): void {
  ctx.font = MONO;
  const padding = 5;
  const w = ctx.measureText(text).width + padding * 2;
  const h = 17;
  const left = align === "left" ? x : x - w;
  ctx.fillStyle = "rgba(11,11,12,0.86)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(left, y - h / 2, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, left + padding, y + 0.5);
}

function handleDot(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = "#0B0B0C";
  ctx.fill();
  ctx.strokeStyle = SELECTED;
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

function paintDrawing(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  proj: Projection,
  isSelected: boolean,
  dp: number,
): void {
  const stroke = isSelected ? SELECTED : LINE;
  ctx.lineWidth = isSelected ? 1.8 : 1.4;
  ctx.setLineDash([]);

  if (d.kind === "hline") {
    const y = proj.y(d.a.price);
    if (y === null) return;
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(proj.width, y);
    ctx.stroke();
    label(ctx, fmtPrice(d.a.price, dp), proj.width - 2, y, stroke, "right");
    if (isSelected) handleDot(ctx, proj.width / 2, y);
    return;
  }

  if (d.kind === "vline") {
    const x = proj.x(d.a.time);
    if (x === null) return;
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, proj.height);
    ctx.stroke();
    if (isSelected) handleDot(ctx, x, proj.height / 2);
    return;
  }

  if (d.kind === "position") {
    const x1 = proj.x(d.a.time);
    const x2 = proj.x(d.endTime);
    const yEntry = proj.y(d.a.price);
    const yTarget = proj.y(d.target);
    const yStop = proj.y(d.stop);
    if (x1 === null || x2 === null || yEntry === null || yTarget === null || yStop === null) return;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);

    ctx.fillStyle = "rgba(46,189,133,0.14)";
    ctx.fillRect(left, Math.min(yEntry, yTarget), right - left, Math.abs(yTarget - yEntry));
    ctx.fillStyle = "rgba(229,72,77,0.14)";
    ctx.fillRect(left, Math.min(yEntry, yStop), right - left, Math.abs(yStop - yEntry));

    const line = (y: number, color: string): void => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    };
    line(yTarget, UP);
    line(yStop, DOWN);
    ctx.setLineDash([4, 3]);
    line(yEntry, isSelected ? SELECTED : "#C9CDD8");
    ctx.setLineDash([]);

    const reward = ((d.target - d.a.price) / d.a.price) * 100 * (d.dir === "long" ? 1 : -1);
    const risk = ((d.a.price - d.stop) / d.a.price) * 100 * (d.dir === "long" ? 1 : -1);
    const rr = risk !== 0 ? Math.abs(reward / risk) : 0;

    const entryText = `${d.dir === "long" ? "Long" : "Short"} ${fmtPrice(d.a.price, dp)}`;
    const rrText = `R:R ${rr.toFixed(2)}`;
    const ink = isSelected ? SELECTED : "#C9CDD8";
    label(ctx, entryText, left + 3, yEntry, ink);
    label(ctx, `Target ${fmtPrice(d.target, dp)}  ${fmtPct(reward)}`, left + 3, yTarget, UP);
    label(ctx, `Stop ${fmtPrice(d.stop, dp)}  ${fmtPct(-Math.abs(risk))}`, left + 3, yStop, DOWN);
    // The risk/reward sits at the right edge of the box, unless the box is too
    // narrow to hold both labels — then it goes just outside, rather than
    // landing on top of the entry and clipping it.
    ctx.font = MONO;
    const room = ctx.measureText(entryText).width + ctx.measureText(rrText).width + 36;
    if (right - left > room) label(ctx, rrText, right - 3, yEntry, ink, "right");
    else label(ctx, rrText, right + 6, yEntry, ink);

    if (isSelected) {
      handleDot(ctx, left, yEntry);
      handleDot(ctx, (left + right) / 2, yTarget);
      handleDot(ctx, (left + right) / 2, yStop);
      handleDot(ctx, right, yEntry);
    }
    return;
  }

  const xa = proj.x(d.a.time);
  const xb = proj.x(d.b.time);
  const ya = proj.y(d.a.price);
  const yb = proj.y(d.b.price);
  if (xa === null || xb === null || ya === null || yb === null) return;

  if (d.kind === "fib") {
    // The retracement runs from the first point (0%) to the second (100%),
    // which is why it is drawn from the price at `a` towards the price at `b`
    // rather than from the top of the box down: dragging a high onto a low
    // and dragging a low onto a high mean different things.
    const left = Math.min(xa, xb);
    const right = Math.max(xa, xb);
    ctx.font = MONO;
    for (const [level, colour] of FIB_LEVELS) {
      const price = d.a.price + (d.b.price - d.a.price) * level;
      const y = proj.y(price);
      if (y === null) continue;
      ctx.strokeStyle = isSelected ? SELECTED : colour;
      ctx.lineWidth = level === 0 || level === 1 ? 1.4 : 1;
      ctx.setLineDash(level === 0 || level === 1 ? [] : [4, 3]);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = colour;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${(level * 100).toFixed(1)}%  ${fmtPrice(price, dp)}`, left + 4, y - 2);
    }
    if (isSelected) {
      handleDot(ctx, xa, ya);
      handleDot(ctx, xb, yb);
    }
    return;
  }

  if (d.kind === "rect") {
    ctx.fillStyle = "rgba(61,92,245,0.10)";
    ctx.fillRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya));
    ctx.strokeStyle = stroke;
    ctx.strokeRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya));
    if (isSelected) {
      handleDot(ctx, xa, ya);
      handleDot(ctx, xb, yb);
    }
    return;
  }

  // A ray keeps going past its second point, to the edge of the pane.
  let endX = xb;
  let endY = yb;
  if (d.kind === "ray" && xb !== xa) {
    endX = xb > xa ? proj.width : 0;
    endY = ya + ((yb - ya) * (endX - xa)) / (xb - xa);
  }

  ctx.strokeStyle = d.kind === "measure" ? SELECTED : stroke;
  if (d.kind === "measure") ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(xa, ya);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.setLineDash([]);

  if (d.kind === "measure") {
    const change = d.a.price !== 0 ? ((d.b.price - d.a.price) / d.a.price) * 100 : 0;
    const color = change >= 0 ? UP : DOWN;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(xa, ya);
    ctx.lineTo(xa, yb);
    ctx.lineTo(xb, yb);
    ctx.stroke();
    label(
      ctx,
      `${fmtPct(change)}  ${fmtPrice(d.b.price - d.a.price, dp)}  ${fmtSpan(d.b.time - d.a.time)}`,
      xb + 6,
      yb,
      color,
    );
  }

  if (isSelected) {
    handleDot(ctx, xa, ya);
    handleDot(ctx, xb, yb);
  }
}
