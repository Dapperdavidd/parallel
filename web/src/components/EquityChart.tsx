"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { EquityPoint } from "@/lib/mock";

/**
 * The account equity curve on the portfolio page.
 *
 * Deliberately plainer than the market chart: no grid, no price line, one
 * filled area. The figures beneath it are read off the same series, so the
 * chart and the numbers can never disagree.
 */
export function EquityChart({ data, up }: { data: EquityPoint[]; up: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#868CA2",
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontSize: 11,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: "#141A2B" } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.16, bottom: 0.06 } },
      timeScale: { borderVisible: false, timeVisible: false },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "#3D5CF5", width: 1, labelVisible: false },
        horzLine: { color: "#3D5CF5", labelBackgroundColor: "#3D5CF5" },
      },
      handleScroll: false,
      handleScale: false,
      autoSize: true,
    });

    areaRef.current = chart.addAreaSeries({
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerRadius: 4,
    });

    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      areaRef.current = null;
    };
  }, []);

  useEffect(() => {
    const area = areaRef.current;
    const chart = chartRef.current;
    if (!area || !chart) return;

    const line = up ? "#2EBD85" : "#E5484D";
    area.applyOptions({
      lineColor: line,
      topColor: up ? "rgba(46,189,133,.28)" : "rgba(229,72,77,.28)",
      bottomColor: up ? "rgba(46,189,133,0)" : "rgba(229,72,77,0)",
      crosshairMarkerBorderColor: line,
      crosshairMarkerBackgroundColor: line,
    });
    area.setData(
      data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
    );
    chart.timeScale().fitContent();
  }, [data, up]);

  return <div ref={hostRef} className="eq-host" role="img" aria-label="Account equity over time" />;
}
