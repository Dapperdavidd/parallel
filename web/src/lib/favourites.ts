"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The markets somebody actually watches.
 *
 * Thirteen currencies is enough that a trader following two of them should not
 * have to find them each time. Kept in `localStorage` rather than on the
 * server: it is a preference, not an account, and sign-in is not required to
 * browse the board.
 *
 * The `storage` listener is what makes two open tabs agree — without it, a
 * star added in one tab is invisible in the other until a reload.
 */

const KEY = "parallel.favourites.v1";

const read = (): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
};

export function useFavourites(): {
  favourites: string[];
  isFavourite: (code: string) => boolean;
  toggle: (code: string) => void;
  /** False until after mount, so the server and first client render agree. */
  ready: boolean;
} {
  const [favourites, setFavourites] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setFavourites(read());
    setReady(true);
    const onStorage = (event: StorageEvent): void => {
      if (event.key === KEY) setFavourites(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback((code: string) => {
    setFavourites((current) => {
      const next = current.includes(code)
        ? current.filter((entry) => entry !== code)
        : [...current, code];
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* private mode: the star still works for this session */
      }
      return next;
    });
  }, []);

  const isFavourite = useCallback((code: string) => favourites.includes(code), [favourites]);

  return { favourites, isFavourite, toggle, ready };
}
