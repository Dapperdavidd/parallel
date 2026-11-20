"use client";

/**
 * Phase 2 demo state.
 *
 * Everything here is pretend: there is no wallet, no chain call and no
 * database. Positions live in sessionStorage so a reviewer can click through
 * the whole flow, refresh, and still see their trades — but a new tab starts
 * clean.
 *
 * Phase 3 replaces this provider with real Privy auth, real Percolator reads
 * and Supabase history. The component API is deliberately the shape we will
 * want then (`signIn`, `openPosition`, `closePosition`), so screens do not
 * need redesigning.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  byCode,
  positionPnl,
  STARTING_BALANCE,
  TRADING_FEE_BPS,
  type Position,
} from "./mock";

interface DemoState {
  signedIn: boolean;
  user: string;
  balance: number;
  positions: Position[];
  market: string;
}

const INITIAL: DemoState = {
  signedIn: false,
  user: "",
  balance: STARTING_BALANCE,
  positions: [],
  market: "NGN",
};

interface Store extends DemoState {
  ready: boolean;
  openPnl: number;
  setMarket: (c: string) => void;
  signIn: (user: string) => void;
  signOut: () => void;
  openPosition: (p: Omit<Position, "id">) => void;
  closePosition: (id: number) => number;
}

const Ctx = createContext<Store | null>(null);
const KEY = "parallel.demo";

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<DemoState>(INITIAL);
  const [ready, setReady] = useState(false);

  // Hydrate after mount so the server and first client render match.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) setS({ ...INITIAL, ...(JSON.parse(raw) as Partial<DemoState>) });
    } catch {
      /* ignore corrupt state */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage can be unavailable in private mode */
    }
  }, [s, ready]);

  const setMarket = useCallback((market: string) => setS((p) => ({ ...p, market })), []);

  const signIn = useCallback(
    (user: string) =>
      setS((p) => ({ ...p, signedIn: true, user, balance: STARTING_BALANCE, market: "NGN" })),
    [],
  );

  const signOut = useCallback(() => setS(() => ({ ...INITIAL })), []);

  const openPosition = useCallback((p: Omit<Position, "id">) => {
    setS((prev) => {
      const fee = p.size * p.lev * (TRADING_FEE_BPS / 10_000);
      return {
        ...prev,
        balance: prev.balance - p.size - fee,
        positions: [{ ...p, id: Date.now() }, ...prev.positions],
      };
    });
  }, []);

  const closePosition = useCallback((id: number): number => {
    let realised = 0;
    setS((prev) => {
      const pos = prev.positions.find((x) => x.id === id);
      if (!pos) return prev;
      realised = positionPnl(pos);
      return {
        ...prev,
        balance: prev.balance + pos.size + realised,
        positions: prev.positions.filter((x) => x.id !== id),
      };
    });
    return realised;
  }, []);

  const openPnl = useMemo(
    () => s.positions.reduce((a, p) => a + positionPnl(p), 0),
    [s.positions],
  );

  const value = useMemo<Store>(
    () => ({ ...s, ready, openPnl, setMarket, signIn, signOut, openPosition, closePosition }),
    [s, ready, openPnl, setMarket, signIn, signOut, openPosition, closePosition],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemo(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDemo must be used inside <DemoProvider>");
  return v;
}

export { byCode };
