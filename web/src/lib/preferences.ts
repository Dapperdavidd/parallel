"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The handful of choices a trader should not have to re-make.
 *
 * Kept in `localStorage`, because none of it is worth a server round trip and
 * none of it should follow somebody to another machine without being asked.
 * Read after mount so the server and the first client render agree.
 */

const KEY = "parallel.preferences.v1";

export interface Preferences {
  /**
   * Show the review step before sending a trade.
   *
   * On by default. A confirmation nobody can turn off becomes a reflex, and a
   * reflex is not a safeguard — but it is the right default for somebody's
   * first trade, so the choice is theirs rather than ours.
   */
  confirmTrades: boolean;
  /** How far the fill may drift from the price on screen, in basis points. */
  maxSlippageBps: number;
}

export const DEFAULTS: Preferences = {
  confirmTrades: true,
  maxSlippageBps: 100,
};

/** The tolerances a person can pick between, as basis points. */
export const SLIPPAGE_CHOICES = [25, 50, 100, 300] as const;

const read = (): Preferences => {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      confirmTrades:
        typeof parsed.confirmTrades === "boolean" ? parsed.confirmTrades : DEFAULTS.confirmTrades,
      maxSlippageBps:
        typeof parsed.maxSlippageBps === "number" &&
        parsed.maxSlippageBps >= 1 &&
        parsed.maxSlippageBps <= 1_000
          ? parsed.maxSlippageBps
          : DEFAULTS.maxSlippageBps,
    };
  } catch {
    return DEFAULTS;
  }
};

export function usePreferences(): {
  preferences: Preferences;
  set: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  ready: boolean;
} {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPreferences(read());
    setReady(true);
    const onStorage = (event: StorageEvent): void => {
      if (event.key === KEY) setPreferences(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const set = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]): void => {
      setPreferences((current) => {
        const next = { ...current, [key]: value };
        try {
          window.localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* private mode: the choice holds for this session */
        }
        return next;
      });
    },
    [],
  );

  return { preferences, set, ready };
}
