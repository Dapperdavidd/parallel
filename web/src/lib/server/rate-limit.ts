import "server-only";

/**
 * Per-caller request ceilings.
 *
 * Every route here either spends money (the faucet mints, the prepare routes
 * sign with a liquidity authority) or spends somebody else's quota (each
 * market read is an RPC call). Before this, a loop on a laptop could drain the
 * faucet's SOL or push us past the RPC allowance the whole app depends on.
 *
 * The counter is in this process's memory. That is a deliberate, stated
 * limitation: it holds for the single-instance deployment we run today, and it
 * resets on restart. The faucet — the only path that moves value — does not
 * rely on it alone; it also records each claim in the store, so its cooldown
 * survives a restart and a second instance. See `faucet-claims.ts`.
 */

export interface Ceiling {
  /** Used in the log line and the response, so make it readable. */
  readonly name: string;
  readonly windowMs: number;
  readonly max: number;
}

export const CEILINGS = {
  /** Reads: generous, but not unbounded. */
  read: { name: "read", windowMs: 60_000, max: 240 } as Ceiling,
  /** Anything that signs or writes. */
  write: { name: "write", windowMs: 60_000, max: 30 } as Ceiling,
  /** A prepared trade costs an RPC round trip and a signature. */
  prepare: { name: "prepare", windowMs: 60_000, max: 20 } as Ceiling,
  /** The faucet, per address; the durable cooldown is separate and longer. */
  faucet: { name: "faucet", windowMs: 60_000, max: 4 } as Ceiling,
  /** Ownership challenges are cheap but should not be farmed. */
  challenge: { name: "challenge", windowMs: 60_000, max: 20 } as Ceiling,
} as const;

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
let lastSweep = 0;

/** Drop expired windows occasionally, so a busy day cannot grow the map forever. */
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export interface Verdict {
  readonly ok: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  readonly limit: number;
}

/** Count one request against a ceiling, and say whether it is allowed. */
export function take(ceiling: Ceiling, identity: string): Verdict {
  const now = Date.now();
  sweep(now);
  const key = `${ceiling.name}:${identity}`;
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + ceiling.windowMs });
    return { ok: true, remaining: ceiling.max - 1, retryAfterSeconds: 0, limit: ceiling.max };
  }
  existing.count += 1;
  const remaining = Math.max(0, ceiling.max - existing.count);
  if (existing.count > ceiling.max) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      limit: ceiling.max,
    };
  }
  return { ok: true, remaining, retryAfterSeconds: 0, limit: ceiling.max };
}

/**
 * Who to count against.
 *
 * Behind a proxy the socket address is the proxy's, so the left-most hop in
 * `x-forwarded-for` is the caller. That header is forgeable by anyone talking
 * to us directly, which is why nothing security-critical is keyed on it alone:
 * it is a fair-use counter, and the faucet additionally keys on the wallet.
 */
export function callerIdentity(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

/** Headers that let a well-behaved client back off before being refused. */
export function ceilingHeaders(verdict: Verdict): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(verdict.limit),
    "RateLimit-Remaining": String(verdict.remaining),
  };
  if (!verdict.ok) headers["Retry-After"] = String(verdict.retryAfterSeconds);
  return headers;
}

/** Visible to tests, so one case cannot leak a window into the next. */
export function resetCeilings(): void {
  windows.clear();
}
