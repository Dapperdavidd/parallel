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
  useRef,
  useState,
} from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useWallets } from "@privy-io/react-auth/solana";
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
  /** What went wrong signing in, if anything. Cleared by trying again. */
  authError: string;
  /** True between asking to sign in and either a wallet or a failure. */
  signingIn: boolean;
  /** Why the automatic devnet top-up did not happen, if it did not. */
  fundingError: string;
  retryFunding: () => void;
  setMarket: (c: string) => void;
  signIn: (user?: string) => void;
  signOut: () => void;
  /** Request the devnet faucet minimum. Returns the amount added. */
  topUp: () => Promise<number>;
}

const Ctx = createContext<Store | null>(null);
const KEY = "parallel.demo";

/** Base64 without pulling a Node Buffer shim into the browser bundle. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const { ready: authReady, authenticated, login, logout, user: privyUser } = usePrivy();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const [s, setS] = useState<DemoState>(INITIAL);
  const [hydrated, setHydrated] = useState(false);
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [fundingError, setFundingError] = useState("");
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

  /**
   * Sign in, and say so when it does not work.
   *
   * This was `void login()` — the promise's rejection was dropped on the
   * floor, so a login that failed left the page exactly as it was, with no
   * error and no way to tell whether anything had happened. A person in that
   * position presses the button again, and again.
   */
  const signIn = useCallback(() => {
    setAuthError("");
    setSigningIn(true);
    try {
      const result = login() as unknown;
      if (result instanceof Promise) {
        void result
          .catch((error: unknown) => {
            // Closing the modal is a choice, not a failure.
            const message = error instanceof Error ? error.message : String(error);
            if (/exited|cancel|closed/i.test(message)) return;
            setAuthError("Sign-in did not complete. Try again, or use a different email.");
          })
          .finally(() => setSigningIn(false));
      } else {
        setSigningIn(false);
      }
    } catch (error) {
      setSigningIn(false);
      setAuthError(error instanceof Error ? error.message : "Sign-in could not start");
    }
  }, [login]);

  const signOut = useCallback(() => {
    void logout();
    setS(() => ({ ...INITIAL }));
  }, [logout]);

  /**
   * Prove the wallet is ours, then ask the faucet.
   *
   * The faucet mints, so it will not fund an address on a browser's word
   * alone — see `lib/server/wallet-proof.ts`. The server issues a challenge,
   * the wallet signs it, and the signature travels with the request. The
   * embedded wallet signs without a dialog (`lib/privy.tsx`), so a person
   * signing in sees funds arrive rather than a prompt they did not ask for.
   */
  const fundWallet = useCallback(async (): Promise<number> => {
    const wallet = wallets[0];
    if (!wallet || !walletAddress) return 0;

    const challenged = await fetch("/api/auth/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: walletAddress, purpose: "faucet" }),
    });
    const challenge = (await challenged.json()) as {
      message?: string;
      token?: string;
      error?: string;
    };
    if (!challenged.ok || !challenge.message || !challenge.token) {
      throw new Error(challenge.error ?? "Could not start the devnet top-up");
    }

    const { signature } = await signMessage({
      message: new TextEncoder().encode(challenge.message),
      wallet,
    });

    const response = await fetch("/api/faucet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        wallet: walletAddress,
        proof: challenge.token,
        signature: toBase64(signature),
      }),
    });
    const body = (await response.json()) as { balance?: number; added?: number; error?: string };
    if (!response.ok || body.balance === undefined) {
      throw new Error(body.error ?? "Devnet funding failed");
    }
    return body.added ?? 0;
  }, [wallets, walletAddress, signMessage]);

  // One automatic top-up per wallet per session. Without the guard, a
  // re-render that changes the wallet array identity would ask again, and the
  // faucet's cooldown would start refusing a person who had done nothing.
  const fundedRef = useRef<string>("");
  useEffect(() => {
    if (!authReady || !authenticated || !walletAddress) return;
    if (fundedRef.current === walletAddress) return;
    fundedRef.current = walletAddress;
    // A failed top-up is not fatal — the wallet exists and the person can ask
    // again — but it must be visible, or they are left looking at a balance
    // of zero with no idea why.
    void fundWallet()
      .then(() => setFundingError(""))
      .catch((error: unknown) =>
        setFundingError(
          error instanceof Error ? error.message : "The devnet top-up did not go through",
        ),
      );
  }, [authReady, authenticated, walletAddress, fundWallet]);

  const retryFunding = useCallback(() => {
    fundedRef.current = "";
    setFundingError("");
    void fundWallet().catch((error: unknown) =>
      setFundingError(
        error instanceof Error ? error.message : "The devnet top-up did not go through",
      ),
    );
  }, [fundWallet]);

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
      authError,
      signingIn,
      fundingError,
      retryFunding,
      setMarket,
      signIn,
      signOut,
      topUp,
    }),
    [
      s,
      ready,
      authenticated,
      walletAddress,
      displayUser,
      authError,
      signingIn,
      fundingError,
      retryFunding,
      setMarket,
      signIn,
      signOut,
      topUp,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemo(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDemo must be used inside <DemoProvider>");
  return v;
}
