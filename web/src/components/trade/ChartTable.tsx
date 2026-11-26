"use client";

import { useMemo, useState } from "react";
import { fmt } from "@/lib/mock";

/**
 * The chart, as a table.
 *
 * A canvas is a picture. To a screen reader it is nothing at all, and the
 * `aria-label` on it — "USD/NGN price chart" — says what the element is
 * without conveying a single price. For a product whose entire claim is "here
 * is a number nobody else publishes", that is the wrong thing to be unable to
 * read.
 *
 * So the same data the chart draws is available as a table, to anybody who
 * wants it. It is not a screen-reader-only fallback: a sighted trader reading
 * exact closes off a dense chart is doing the same job the hard way, and the
 * table is also where the figures can be copied from.
 *
 * Newest first, because the question is nearly always "what has it been
 * doing lately".
 */

export interface ChartRow {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const PAGE = 20;

export function ChartTable({
  rows,
  code,
  dp,
  timeframe,
  source,
}: {
  rows: ChartRow[];
  code: string;
  dp: number;
  timeframe: string;
  /** What the chart is actually drawing, in the caption's own words. */
  source: string;
}) {
  const [shown, setShown] = useState(PAGE);

  const ordered = useMemo(() => [...rows].sort((a, b) => b.time - a.time), [rows]);
  const page = ordered.slice(0, shown);

  if (rows.length === 0) {
    return (
      <p className="chart-table-empty">
        There is no price history to list for this timeframe yet.
      </p>
    );
  }

  return (
    <div className="chart-table">
      <table className="postable">
        <caption className="sr-only">
          {`USD/${code} ${timeframe} candles, newest first. ${source}. ${rows.length} periods.`}
        </caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Open</th>
            <th scope="col">High</th>
            <th scope="col">Low</th>
            <th scope="col">Close</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {page.map((row) => {
            const move = row.open > 0 ? ((row.close - row.open) / row.open) * 100 : 0;
            return (
              <tr key={row.time}>
                <th scope="row" style={{ fontWeight: 400 }}>
                  {new Date(row.time * 1000).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </th>
                <td className="mono">{fmt(row.open, dp)}</td>
                <td className="mono">{fmt(row.high, dp)}</td>
                <td className="mono">{fmt(row.low, dp)}</td>
                <td className="mono">{fmt(row.close, dp)}</td>
                <td className="mono" style={{ color: move >= 0 ? "var(--up)" : "var(--dn)" }}>
                  {move >= 0 ? "+" : "−"}
                  {Math.abs(move).toFixed(2)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown < ordered.length && (
        <button
          type="button"
          className="closebtn"
          style={{ margin: "10px auto", display: "block" }}
          onClick={() => setShown((n) => n + PAGE)}
        >
          Show {Math.min(PAGE, ordered.length - shown)} more
        </button>
      )}
    </div>
  );
}
