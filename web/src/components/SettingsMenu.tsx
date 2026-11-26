"use client";

import { useEffect, useRef, useState } from "react";
import { useNumberFormat } from "@/lib/format-provider";
import { usePreferences } from "@/lib/preferences";
import { NUMBER_STYLES } from "@/lib/number-format";

/**
 * Settings popover, opened from the gear in the top bar.
 *
 * Deliberately a panel that overlays in place rather than a route: nothing
 * about changing a display preference should cost you your chart.
 *
 * It used to carry twelve switches that held their own state and changed
 * nothing — "Play sound on fill", "Liquidation warnings", "Transaction delay
 * protection". They were written as a contract for Phase 3, and a person
 * using the app cannot tell a contract from a feature. Switching off
 * liquidation warnings that were never on is worse than having no switch.
 *
 * What is here now is what works, wired to `lib/preferences.ts`. What is not
 * built is named at the bottom, which is the honest version of the same
 * promise.
 */

const TOGGLES: { key: "confirmTrades" | "showFills" | "showOfficial"; label: string; hint: string }[] = [
  {
    key: "confirmTrades",
    label: "Review before sending",
    hint: "Show the order summary and wait for a second press.",
  },
  {
    key: "showFills",
    label: "My fills on the chart",
    hint: "Markers where this wallet opened and closed.",
  },
  {
    key: "showOfficial",
    label: "Official-rate overlay",
    hint: "The published rate, dashed, behind the street candles.",
  },
];

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const { preferences, set } = usePreferences();
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
          <div className="pop-group">
            <div className="pop-title">Trading</div>
            {TOGGLES.filter((t) => t.key === "confirmTrades").map((t) => (
              <label className="pop-row" key={t.key} title={t.hint}>
                <span>{t.label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preferences[t.key]}
                  aria-label={t.label}
                  className={`sw${preferences[t.key] ? " on" : ""}`}
                  onClick={() => set(t.key, !preferences[t.key])}
                >
                  <i />
                </button>
              </label>
            ))}
            <div className="pop-row" title="We refuse a fill that has moved further than this.">
              <span>Max slippage</span>
              <span className="mono" style={{ fontSize: 12, color: "var(--ink2)" }}>
                {preferences.maxSlippageBps / 100}%
              </span>
            </div>
            <p className="pop-note">Slippage is set on the order ticket, beside the trade.</p>
          </div>

          <div className="pop-group">
            <div className="pop-title">Chart</div>
            {TOGGLES.filter((t) => t.key !== "confirmTrades").map((t) => (
              <label className="pop-row" key={t.key} title={t.hint}>
                <span>{t.label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preferences[t.key]}
                  aria-label={t.label}
                  className={`sw${preferences[t.key] ? " on" : ""}`}
                  onClick={() => set(t.key, !preferences[t.key])}
                >
                  <i />
                </button>
              </label>
            ))}
          </div>

          <div className="pop-group">
            <div className="pop-title">Not built yet</div>
            <p className="pop-note">
              Fill notifications, sounds and liquidation alerts. There were switches for these
              and they did nothing, which is a worse promise than this sentence.
            </p>
          </div>

          <div className="pop-foot">
            <span>Devnet beta</span>
            <span className="mono">devnet</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Number format, the globe next to the gear.
 *
 * It used to offer four languages and three number formats, and apply none of
 * them: both pickers set a piece of React state and stopped there. A menu
 * offering Français to somebody who then reads an English screen is worse
 * than no menu, and this product cannot afford small lies in its interface.
 *
 * So the number format is now real — it is the one of the two that can be
 * done properly, and `Intl` does the work. The language list is gone,
 * replaced by a sentence saying English is all there is. When there is a
 * translation, it goes here.
 */
export function LocaleMenu() {
  const [open, setOpen] = useState(false);
  const { style, choose } = useNumberFormat();
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
        aria-label="Number format"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
        </svg>
      </button>

      {open && (
        <div className="pop-panel" style={{ width: 268 }} role="dialog" aria-label="Number format">
          <div className="pop-group">
            <div className="pop-title">Number format</div>
            {NUMBER_STYLES.map((option) => (
              <button
                key={option.locale}
                type="button"
                className={`pop-opt${option.locale === style.locale ? " on" : ""}`}
                aria-pressed={option.locale === style.locale}
                title={option.label}
                onClick={() => {
                  choose(option.locale);
                  setOpen(false);
                }}
              >
                <span className="mono">{option.sample}</span>
              </button>
            ))}
          </div>
          <div className="pop-group">
            <div className="pop-title">Language</div>
            <p className="pop-note">
              English only, for now. We would rather say that than offer a language and then
              show you this sentence in English anyway.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
