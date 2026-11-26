"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useMarkets } from "@/lib/live";

/**
 * The live half of the status page.
 *
 * Two reads, both of them the app's own: readiness, which says whether a trade
 * could be placed and which dependency is missing if not, and the market board,
 * which carries each market's measurement age and why it is paused.
 *
 * The headline is derived rather than declared. "Operational" is what it says
 * when the checks pass and nine markets are priced — not a value anybody can
 * set.
 */

interface Ready {
  ready: boolean;
  mode: string;
  marketsLive: number;
  marketsTotal: number;
  checks: { name: string; ok: boolean; detail: string }[];
  at: string;
}

const CHECK_WORDS: Record<string, string> = {
  registry: "Market configuration",
  index: "Price index",
  devnet: "Solana devnet",
};

const ago = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
};

const STALE_AFTER = 360;

export function StatusBoard() {
  const [ready, setReady] = useState<Ready | null>(null);
  const [failed, setFailed] = useState(false);
  const markets = useMarkets();

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/ready", { cache: "no-store" });
      setReady((await response.json()) as Ready);
      setFailed(false);
    } catch {
      // The status page failing to load is itself a status. Say that rather
      // than showing the last known good answer as though it were current.
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const stale = markets.filter((m) => m.live && (m.ageSeconds ?? 0) > STALE_AFTER);
  const paused = markets.filter((m) => m.paused);

  const headline = failed
    ? { tone: "down", words: "We cannot reach Parallel from your browser" }
    : !ready
      ? { tone: "wait", words: "Checking…" }
      : !ready.ready
        ? { tone: "down", words: "Trading is unavailable" }
        : stale.length > 0
          ? { tone: "degraded", words: "Trading, with some stale prices" }
          : { tone: "up", words: "Operational" };

  return (
    <>
      <div className={`sbanner is-${headline.tone}`} role="status" aria-live="polite">
        <span className="sdot" />
        <b>{headline.words}</b>
        {ready && (
          <span className="smeta">
            {ready.marketsLive} of {ready.marketsTotal} markets priced
            {paused.length > 0 && ` · ${paused.length} paused`}
            {stale.length > 0 && ` · ${stale.length} stale`}
            {" · checked "}
            {new Date(ready.at).toLocaleTimeString()}
          </span>
        )}
      </div>

      <section style={{ marginTop: 30 }}>
        <h2 style={{ fontSize: 22, letterSpacing: "-.02em" }}>Dependencies</h2>
        <div className="mtable" style={{ border: "1px solid var(--ln)", marginTop: 14 }}>
          {(ready?.checks ?? []).map((check) => (
            <div className="srow" key={check.name}>
              <b>
                <span className={check.ok ? "sdot is-up" : "sdot is-down"} />
                {CHECK_WORDS[check.name] ?? check.name}
              </b>
              <span className="mono">{check.ok ? "up" : "down"}</span>
              <span className="swhy">{check.detail}</span>
            </div>
          ))}
          {!ready && !failed && (
            <p style={{ padding: "18px 24px", margin: 0, color: "var(--ink3)" }}>Reading…</p>
          )}
          {failed && (
            <p style={{ padding: "18px 24px", margin: 0, color: "var(--dn)" }}>
              This page could not reach the API. That is itself a status: either we are down or
              your connection cannot reach us.
            </p>
          )}
        </div>
      </section>

      <section style={{ marginTop: 44 }}>
        <h2 style={{ fontSize: 22, letterSpacing: "-.02em" }}>Markets</h2>
        <div className="mtable" style={{ border: "1px solid var(--ln)", marginTop: 14 }}>
          {markets.map((m) => {
            const isStale = m.live && (m.ageSeconds ?? 0) > STALE_AFTER;
            const tone = m.paused ? "down" : isStale ? "degraded" : m.live ? "up" : "wait";
            return (
              <div className="srow" key={m.c}>
                <b>
                  <span className={`sdot is-${tone}`} />
                  <Link href={`/app/trade?m=${m.c}`} style={{ color: "inherit" }}>
                    USD/{m.c}
                  </Link>
                </b>
                <span className="mono">
                  {m.paused
                    ? "paused"
                    : m.live
                      ? `${m.ageSeconds === null ? "live" : ago(m.ageSeconds)} · ${m.sourceCount}/${m.sourcesTried}`
                      : "no price"}
                </span>
                <span className="swhy">
                  {m.pausedBecause ??
                    (isStale
                      ? "The last measurement is older than we aim for. Trading continues against it."
                      : m.live
                        ? `Measured from ${m.sourceCount} of ${m.sourcesTried} sources.`
                        : "No measurement yet.")}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
