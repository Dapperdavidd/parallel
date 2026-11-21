"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Settings popover, opened from the gear in the top bar.
 *
 * Deliberately a panel that overlays in place rather than a route: nothing
 * about changing a display preference should cost you your chart.
 *
 * PHASE 2 — the toggles hold their state and nothing more. Each is wired to a
 * real behaviour in Phase 3; the labels are the contract.
 */

interface Toggle {
  key: string;
  label: string;
  on: boolean;
  /** Not yet wired to anything — shown muted so it does not over-promise. */
  pending?: boolean;
}

const GROUPS: { title: string; items: Toggle[] }[] = [
  {
    title: "Trading",
    items: [
      { key: "confirmOpen", label: "Open position confirmation", on: true },
      { key: "confirmClose", label: "Close position confirmation", on: true },
      { key: "holdToClose", label: "Hold to close all positions", on: false },
      { key: "delayProtect", label: "Transaction delay protection", on: true },
    ],
  },
  {
    title: "Display",
    items: [
      { key: "showFills", label: "Show my fills on the chart", on: true },
      { key: "showPnl", label: "Show PnL", on: true },
      { key: "showOfficial", label: "Show official-rate overlay", on: true },
      { key: "compact", label: "Compact numbers", on: false },
    ],
  },
  {
    title: "Notifications",
    items: [
      { key: "fillNotify", label: "Fill notifications", on: true },
      { key: "fillSound", label: "Play sound on fill", on: false },
      { key: "liqWarn", label: "Liquidation warnings", on: true },
      { key: "verbose", label: "Verbose errors", on: false },
    ],
  },
];

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.on]))),
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="pop" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div className="pop-panel" role="dialog" aria-label="Settings">
          {GROUPS.map((g) => (
            <div className="pop-group" key={g.title}>
              <div className="pop-title">{g.title}</div>
              {g.items.map((i) => (
                <label className="pop-row" key={i.key}>
                  <span>{i.label}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={state[i.key] ?? false}
                    aria-label={i.label}
                    className={`sw${state[i.key] ? " on" : ""}`}
                    onClick={() => setState((s) => ({ ...s, [i.key]: !s[i.key] }))}
                  >
                    <i />
                  </button>
                </label>
              ))}
            </div>
          ))}
          <div className="pop-foot">
            <span>Devnet beta</span>
            <span className="mono">rev 2026-11-21</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Number-format and language picker, the globe next to the gear.
 * Phase 2 changes the label only.
 */
export function LocaleMenu() {
  const [open, setOpen] = useState(false);
  const [fmtStyle, setFmtStyle] = useState("1,234.56");
  const [lang, setLang] = useState("English");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="pop" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Language and number format"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
        </svg>
      </button>

      {open && (
        <div className="pop-panel" style={{ width: 260 }} role="dialog" aria-label="Language and number format">
          <div className="pop-group">
            <div className="pop-title">Number format</div>
            {["1,234.56", "1.234,56", "1 234.56"].map((f) => (
              <button
                key={f}
                type="button"
                className={`pop-opt${f === fmtStyle ? " on" : ""}`}
                onClick={() => setFmtStyle(f)}
              >
                <span className="mono">{f}</span>
              </button>
            ))}
          </div>
          <div className="pop-group">
            <div className="pop-title">Language</div>
            {["English", "Français", "Português", "हिन्दी"].map((l) => (
              <button
                key={l}
                type="button"
                className={`pop-opt${l === lang ? " on" : ""}`}
                onClick={() => setLang(l)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
