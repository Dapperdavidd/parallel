"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { findMarket, MARKETS, type Market } from "./mock";

/**
 * Live prices, laid over the sample data.
 *
 * The screens were built against one mock file so that Phase 3 could swap in
 * real data without redesigning them. This is that swap, and it is deliberately
 * an *overlay* rather than a replacement:
 *
 *   - presentation metadata — symbol, long name, region, decimal places — has
 *     no live source and stays where it was;
 *   - the numbers that do have a live source (street median, official rate,
 *     premium, status) are replaced when the index has them;
 *   - if the API is unreachable, or a market is paused and has no median, the
 *     sample value stays and the UI keeps working.
 *
 * So a dead backend degrades to the Phase 2 screens rather than to blanks,
 * and `isLive` says which it is, so nothing claims to be real when it is not.
 */

export interface LiveMarket {
  code: string;
  id: string;
  median: number | null;
  official: number | null;
  premiumPct: number | null;
  unitPriceUsd: number | null;
  markUnitPriceUsd: number | null;
  mark: number | null;
  basisBps: number | null;
  openInterestLongUsdc: number | null;
  openInterestShortUsdc: number | null;
  unitLabel: string;
  maxLeverage: number;
  status: string;
  acceptingPositions: boolean;
  reason: string | null;
  sources: string[];
  /** How many sources were in the median, and how many were tried. */
  sourceCount: number;
  sourcesTried: number;
  ts: string | null;
  /** Seconds since the index last produced a figure for this market. */
  ageSeconds: number | null;
  /** Plain words for why this market will not take a position. */
  pausedBecause: string | null;
  change24hPct: number | null;
  lastPushTx: string | null;
  marketAccount: string;
  collateralVault: string;
  maxNotionalUsdc: number | null;
  maxOpenInterestUsdc: number | null;
}

interface LiveState {
  /** Keyed by currency code: NGN, ZAR … */
  byCode: Map<string, LiveMarket>;
  /** True once a response with at least one priced market has arrived. */
  isLive: boolean;
  /** When the last successful fetch landed. */
  at: string | null;
  /** How many consecutive reads have failed. Zero when all is well. */
  failures: number;
  error: string | null;
  refresh: () => void;
}

const Ctx = createContext<LiveState | null>(null);

/** How often the board re-reads the index. The service writes every 2 minutes. */
const POLL_MS = 30_000;
/** After a failure, back off rather than hammering a service that is down. */
const BACKOFF_MS = [5_000, 15_000, 60_000, 120_000];

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [byCode, setByCode] = useState<Map<string, LiveMarket>>(new Map());
  const [isLive, setIsLive] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async (): Promise<void> => {
    // One read at a time, and a new one supersedes a read still in flight —
    // without this, a slow response could land after a newer one and put an
    // older price back on screen.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const res = await fetch("/api/markets", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { markets: LiveMarket[]; at: string };
      const map = new Map(body.markets.map((m) => [m.code, m]));
      setByCode(map);
      setAt(body.at);
      setError(null);
      setFailures(0);
      setIsLive(body.markets.some((m) => m.median !== null));
    } catch (err) {
      if (controller.signal.aborted) return;
      // Keep the last good data on screen; say so rather than blanking.
      setError(err instanceof Error ? err.message : String(err));
      setFailures((count) => count + 1);
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    void load();
    return () => inFlight.current?.abort();
  }, [load]);

  /**
   * The polling clock.
   *
   * Two things it must not do. It must not poll a hidden tab — thirteen
   * markets every thirty seconds, for a page nobody is looking at, on
   * somebody's phone data. And after a failure it must slow down rather than
   * hammer a service that is already struggling.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      if (typeof document !== "undefined" && document.hidden) return;
      const wait = failures > 0 ? (BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)] ?? POLL_MS) : POLL_MS;
      timer = setTimeout(() => {
        void load();
        schedule();
      }, wait);
    };

    // A tab that comes back after an hour should not show an hour-old price.
    const onVisible = (): void => {
      if (document.hidden) {
        if (timer) clearTimeout(timer);
        return;
      }
      void load();
      schedule();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, failures]);

  const value = useMemo<LiveState>(
    () => ({ byCode, isLive, at, failures, error, refresh: () => void load() }),
    [byCode, isLive, at, failures, error, load],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLive(): LiveState {
  return (
    useContext(Ctx) ?? {
      byCode: new Map(),
      isLive: false,
      at: null,
      failures: 0,
      error: null,
      refresh: () => {},
    }
  );
}

/**
 * What a screen knows about one market.
 *
 * `live` is the important flag, and the reason this returns more than a
 * `Market`. The overlay keeps the sample price when the index has none, which
 * keeps the screens working against a dead backend — but a sample price from
 * the day the mock file was written is not a price, and a screen that cannot
 * tell the difference will show it as one.
 */
