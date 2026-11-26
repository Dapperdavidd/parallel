"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { fmt } from "@/lib/mock";
import { CurrencyBadge, StatusPill } from "@/components/MarketsTable";
import { useFavourites } from "@/lib/favourites";
import { useLive, useMarkets, type MarketView } from "@/lib/live";

/**
 * The market board.
 *
 * Thirteen currencies, which is enough that the board needs to be worked
 * rather than read: a search, a filter, a sort, and a star for the two or
 * three somebody actually follows. It also answers the question the old board
 * would not — *why* a market is not trading — in words, beside the row,
 * rather than leaving a red "Paused" pill and a tooltip.
 */

type Filter = "all" | "live" | "beta" | "paused" | "starred";
type SortKey = "market" | "leverage" | "street" | "gap" | "status";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "starred", label: "Starred" },
  { key: "live", label: "Live" },
  { key: "beta", label: "Beta" },
  { key: "paused", label: "Paused" },
];

const gapOf = (m: MarketView): number => (m.off > 0 ? (m.px / m.off - 1) * 100 : 0);

/** Live first, then beta, then anything paused. */
const statusRank = (m: MarketView): number => (m.paused ? 2 : m.st === "Live" ? 0 : 1);

function Star({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={on ? "star on" : "star"}
      aria-label={on ? "Remove from starred" : "Add to starred"}
      aria-pressed={on}
      onClick={(event) => {
        // The row is a link; starring must not navigate.
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
        <path
          d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z"
          fill={on ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    </button>
  );
}

function SortHeader({
  label,
  column,
  sort,
  direction,
  onSort,
  align,
}: {
  label: string;
  column: SortKey;
  sort: SortKey;
  direction: 1 | -1;
  onSort: (key: SortKey) => void;
  align?: "right";
}) {
  const active = sort === column;
  return (
    <button
      type="button"
      className={active ? "msort on" : "msort"}
      onClick={() => onSort(column)}
      style={align === "right" ? { justifyContent: "flex-end" } : undefined}
      aria-sort={active ? (direction === 1 ? "ascending" : "descending") : "none"}
    >
      {label}
      <i aria-hidden>{active ? (direction === 1 ? "↑" : "↓") : ""}</i>
    </button>
  );
}

export default function MarketsPage() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("market");
  const [direction, setDirection] = useState<1 | -1>(1);
  // Live prices where the index has them; sample values where it does not.
  const markets = useMarkets();
  const { isLive, at, error } = useLive();
  const { isFavourite, toggle, favourites, ready } = useFavourites();

  const onSort = (key: SortKey): void => {
    if (key === sort) setDirection((d) => (d === 1 ? -1 : 1));
    else {
      setSort(key);
      setDirection(1);
    }
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = markets.filter((m) => {
      if (filter === "live" && (m.st !== "Live" || m.paused)) return false;
      if (filter === "beta" && (m.st !== "Beta" || m.paused)) return false;
      if (filter === "paused" && !m.paused) return false;
      if (filter === "starred" && !favourites.includes(m.c)) return false;
      if (!needle) return true;
      return (
        m.c.toLowerCase().includes(needle) ||
        m.name.toLowerCase().includes(needle) ||
        m.reg.toLowerCase().includes(needle)
      );
    });

    const compare = (a: MarketView, b: MarketView): number => {
      switch (sort) {
        case "leverage":
          return a.lev - b.lev;
        case "street":
          return a.px - b.px;
        case "gap":
          return gapOf(a) - gapOf(b);
        case "status":
          return statusRank(a) - statusRank(b);
        default:
          return a.c.localeCompare(b.c);
      }
    };
    out = [...out].sort((a, b) => compare(a, b) * direction);

    // A starred market sits at the top of whatever order is chosen: the point
    // of starring it is not to have to look for it.
    return [
      ...out.filter((m) => favourites.includes(m.c)),
      ...out.filter((m) => !favourites.includes(m.c)),
    ];
  }, [q, markets, filter, sort, direction, favourites]);

  const counts = {
    live: markets.filter((m) => m.st === "Live" && !m.paused).length,
    beta: markets.filter((m) => m.st === "Beta" && !m.paused).length,
    paused: markets.filter((m) => m.paused).length,
  };

  return (
    <div className="page">
      <div className="mhead">
        <div>
          <h1 style={{ fontSize: 32, letterSpacing: "-.03em" }}>Markets</h1>
          <p style={{ margin: "6px 0 0", color: "var(--ink2)", fontSize: 15 }}>
            {counts.live} live · {counts.beta} beta
            {counts.paused > 0 && ` · ${counts.paused} paused`} · all on devnet
            {isLive && at && (
              <span style={{ color: "var(--ink3)" }}>
                {" "}
                · index updated {new Date(at).toLocaleTimeString()}
              </span>
            )}
          </p>
          {error && (
            <p style={{ margin: "6px 0 0", color: "var(--amb)", fontSize: 13 }}>
              The last price read failed, so these are the figures from before it. Retrying.
            </p>
          )}
        </div>
        <input
          className="inp"
          style={{ maxWidth: 280 }}
          placeholder="Search currency or region"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search markets"
        />
      </div>

      <div className="mfilters" role="group" aria-label="Filter markets">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={filter === key ? "mchip on" : "mchip"}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
            {key === "starred" && ready && favourites.length > 0 && ` (${favourites.length})`}
            {key === "paused" && counts.paused > 0 && ` (${counts.paused})`}
          </button>
        ))}
      </div>

      <div className="mtable" style={{ border: "1px solid var(--ln)" }}>
        <div className="mrow head">
          <SortHeader label="MARKET" column="market" sort={sort} direction={direction} onSort={onSort} />
          <SortHeader label="MAX LEV." column="leverage" sort={sort} direction={direction} onSort={onSort} />
          <SortHeader label="STREET" column="street" sort={sort} direction={direction} onSort={onSort} />
          <span>SOURCES</span>
          <SortHeader label="VS OFFICIAL" column="gap" sort={sort} direction={direction} onSort={onSort} />
          <SortHeader
            label="STATUS"
            column="status"
            sort={sort}
            direction={direction}
            onSort={onSort}
            align="right"
          />
        </div>
        {rows.map((m) => {
          const gap = gapOf(m);
          return (
            <div key={m.c} className="mgroup">
              <Link className="mrow" href={`/app/trade?m=${m.c}`}>
                <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Star on={ready && isFavourite(m.c)} onClick={() => toggle(m.c)} />
                  <CurrencyBadge m={m} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <b style={{ fontWeight: 500 }}>USD/{m.c}</b>
                    <span style={{ fontSize: 13, color: "var(--ink3)" }}>
                      {m.name} · {m.reg}
                    </span>
                  </span>
                </span>
                <span className="mono">{m.lev}x</span>
                <span className="mono" style={m.priceIsSample ? { color: "var(--ink3)" } : undefined}>
                  {fmt(m.px, m.dp)}
                  {m.priceIsSample && <i className="hstat-tag">sample</i>}
                </span>
                {/* Source health: how many of the venues we asked answered
                    with a price we kept. Two is the floor for a median. */}
                <span
                  className="mono"
                  style={{ color: m.sourceCount >= 3 ? "var(--ink2)" : "var(--amb)" }}
                  title={m.src.length > 0 ? m.src.join(", ") : "No source answered"}
                >
                  {m.sourcesTried > 0 ? `${m.sourceCount}/${m.sourcesTried}` : "—"}
                </span>
                <span className="mono" style={{ color: gap >= 0 ? "var(--amb)" : "var(--ink2)" }}>
                  {gap >= 0 ? "+" : ""}
                  {gap.toFixed(1)}%
                </span>
                <span style={{ display: "flex", justifyContent: "flex-end" }}>
                  <StatusPill m={m} paused={m.paused} reason={m.pausedBecause} />
                </span>
              </Link>
              {/* Why, not just that. A red pill with no explanation is the
                  thing people complain about on every venue. */}
              {m.paused && m.pausedBecause && (
                <p className="mwhy">
                  <span aria-hidden>↳</span> {m.pausedBecause}
                </p>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <p style={{ padding: "24px 28px", color: "var(--ink3)", margin: 0 }}>
            {filter === "starred" && favourites.length === 0
              ? "Nothing starred yet. Tap a star to keep a market at the top of this board."
              : `No market matches ${q ? `“${q}”` : "that filter"}.`}
          </p>
        )}
      </div>

      <p style={{ marginTop: 16, fontSize: 13, color: "var(--ink3)" }}>
        Live markets use 3 or more price sources and allow up to 5x. Beta markets use 2 sources
        and allow up to 2x. Leverage is fixed when a market is created and cannot be changed
        afterwards. A market with fewer than two live sources stops taking new positions —
        existing ones can still be closed.
      </p>
    </div>
  );
}
