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
import { MARKETS, type Market } from "./mock";

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
  unitLabel: string;
  maxLeverage: number;
  status: string;
  acceptingPositions: boolean;
  reason: string | null;
  sources: string[];
  ts: string | null;
  change24hPct: number | null;
  lastPushTx: string | null;
  marketAccount: string;
}

interface LiveState {
  /** Keyed by currency code: NGN, ZAR … */
  byCode: Map<string, LiveMarket>;
  /** True once a response with at least one priced market has arrived. */
  isLive: boolean;
  /** When the last successful fetch landed. */
  at: string | null;
  error: string | null;
  refresh: () => void;
}

const Ctx = createContext<LiveState | null>(null);

/** How often the board re-reads the index. The service writes every 2 minutes. */
const POLL_MS = 30_000;

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [byCode, setByCode] = useState<Map<string, LiveMarket>>(new Map());
  const [isLive, setIsLive] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/markets", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { markets: LiveMarket[]; at: string };
      const map = new Map(body.markets.map((m) => [m.code, m]));
      setByCode(map);
      setAt(body.at);
      setError(null);
      setIsLive(body.markets.some((m) => m.median !== null));
    } catch (err) {
      // Keep the last good data on screen; say so rather than blanking.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    // A tab that comes back after an hour should not show an hour-old price.
    const onVisible = (): void => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const value = useMemo<LiveState>(
    () => ({ byCode, isLive, at, error, refresh: () => void load() }),
    [byCode, isLive, at, error, load],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLive(): LiveState {
  return (
    useContext(Ctx) ?? {
      byCode: new Map(),
      isLive: false,
      at: null,
      error: null,
      refresh: () => {},
    }
  );
}

/**
 * One market, with live numbers where they exist.
 *
 * `live` is true only when this market's price came from the index this
 * session — a paused market keeps its last sample price and reports false, so
 * a caller can label it honestly.
 */
export function useMarket(
  code: string,
): Market & { live: boolean; paused: boolean; reason: string | null } {
  const { byCode } = useLive();

  // Memoised: callers pass this straight into effect dependency arrays, and a
  // fresh object every render re-fires those effects forever.
  return useMemo(() => {
    const base = MARKETS.find((m) => m.c === code) ?? MARKETS[0]!;
    const l = byCode.get(code);
    if (!l) return { ...base, live: false, paused: false, reason: null };
    return {
      ...base,
      px: l.median ?? base.px,
      off: l.official ?? base.off,
      lev: l.maxLeverage,
      st: l.acceptingPositions ? base.st : base.st,
      src: l.sources.length > 0 ? l.sources : base.src,
      live: l.median !== null,
      paused: !l.acceptingPositions,
      reason: l.reason,
    };
  }, [byCode, code]);
}

/** Every market, live numbers applied. Order follows the sample data. */
export function useMarkets(): (Market & { live: boolean; paused: boolean })[] {
  const { byCode } = useLive();
  return useMemo(
    () =>
      MARKETS.map((base) => {
        const l = byCode.get(base.c);
        if (!l) return { ...base, live: false, paused: false };
        return {
          ...base,
          px: l.median ?? base.px,
          off: l.official ?? base.off,
          lev: l.maxLeverage,
          src: l.sources.length > 0 ? l.sources : base.src,
          live: l.median !== null,
          paused: !l.acceptingPositions,
        };
      }),
    [byCode],
  );
}