export interface MarketView extends Market {
  /** The price came from the index this session. */
  live: boolean;
  /** The price on screen is the sample from the mock file, not a measurement. */
  priceIsSample: boolean;
  /** This market will not take a new position. */
  paused: boolean;
  /** Why, in the index service's own vocabulary. */
  reason: string | null;
  /** Why, in words for a person. */
  pausedBecause: string | null;
  /** Seconds since the index last measured this market. */
  ageSeconds: number | null;
  sourceCount: number;
  sourcesTried: number;
  /** Measured change over the last day, or null when there is not a day yet. */
  change24hPct: number | null;
  /** The engine's own price, in the quote scale. Null when unreadable. */
  mark: number | null;
  /** Mark against index, in basis points. */
  basisBps: number | null;
  /** Open interest the engine is carrying, in tUSDC. Null when unreadable. */
  openInterestUsdc: number | null;
  /** False when the code asked for is not a market we have. */
  known: boolean;
}

/** A placeholder for a code we do not have, so a screen can say so. */
function unknownMarket(code: string): MarketView {
  return {
    c: code.toUpperCase().slice(0, 8),
    sym: "?",
    name: "Unknown market",
    px: 0,
    off: 0,
    lev: 1,
    st: "Beta",
    reg: "—",
    dp: 2,
    src: [],
    unitSize: 1,
    unitLabel: "—",
    live: false,
    priceIsSample: false,
    paused: true,
    reason: "unknown market",
    pausedBecause: "We do not have a market with that name.",
    ageSeconds: null,
    sourceCount: 0,
    sourcesTried: 0,
    change24hPct: null,
    mark: null,
    basisBps: null,
    openInterestUsdc: null,
    known: false,
  };
}

/** Lay the live numbers over a sample market. */
function overlay(base: Market, l: LiveMarket | undefined): MarketView {
  if (!l) {
    return {
      ...base,
      live: false,
      priceIsSample: true,
      paused: false,
      reason: null,
      pausedBecause: null,
      ageSeconds: null,
      sourceCount: 0,
      sourcesTried: 0,
      change24hPct: null,
      mark: null,
      basisBps: null,
      openInterestUsdc: null,
      known: true,
    };
  }
  return {
    ...base,
    px: l.median ?? base.px,
    off: l.official ?? base.off,
    lev: l.maxLeverage,
    src: l.sources.length > 0 ? l.sources : base.src,
    live: l.median !== null,
    priceIsSample: l.median === null,
    paused: !l.acceptingPositions,
    reason: l.reason,
    pausedBecause: l.pausedBecause,
    ageSeconds: l.ageSeconds,
    sourceCount: l.sourceCount ?? l.sources.length,
    sourcesTried: l.sourcesTried ?? l.sources.length,
    change24hPct: l.change24hPct,
    mark: l.mark,
    basisBps: l.basisBps,
    openInterestUsdc:
      l.openInterestLongUsdc === null && l.openInterestShortUsdc === null
        ? null
        : (l.openInterestLongUsdc ?? 0) + (l.openInterestShortUsdc ?? 0),
    known: true,
    maxNotionalUsdc: l.maxNotionalUsdc ?? undefined,
    maxOpenInterestUsdc: l.maxOpenInterestUsdc ?? undefined,
  };
}

export function useMarket(code: string): MarketView {
  const { byCode } = useLive();

  // Memoised: callers pass this straight into effect dependency arrays, and a
  // fresh object every render re-fires those effects forever.
  return useMemo(() => {
    const base = findMarket(code);
    // No silent substitution. This used to answer with the naira for any code
    // it did not recognise, so a URL naming one currency rendered another.
    if (!base) return unknownMarket(code);
    return overlay(base, byCode.get(code));
  }, [byCode, code]);
}

/** Every market, live numbers applied. Order follows the sample data. */
export function useMarkets(): MarketView[] {
  const { byCode } = useLive();
  return useMemo(() => MARKETS.map((base) => overlay(base, byCode.get(base.c))), [byCode]);
}
