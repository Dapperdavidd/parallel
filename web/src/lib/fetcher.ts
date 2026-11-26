"use client";

/**
 * One GET at a time, per URL.
 *
 * Several components want the same data at the same moment and each asked for
 * it separately. Opening the trade screen signed in fired two requests for
 * the same wallet history — one from the portfolio snapshot, one from the
 * history panel — and every open or close refetched the market list the price
 * provider already had.
 *
 * None of that is a bug exactly; it is just paying twice, and the people this
 * product is for are paying for it by the megabyte.
 *
 * Two rules, which is all this needs to be:
 *
 *  - an identical request already in flight is **shared**, not repeated;
 *  - a response younger than `freshMs` is **reused** rather than refetched.
 *
 * Deliberately not a cache library. There is no revalidation strategy, no
 * subscription and no eviction policy beyond a size bound, because the data
 * that changes is already pushed by its own provider on its own clock. This
 * exists to stop the same request going out twice in the same second.
 */

interface Entry {
  at: number;
  /** Resolved body, once it has arrived. */
  value?: unknown;
  /** In flight, so a second caller can wait on the first. */
  inFlight?: Promise<unknown>;
}

const entries = new Map<string, Entry>();
/** Enough for every endpoint this app has, several times over. */
const MAX_ENTRIES = 64;

function remember(url: string, entry: Entry): void {
  if (entries.size >= MAX_ENTRIES) {
    // Oldest first. Insertion order is good enough for a map this size.
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  entries.set(url, entry);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The server's machine-readable code, when it sent one. */
    readonly code?: string,
    /** The reference to quote if this was ours rather than yours. */
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function getJson<T>(
  url: string,
  options: { freshMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const freshMs = options.freshMs ?? 0;
  const existing = entries.get(url);
  const now = Date.now();

  if (existing?.inFlight) return existing.inFlight as Promise<T>;
  if (existing && existing.value !== undefined && now - existing.at < freshMs) {
    return existing.value as T;
  }

  const inFlight = (async () => {
    const response = await fetch(url, { cache: "no-store", signal: options.signal });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (!response.ok) {
      const detail = body as { error?: string; code?: string; requestId?: string };
      throw new HttpError(
        response.status,
        detail.error ?? `Request failed (${response.status})`,
        detail.code,
        detail.requestId,
      );
    }
    return body;
  })();

  remember(url, { at: now, inFlight, value: existing?.value });

  try {
    const value = await inFlight;
    remember(url, { at: Date.now(), value });
    return value as T;
  } catch (error) {
    // A failure must not be cached, or one blip persists for `freshMs`.
    entries.delete(url);
    throw error;
  }
}

/**
 * Forget anything whose URL starts with this.
 *
 * Call it after a write, so the next read is the new truth rather than a
 * cached version of the old one.
 */
export function invalidate(prefix: string): void {
  for (const key of [...entries.keys()]) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

/** Visible to tests. */
export function resetCache(): void {
  entries.clear();
}
