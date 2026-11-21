"use client";

/**
 * Privy authentication and opening trades use devnet. The position list and
 * close-position flow remain local until the next trading tranche lands.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import {
  byCode,
  positionPnl,
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
  balance: 0,
  positions: [],
  market: "NGN",
};

interface Store extends DemoState {
  ready: boolean;
  openPnl: number;
  setMarket: (c: string) => void;
  signIn: (user?: string) => void;
  signOut: () => void;
  openPosition: (p: Omit<Position, "id">) => void;
  closePosition: (id: number) => number;
  /** Request the devnet faucet minimum. */
  topUp: () => Promise<number>;
}

const Ctx = createContext<Store | null>(null);
const KEY = "parallel.demo";

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const { ready: authReady, authenticated, login, logout, user: privyUser } = usePrivy();
  const { wallets } = useWallets();
  const [s, setS] = useState<DemoState>(INITIAL);
  const [hydrated, setHydrated] = useState(false);
  const walletAddress = wallets[0]?.address ?? "";

  // Hydrate after mount so the server and first client render match.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) setS({ ...INITIAL, ...(JSON.parse(raw) as Partial<DemoState>) });
    } catch {
      /* ignore corrupt state */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage can be unavailable in private mode */
    }
  }, [s, hydrated]);

  const setMarket = useCallback((market: string) => setS((p) => ({ ...p, market })), []);

  const signIn = useCallback(() => void login(), [login]);

  const signOut = useCallback(() => {
    void logout();
    setS(() => ({ ...INITIAL }));
  }, [logout]);

  const fundWallet = useCallback(async (): Promise<number> => {
    if (!walletAddress) return 0;
    const response = await fetch("/api/faucet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: walletAddress }),
    });
    const body = (await response.json()) as { balance?: number; added?: number; error?: string };
    if (!response.ok || body.balance === undefined) {
      throw new Error(body.error ?? "Devnet funding failed");
    }
    setS((p) => ({ ...p, balance: body.balance ?? p.balance }));
    return body.added ?? 0;
  }, [walletAddress]);

  useEffect(() => {
    if (!authReady || !authenticated || !walletAddress) return;
    void fundWallet().catch(() => undefined);
  }, [authReady, authenticated, walletAddress, fundWallet]);

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

  /** Add money through the idempotent devnet faucet. */
  const topUp = useCallback(async (): Promise<number> => fundWallet(), [fundWallet]);

  const openPnl = useMemo(
    () => s.positions.reduce((a, p) => a + positionPnl(p), 0),
    [s.positions],
  );

  const ready = hydrated && authReady;
  const displayUser =
    privyUser?.email?.address?.split("@")[0] ??
    (walletAddress ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}` : "trader");
  const value = useMemo<Store>(
    () => ({
      ...s,
      ready,
      signedIn: authenticated,
      user: displayUser,
      openPnl,
      setMarket,
      signIn,
      signOut,
      openPosition,
      closePosition,
      topUp,
    }),
    [s, ready, authenticated, displayUser, openPnl, setMarket, signIn, signOut, openPosition, closePosition, topUp],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemo(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDemo must be used inside <DemoProvider>");
  return v;
}

export { byCode };
