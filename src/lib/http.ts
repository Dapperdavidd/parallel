/** Small fetch helper: timeout, retry, and a browser UA for the P2P web APIs. */

import { fetch, type RequestInit } from "undici";
import { dispatcher } from "./resolver.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0 Safari/537.36";

export interface FetchOpts {
  timeoutMs?: number;
  retries?: number;
  /** Delay between retries, doubled each attempt. */
  backoffMs?: number;
}

/**
 * Per-host circuit breaker.
 *
 * A venue that is blocked at the network layer costs a full timeout on every
 * attempt, and with retries that is half a minute for one dead source. The
 * index runs every two minutes across ~30 endpoints, so a couple of blocked
 * venues can eat the whole budget and push the cadence off schedule.
 *
 * After `BREAKER_FAILURES` consecutive connection failures a host is skipped
 * for a cooldown that lengthens with each trip, and the market pauses on its
 * own rules rather than on a stopwatch. One success closes the breaker
 * completely, including the backoff.
 */
const BREAKER_FAILURES = 2;

/**
 * Cooldown grows with each successive trip, rather than being a flat five
 * minutes.
 *
 * A flat long cooldown is right for a host that is genuinely dead and wrong for
 * one behind an intermittent filter, and we measurably have the second case: on
 * 2026-11-23 the venues answered roughly a quarter of the time, so a venue was
 * tripping, going quiet for five minutes, and taking whole markets with it.
 * Worse, the breaker is keyed by *host*, and `www.binance.com` is the P2P source
 * for seven markets while `www.okx.com` serves five — so one trip blacked out
 * several markets at once and USD/KES, GHS, EGP and PKR, whose only two sources
 * are those hosts, sat at 0% availability.
 *
 * Starting at 30s means a flaky host is retried on the next tick (the service
 * ticks every 120s) while a dead one still backs off to five minutes within a
 * few passes, which is what keeps a pass fast. See DECISIONS.md §7.18.
 */
const BREAKER_COOLDOWN_STEPS_MS = [30_000, 60_000, 150_000, 300_000];

/**
 * `trips` counts how many times this host has gone to cooldown, so the backoff
 * survives the half-open probe that resets `failures`.
 */
const breaker = new Map<string, { failures: number; openUntil: number; trips: number }>();

/** Half-open: one trial request is allowed the moment a cooldown expires. */
const cooldownFor = (trips: number): number =>
  BREAKER_COOLDOWN_STEPS_MS[Math.min(trips, BREAKER_COOLDOWN_STEPS_MS.length - 1)]!;

/** Connection-level failures trip the breaker; an HTTP error or bad JSON does not. */
const isConnectFailure = (err: unknown): boolean => {
  const code = (err as { cause?: { code?: string } })?.cause?.code;
  return (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "EAI_AGAIN" ||
    code === "ECONNRESET"
  );
};

/** Which hosts are currently being skipped, for diagnostics. */
export function openBreakers(): string[] {
  const now = Date.now();
  return [...breaker.entries()].filter(([, v]) => v.openUntil > now).map(([h]) => h);
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchOpts = {},
): Promise<T> {
  const { timeoutMs = 12_000, retries = 2, backoffMs = 500 } = opts;

  const host = new URL(url).hostname;
  const state = breaker.get(host);
  if (state && state.openUntil > Date.now()) {
    const left = Math.round((state.openUntil - Date.now()) / 1000);
    throw new Error(`unreachable (skipping ${host} for ${left}s)`);
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      // undici's own fetch, so the custom dispatcher is a first-class option
      // rather than a cast past the global fetch's types.
      const init: RequestInit = {
        signal: ac.signal,
        headers: { "User-Agent": UA, Accept: "application/json" },
        dispatcher,
      };
      const res = await fetch(url, init);
      breaker.delete(host); // we got a reply; the host is reachable
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        // Cloudflare and friends answer 200 with an HTML challenge page.
        throw new Error(`non-JSON response (${text.slice(0, 60).replace(/\s+/g, " ")}…)`);
      }
    } catch (err) {
      lastErr = err;
      if (isConnectFailure(err)) {
        const prev = breaker.get(host);
        const failures = (prev?.failures ?? 0) + 1;
        const tripping = failures >= BREAKER_FAILURES;
        const trips = (prev?.trips ?? 0) + (tripping ? 1 : 0);
        breaker.set(host, {
          failures,
          // `trips - 1`, so the first trip takes the first (shortest) step.
          openUntil: tripping ? Date.now() + cooldownFor(trips - 1) : 0,
          trips,
        });
        // Retrying a host we cannot connect to only spends the budget again.
        break;
      }
      if (attempt < retries) await sleep(backoffMs * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(describeErr(lastErr));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function describeErr(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError") return "timeout";
    // undici buries the useful part one level down.
    const code = (err as { cause?: { code?: string } }).cause?.code;
    if (code === "UND_ERR_CONNECT_TIMEOUT") return "connect timeout (blocked?)";
    if (code) return `${code}`;
    return err.message;
  }
  return String(err);
}

/** Parses a numeric field that APIs may return as string or number. */
export function num(v: unknown, what: string): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) throw new Error(`bad ${what}: ${JSON.stringify(v)}`);
  return n;
}

/** Mid price: the average of best bid and best ask. PRD oracle rule 2. */
export function mid(bid: unknown, ask: unknown, what: string): number {
  return (num(bid, `${what}.bid`) + num(ask, `${what}.ask`)) / 2;
}
