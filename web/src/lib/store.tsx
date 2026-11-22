"use client";

/**
 * Privy authentication, the signed-in identity, the selected market and the
 * devnet faucet.
 *
 * This no longer holds positions or a balance. Both are read from the chain
 * through `useChainPortfolio`, so there is one source of truth for what the
 * wallet owns and nothing to drift out of step with it.
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
interface DemoState {
  signedIn: boolean;
  user: string;
  market: string;
}

const INITIAL: DemoState = {
  signedIn: false,
  user: "",
  market: "NGN",
};

interface Store extends DemoState {
  ready: boolean;
  walletAddress: string;
  setMarket: (c: string) => void;
  signIn: (user?: string) => void;
  signOut: () => void;
  /** Request the devnet faucet minimum. Returns the amount added. */
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
    return body.added ?? 0;
  }, [walletAddress]);

  useEffect(() => {
    if (!authReady || !authenticated || !walletAddress) return;
    void fundWallet().catch(() => undefined);
  }, [authReady, authenticated, walletAddress, fundWallet]);

  /** Add money through the idempotent devnet faucet. */
  const topUp = useCallback(async (): Promise<number> => fundWallet(), [fundWallet]);

  const ready = hydrated && authReady;
  const displayUser =
    privyUser?.email?.address?.split("@")[0] ??
    (walletAddress ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}` : "trader");
  const value = useMemo<Store>(
    () => ({
      ...s,
      ready,
      signedIn: authenticated,
      walletAddress,
      user: displayUser,
      setMarket,
      signIn,
      signOut,
      topUp,
    }),
    [s, ready, authenticated, walletAddress, displayUser, setMarket, signIn, signOut, topUp],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemo(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDemo must be used inside <DemoProvider>");
  return v;
}
