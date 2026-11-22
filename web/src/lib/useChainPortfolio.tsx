"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { summarize, type RealizedSummary, type VerifiedTrade } from "./portfolio";
import { useDemo } from "./store";

/**
 * The signed-in wallet's confirmed on-chain state, in one place.
 *
 * Both the portfolio page and the trade screen's positions panel need the same
 * thing — the real portfolios, the real legs, and the verified trade history —
 * so they read it through this rather than each keeping its own copy of the
 * fetching, the error handling and the atom arithmetic.
 *
 * Positions here are what the chain says, not what this browser remembers. A
 * position opened on another device shows up; one this tab "has" but the chain
 * does not, does not.
 *
 * It is a provider rather than a plain hook because opening a trade on the
 * ticket has to refresh the positions panel beside it, and closing from the
 * panel has to refresh the balances above it. One shared snapshot, one reload.
 */

export interface ChainPosition {
  side: "long" | "short";
  sizeQ: string;
  notionalAtoms: string;
}

export interface ChainPortfolio {
  address: string;
  marketId: string;
  code: string;
  unit: number;
  unitLabel: string;
  maxLeverage: number;
  capitalAtoms: string;
  pnlAtoms: string;
  equityAtoms: string;
  effectivePriceE6: string;
  positions: ChainPosition[];
}

export interface PortfolioSnapshot {
  wallet: string;
  slot: number;
  walletAtoms: string;
  portfolioEquityAtoms: string;
  storedPnlAtoms: string;
  totalEquityAtoms: string;
  portfolios: ChainPortfolio[];
}

export interface OpenPosition {
  portfolio: ChainPortfolio;
  position: ChainPosition;
}

export interface ChainPortfolioState {
  snapshot: PortfolioSnapshot | null;
  /** Null until the history request settles; `[]` means "none, confirmed". */
  trades: VerifiedTrade[] | null;
  summary: RealizedSummary;
  positions: OpenPosition[];
  walletBalance: number;
  portfolioEquity: number;
  equity: number;
  unrealized: number;
  error: string;
  loading: boolean;
  refresh: () => void;
  /** Awaitable, for a caller that wants to reload before reporting success. */
  reload: () => Promise<void>;
}

export const usdc = (atoms: string): number => Number(BigInt(atoms)) / 1_000_000;

const Ctx = createContext<ChainPortfolioState | null>(null);

function useChainPortfolioValue(): ChainPortfolioState {
  const { signedIn, walletAddress } = useDemo();

  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [trades, setTrades] = useState<VerifiedTrade[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    if (!walletAddress) return;
    const wallet = encodeURIComponent(walletAddress);
    setLoading(true);
    try {
      const [chain, history] = await Promise.all([
        fetch(`/api/portfolio?wallet=${wallet}`, { cache: "no-store" }),
        fetch(`/api/trades?wallet=${wallet}&limit=100`, { cache: "no-store" }),
      ]);
      const body = (await chain.json()) as PortfolioSnapshot & { error?: string };
      if (!chain.ok) throw new Error(body.error ?? "The portfolio read failed");
      setSnapshot(body);
      // History is supporting detail: losing it must not blank the balances.
      setTrades(history.ok ? ((await history.json()) as { trades: VerifiedTrade[] }).trades : []);
      setError("");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  const refresh = useCallback((): void => {
    void reload().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "The portfolio read failed");
    });
  }, [reload]);

  useEffect(() => {
    if (!signedIn || !walletAddress) return;
    refresh();
  }, [signedIn, walletAddress, refresh]);

  const summary = useMemo(() => summarize(trades ?? []), [trades]);

  const positions = useMemo(
    () =>
      (snapshot?.portfolios ?? []).flatMap((portfolio) =>
        portfolio.positions.map((position) => ({ portfolio, position })),
      ),
    [snapshot],
  );

  return {
    snapshot,
    trades,
    summary,
    positions,
    walletBalance: snapshot ? usdc(snapshot.walletAtoms) : 0,
    portfolioEquity: snapshot ? usdc(snapshot.portfolioEquityAtoms) : 0,
    equity: snapshot ? usdc(snapshot.totalEquityAtoms) : 0,
    unrealized: snapshot ? usdc(snapshot.storedPnlAtoms) : 0,
    error,
    loading,
    refresh,
    reload,
  };
}

export function ChainPortfolioProvider({ children }: { children: React.ReactNode }) {
  const value = useChainPortfolioValue();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Outside the provider this returns an inert snapshot rather than throwing, so
 * a component can be rendered on a page that does not mount it without
 * crashing the page.
 */
export function useChainPortfolio(): ChainPortfolioState {
  return (
    useContext(Ctx) ?? {
      snapshot: null,
      trades: null,
      summary: summarize([]),
      positions: [],
      walletBalance: 0,
      portfolioEquity: 0,
      equity: 0,
      unrealized: 0,
      error: "",
      loading: false,
      refresh: () => {},
      reload: () => Promise.resolve(),
    }
  );
}
