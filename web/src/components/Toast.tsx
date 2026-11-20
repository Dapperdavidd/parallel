"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

const Ctx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState("");
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((m: string) => {
    setMsg(m);
    setOn(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), 2400);
  }, []);

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className={`toast${on ? " on" : ""}`} role="status" aria-live="polite">
        {msg}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = (): ((msg: string) => void) => useContext(Ctx);
