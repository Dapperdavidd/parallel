"use client";

import { useEffect, useMemo, useState } from "react";
import { fmt } from "@/lib/mock";
import type { MarketView } from "@/lib/live";
import { explorerTx, shortSignature } from "@/lib/explorer";
import { getJson } from "@/lib/fetcher";
import { WALLET_TRADES } from "@/lib/useChainPortfolio";

/**
 * The wallet's own trade history.
 *
 * It used to be forty rows in arrival order, with a truncated signature that
 * was not a link. For somebody checking what they paid on a trade last week
 * that is close to useless, and the data to answer them is already stored.
 *
 * So: filter by market and by what happened, sort by any column, page through
 * it, and take it away as CSV. The export is the part that matters most —
 * this is a record of somebody's own money, and an app that will not give it
 * back in a form a spreadsheet can read is holding it hostage.
 */

export interface StoredTrade {
  marketId: string;
  side: "long" | "short";
  action: "open" | "close" | "liquidation";
  sizeUsdc: number;
  leverage: number;
  price: number;
  txSignature: string;
  ts: string;
}

type SortKey = "ts" | "marketId" | "sizeUsdc" | "price";
type ActionFilter = "all" | "open" | "close" | "liquidation";

const PAGE = 12;

/** One CSV field, quoted when it has to be. */
const field = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function toCsv(rows: StoredTrade[]): string {
  const header = [
    "time_utc",
    "market",
    "side",
    "action",
    "size_usdc",
    "leverage",
    "unit_price_usd",
    "transaction",
  ];
  const lines = rows.map((row) =>
    [
      row.ts,
      row.marketId,
      row.side,
      row.action,
      row.sizeUsdc.toFixed(6),
      row.leverage,
      row.price.toFixed(8),
      row.txSignature,
    ]
      .map(field)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function download(name: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function TradeHistory({
  market,
  wallet,
  signedIn,
}: {
  market: MarketView;
  wallet: string | undefined;
  signedIn: boolean;
}) {
  const [trades, setTrades] = useState<StoredTrade[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyThisMarket, setOnlyThisMarket] = useState(false);
  const [action, setAction] = useState<ActionFilter>("all");
  const [sort, setSort] = useState<SortKey>("ts");
  const [direction, setDirection] = useState<1 | -1>(-1);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!signedIn || !wallet) {
      setTrades(null);
      return;
    }
    const controller = new AbortController();
    void getJson<{ trades?: StoredTrade[]; nextCursor?: string | null }>(
      WALLET_TRADES(encodeURIComponent(wallet)),
      { freshMs: 2_000, signal: controller.signal },
    )
      .then((body) => {
        setTrades(body.trades ?? []);
        setCursor(body.nextCursor ?? null);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "History is unavailable");
        setTrades([]);
      });
    return () => controller.abort();
  }, [signedIn, wallet]);

  /**
   * Fetch the next page.
   *
   * Cursor paging, not offset: rows arrive at the top of this ordering while
   * somebody is reading, and an offset page would skip or repeat around them.
   * Pages are appended, so the CSV export covers everything loaded.
   */
  const loadOlder = (): void => {
    if (!wallet || !cursor || loadingMore) return;
    setLoadingMore(true);
    void fetch(
      `/api/trades?wallet=${encodeURIComponent(wallet)}&limit=60&before=${encodeURIComponent(cursor)}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const body = (await response.json()) as {
          trades?: StoredTrade[];
          nextCursor?: string | null;
        };
        setTrades((current) => [...(current ?? []), ...(body.trades ?? [])]);
        setCursor(body.nextCursor ?? null);
      })
      .catch(() => setCursor(null))
      .finally(() => setLoadingMore(false));
  };

  const rows = useMemo(() => {
    if (!trades) return [];
    const filtered = trades.filter((trade) => {
      if (onlyThisMarket && trade.marketId !== `USD/${market.c}`) return false;
      if (action !== "all" && trade.action !== action) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      const compare =
        sort === "ts"
          ? Date.parse(a.ts) - Date.parse(b.ts)
          : sort === "marketId"
            ? a.marketId.localeCompare(b.marketId)
            : sort === "sizeUsdc"
              ? a.sizeUsdc - b.sizeUsdc
              : a.price - b.price;
      return compare * direction;
    });
  }, [trades, onlyThisMarket, action, market.c, sort, direction]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE, current * PAGE + PAGE);

  const onSort = (key: SortKey): void => {
    if (key === sort) setDirection((d) => (d === 1 ? -1 : 1));
    else {
      setSort(key);
      setDirection(key === "ts" ? -1 : 1);
    }
    setPage(0);
  };

  const Header = ({ label, column }: { label: string; column: SortKey }) => (
    <th>
      <button
        type="button"
        className={sort === column ? "msort on" : "msort"}
        onClick={() => onSort(column)}
        aria-sort={sort === column ? (direction === 1 ? "ascending" : "descending") : "none"}
      >
        {label}
        <i aria-hidden>{sort === column ? (direction === 1 ? "↑" : "↓") : ""}</i>
      </button>
    </th>
  );

  if (!signedIn) return <p className="bpanel-empty">Sign in to see your trade history.</p>;
  if (error) return <p className="bpanel-empty" style={{ color: "var(--dn)" }}>{error}</p>;
  if (!trades) return <p className="bpanel-empty">Reading your history…</p>;

  return (
    <div className="history">
      <div className="history-controls">
        <label className="history-check">
          <input
            type="checkbox"
            checked={onlyThisMarket}
            onChange={(event) => {
              setOnlyThisMarket(event.target.checked);
              setPage(0);
            }}
          />
          USD/{market.c} only
        </label>
        <div className="lev-presets">
          {(["all", "open", "close", "liquidation"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={action === key ? "on" : undefined}
              onClick={() => {
                setAction(key);
                setPage(0);
              }}
            >
              {key === "all" ? "All" : key[0]!.toUpperCase() + key.slice(1)}
            </button>
          ))}
        </div>
        <span className="history-count">
          {rows.length} {rows.length === 1 ? "trade" : "trades"}
        </span>
        <button
          type="button"
          className="closebtn"
          disabled={rows.length === 0}
          onClick={() =>
            download(
              `parallel-trades-${new Date().toISOString().slice(0, 10)}.csv`,
              toCsv(rows),
            )
          }
        >
          Export CSV
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="bpanel-empty">
          {trades.length === 0 ? "No trades yet." : "No trade matches those filters."}
        </p>
      ) : (
        <>
          <table className="postable">
            <thead>
              <tr>
                <Header label="Time" column="ts" />
                <Header label="Market" column="marketId" />
                <th>Side</th>
                <th>Action</th>
                <Header label="Size" column="sizeUsdc" />
                <Header label="Price" column="price" />
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((trade) => {
                // Stored prices are USD per contract; the familiar quote is
                // only meaningful with that market's own contract size, which
                // we have for the market on screen.
                const sameMarket = trade.marketId === `USD/${market.c}`;
                const quote = sameMarket && trade.price > 0 ? market.unitSize / trade.price : null;
                return (
                  <tr key={trade.txSignature}>
                    <td title={new Date(trade.ts).toISOString()}>
                      {new Date(trade.ts).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td>{trade.marketId}</td>
                    <td style={{ color: trade.side === "long" ? "var(--up)" : "var(--dn)" }}>
                      {trade.side === "long" ? "Long" : "Short"} {trade.leverage}x
                    </td>
                    <td style={{ textTransform: "capitalize" }}>{trade.action}</td>
                    <td className="mono">{fmt(trade.sizeUsdc)}</td>
                    <td className="mono">
                      {quote === null ? fmt(trade.price, 6) : fmt(quote, market.dp)}
                    </td>
                    <td className="mono">
                      <a href={explorerTx(trade.txSignature)} target="_blank" rel="noreferrer">
                        {shortSignature(trade.txSignature)} ↗
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {(pages > 1 || cursor) && (
            <div className="history-pager">
              <button
                type="button"
                className="closebtn"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                ← Newer
              </button>
              <span>
                Page {current + 1} of {pages}
                {cursor && " +"}
              </span>
              <button
                type="button"
                className="closebtn"
                disabled={loadingMore}
                onClick={() => {
                  // Past the last loaded page, fetch rather than stop.
                  if (current >= pages - 1) loadOlder();
                  else setPage(current + 1);
                }}
              >
                {loadingMore
                  ? "Loading…"
                  : current >= pages - 1 && cursor
                    ? "Load older"
                    : "Older →"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
