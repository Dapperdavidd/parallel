"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { numberStyle, setNumberStyle, type NumberStyle } from "./number-format";

/**
 * Applies the chosen number format to everything, by remounting.
 *
 * `fmt` is a plain function called from about ninety places. Threading a hook
 * through all of them, to serve a preference somebody changes roughly never,
 * would be a large change for a small reason and a large surface for a
 * missed call site.
 *
 * So the setting lives in a module, and this provider does two things around
 * it. It bumps a `key` when the choice changes, which remounts the subtree so
 * every `fmt()` runs again — cheap, and triggered only by a deliberate act.
 * And it waits for hydration before applying a stored choice, because the
 * server renders with the default and a first client render that disagreed
 * would be a hydration mismatch.
 */

interface FormatState {
  style: NumberStyle;
  choose: (locale: string) => void;
}

const Ctx = createContext<FormatState | null>(null);

export function FormatProvider({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0);
  const [style, setStyle] = useState<NumberStyle>(() => numberStyle());

  // After hydration, adopt whatever was stored. If it differs from what the
  // server rendered, the remount below is what puts it on screen.
  useEffect(() => {
    const stored = numberStyle();
    if (stored.locale !== style.locale) {
      setStyle(stored);
      setVersion((n) => n + 1);
    }
    // Once, on mount: `style` here is the server's default by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = useCallback((locale: string) => {
    setNumberStyle(locale);
    setStyle(numberStyle());
    setVersion((n) => n + 1);
  }, []);

  const value = useMemo<FormatState>(() => ({ style, choose }), [style, choose]);

  return (
    <Ctx.Provider value={value}>
      <div key={version} style={{ display: "contents" }}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function useNumberFormat(): FormatState {
  return useContext(Ctx) ?? { style: numberStyle(), choose: () => {} };
}
