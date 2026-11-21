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

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchOpts = {},
): Promise<T> {
  const { timeoutMs = 12_000, retries = 2, backoffMs = 500 } = opts;

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
    return err.name === "AbortError" ? "timeout" : err.message;
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
