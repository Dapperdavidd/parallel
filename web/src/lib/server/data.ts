import "server-only";

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Read-only access to what the index service and keeper produce.
 *
 * The web app and the services are separate deployables — Vercel hosts this,
 * the keeper runs beside the oracle key — so they share a contract rather than
 * code: the Supabase schema, and the committed market registry. This module is
 * the read half of that contract.
 *
 * Two backends, same shape:
 *   - Supabase, when SUPABASE_URL and SUPABASE_ANON_KEY are set;
 *   - otherwise the JSON files the local store driver writes, so the whole app
 *     runs against real prices on one machine with no credentials at all.
 *
 * Everything here is `server-only`: a route handler or server component may
 * import it, a client component may not.
 */

export interface MarketInfo {
  id: string;
  currency: string;
  unit: number;
  unitLabel: string;
  status: string;
  maxLeverage: number;
  market: string;
  vault: string;
  assetIndex: number;
  liquidityVault?: {
    authority: string;
    portfolio: string;
    capitalAtoms: string;
    maxNotionalUsdc: number;
    maxOpenInterestUsdc: number;
  };
}

export interface SourceReading {
  id: string;
  label?: string;
  ok: boolean;
  rate?: number;
  error?: string;
}

export interface Tick {
  market: string;
  ts: string;
  median: number | null;
  unitPriceUsd: number | null;
  official: number | null;
  premiumPct: number | null;
  status: string;
  reason?: string;
  sourcesUsed: string[];
  dropped: { id: string; rate: number; deviationPct: number }[];
  failed: { id: string; error: string }[];
  breakdown: SourceReading[];
  pushedTx: string | null;
  pushedSlot: number | null;
}

export interface Candle {
  openTs: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Where the services write when there is no database. */
const DATA_DIR = process.env.PARALLEL_DATA_DIR ?? join(process.cwd(), "..", "data");
const REGISTRY = process.env.PARALLEL_REGISTRY ?? join(process.cwd(), "..", "market-registry.json");

let supabase: SupabaseClient | null | undefined;

/**
 * The database client, or null when none is configured.
 *
 * **Service role, not anon.** Every caller in this module is `server-only`, so
 * the key never reaches a browser, and the schema was written on the
 * assumption that writes and private tables belong to the service role:
 * `hedges` has no anon read policy at all, and no table grants anon `insert`.
 * Preferring the anon key here meant a configured database silently refused
 * every write and every hedge read — see DECISIONS.md §7.18.
 *
 * The anon key stays in the environment because it is the right key for a
 * browser, which is not what this file is.
 */
function db(): SupabaseClient | null {
  if (supabase !== undefined) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return supabase;
}

/**
 * A configured database is authoritative: never quietly answer from the local
 * files instead.
 *
 * The files are the *other* backend, for a machine with no credentials — not a
 * safety net underneath this one. Falling through on error is what hid the
 * permission failures above, answering with stale local history as though it
 * were live. A real failure should be loud.
 */
function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`supabase ${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`supabase ${what}: no rows returned`);
  return result.data;
}

/** True when the pipeline has produced anything for us to show. */
export async function hasLiveData(): Promise<boolean> {
  if (db()) return true;
  return existsSync(REGISTRY);
}

const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
};

const readLines = async <T>(path: string): Promise<T[]> => {
  try {
    const text = await readFile(path, "utf8");
    return text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as T];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
};

const tickFile = (id: string): string => join(DATA_DIR, "ticks", `${id.replace("/", "-")}.jsonl`);
const officialFile = (id: string): string =>
  join(DATA_DIR, "official", `${id.replace("/", "-")}.json`);
const candleFile = (id: string): string => join(DATA_DIR, "candles", `${id.replace("/", "-")}.json`);

// ------------------------------------------------------------------ markets --

export async function listMarkets(): Promise<MarketInfo[]> {
  const registry = await readJson<{ markets: MarketInfo[] }>(REGISTRY, { markets: [] });
  const registryById = new Map(registry.markets.map((market) => [market.id, market]));
  const client = db();
  if (client) {
    const { data } = await client.from("markets").select("*").order("id");
    if (data && data.length > 0) {
      return data.map((m) => {
        const local = registryById.get(m.id);
        return {
          id: m.id,
          currency: m.currency,
          unit: m.unit,
          unitLabel: m.unit_label,
          status: m.status,
          maxLeverage: m.max_leverage,
          market: m.slab_pubkey ?? local?.market ?? "",
          vault: m.vault_pubkey ?? local?.vault ?? "",
          assetIndex: local?.assetIndex ?? 0,
          liquidityVault: local?.liquidityVault,
        };
      });
    }
  }

  return registry.markets;
}

/** The devnet addresses, for the index page and the docs. */
export async function registryMeta(): Promise<{
  collateralMint: string;
  oracleAuthority: string;
  percolatorProgram: string;
} | null> {
  const reg = await readJson<{
    collateralMint?: string;
    oracleAuthority?: string;
    percolatorProgram?: string;
  }>(REGISTRY, {});
  if (!reg.collateralMint) return null;
  return {
    collateralMint: reg.collateralMint,
    oracleAuthority: reg.oracleAuthority ?? "",
    percolatorProgram: reg.percolatorProgram ?? "",
  };
}

// -------------------------------------------------------------------- ticks --

function rowToTick(r: Record<string, unknown>): Tick {
  const breakdown = (r.breakdown ?? {}) as {
    readings?: SourceReading[];
    dropped?: Tick["dropped"];
    failed?: Tick["failed"];
  };
  return {
    market: r.market_id as string,
    ts: r.ts as string,
    median: (r.median as number) ?? null,
    unitPriceUsd: (r.unit_price_usd as number) ?? null,
    official: (r.official as number) ?? null,
    premiumPct: (r.premium as number) ?? null,
    status: r.status as string,
    reason: (r.reason as string) ?? undefined,
    sourcesUsed: (r.sources_used as string[]) ?? [],
    dropped: breakdown.dropped ?? [],
    failed: breakdown.failed ?? [],
    breakdown: breakdown.readings ?? [],
    pushedTx: (r.pushed_tx as string) ?? null,
    pushedSlot: (r.pushed_slot as number) ?? null,
  };
}

export async function latestTick(marketId: string): Promise<Tick | null> {
  const client = db();
  if (client) {
    const { data } = await client
      .from("index_ticks")
      .select("*")
      .eq("market_id", marketId)
      .order("ts", { ascending: false })
      .limit(1);
    if (data && data.length > 0) return rowToTick(data[0] as Record<string, unknown>);
  }
  const all = await readLines<Tick>(tickFile(marketId));
  return all.length > 0 ? all[all.length - 1]! : null;
}

/** The latest tick for every market, in one pass. */
export async function latestTicks(): Promise<Map<string, Tick>> {
  const markets = await listMarkets();
  const out = new Map<string, Tick>();
  await Promise.all(
    markets.map(async (m) => {
      const t = await latestTick(m.id);
      if (t) out.set(m.id, t);
    }),
  );
  return out;
}

export async function recentTicks(marketId: string, limit = 120): Promise<Tick[]> {
  const client = db();
  if (client) {
    const { data } = await client
      .from("index_ticks")
      .select("*")
      .eq("market_id", marketId)
      .order("ts", { ascending: false })
      .limit(limit);
    if (data) return data.map((r) => rowToTick(r as Record<string, unknown>)).reverse();
  }
  const all = await readLines<Tick>(tickFile(marketId));
  return all.slice(Math.max(0, all.length - limit));
}

// ------------------------------------------------------------------ candles --

export async function candles(
  marketId: string,
  timeframe: string,
  limit = 240,
): Promise<Candle[]> {
  const client = db();
  if (client) {
    const { data } = await client
      .from("candles")
      .select("open_ts, open, high, low, close")
      .eq("market_id", marketId)
      .eq("timeframe", timeframe)
      .order("open_ts", { ascending: false })
      .limit(limit);
    if (data && data.length > 0) {
      return data
        .map((c) => ({
          openTs: c.open_ts as string,
          open: c.open as number,
          high: c.high as number,
          low: c.low as number,
          close: c.close as number,
        }))
        .reverse();
    }
  }
  const all = await readJson<Record<string, Candle[]>>(candleFile(marketId), {});
  const list = all[timeframe] ?? [];
  return list.slice(Math.max(0, list.length - limit));
}

// ------------------------------------------------------------------- trades --

export interface Trade {
  marketId: string;
  wallet: string;
  side: "long" | "short";
  action: string;
  sizeUsdc: number;
  leverage: number;
  price: number;
  txSignature: string;
  ts: string;
}

export async function recentTrades(marketId: string | null, limit = 40): Promise<Trade[]> {
  const client = db();
  if (client) {
    let q = client.from("trades").select("*").order("ts", { ascending: false }).limit(limit);
    if (marketId) q = q.eq("market_id", marketId);
    return must(await q, "read trades").map((t) => ({
      marketId: t.market_id,
      wallet: t.wallet,
      side: t.side,
      action: t.action,
      sizeUsdc: t.size_usdc,
      leverage: t.leverage,
      price: t.price,
      txSignature: t.tx_signature,
      ts: t.ts,
    }));
  }
  const all = await readLines<Trade>(join(DATA_DIR, "trades.jsonl"));
  const filtered = marketId ? all.filter((t) => t.marketId === marketId) : all;
  return filtered.slice(Math.max(0, filtered.length - limit)).reverse();
}

/** Persist a chain-verified trade, idempotently by transaction signature. */
let tradeWrite = Promise.resolve();

async function recordTradeUnlocked(trade: Trade): Promise<void> {
  const client = db();
  if (client) {
    const { error } = await client.from("trades").upsert(
      {
        market_id: trade.marketId,
        wallet: trade.wallet,
        side: trade.side,
        action: trade.action,
        size_usdc: trade.sizeUsdc,
        leverage: trade.leverage,
        price: trade.price,
        tx_signature: trade.txSignature,
        ts: trade.ts,
      },
      { onConflict: "tx_signature", ignoreDuplicates: true },
    );
    if (error) throw error;
    return;
  }

  const path = join(DATA_DIR, "trades.jsonl");
  const existing = await readLines<Trade>(path);
  if (existing.some((row) => row.txSignature === trade.txSignature)) return;
  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(path, `${JSON.stringify(trade)}\n`, "utf8");
}

export function recordTrade(trade: Trade): Promise<void> {
  const write = () => recordTradeUnlocked(trade);
  tradeWrite = tradeWrite.then(write, write);
  return tradeWrite;
}

// -------------------------------------------------------------- hedges --

/**
 * F9 — the intent behind a hedge.
 *
 * The position itself is an ordinary verified row in `trades`; a hedge adds
 * only what the trade cannot say: how much local currency is being protected
 * and the date it is needed by. `txSignature` links the two and is the
 * idempotency key, so a retried write is a no-op.
 */
export interface Hedge {
  wallet: string;
  marketId: string;
  amountLocal: number;
  amountUsd: number;
  dueDate: string;
  txSignature: string;
  createdAt: string;
}

export async function recentHedges(wallet: string, limit = 40): Promise<Hedge[]> {
  const client = db();
  if (client) {
    return must(
      await client
        .from("hedges")
        .select("*")
        .eq("wallet", wallet)
        .order("created_at", { ascending: false })
        .limit(limit),
      "read hedges",
    ).map((h) => ({
      wallet: h.wallet,
      marketId: h.market_id,
      amountLocal: h.amount_local,
      amountUsd: h.amount_usd,
      dueDate: h.due_date,
      txSignature: h.tx_signature,
      createdAt: h.created_at,
    }));
  }
  const all = await readLines<Hedge>(join(DATA_DIR, "hedges.jsonl"));
  const mine = all.filter((row) => row.wallet === wallet);
  return mine.slice(Math.max(0, mine.length - limit)).reverse();
}

let hedgeWrite = Promise.resolve();

async function recordHedgeUnlocked(hedge: Hedge): Promise<void> {
  const client = db();
  if (client) {
    const { error } = await client.from("hedges").upsert(
      {
        wallet: hedge.wallet,
        market_id: hedge.marketId,
        amount_local: hedge.amountLocal,
        amount_usd: hedge.amountUsd,
        due_date: hedge.dueDate,
        tx_signature: hedge.txSignature,
        created_at: hedge.createdAt,
      },
      { onConflict: "tx_signature", ignoreDuplicates: true },
    );
    if (error) throw error;
    return;
  }

  const path = join(DATA_DIR, "hedges.jsonl");
  const existing = await readLines<Hedge>(path);
  if (existing.some((row) => row.txSignature === hedge.txSignature)) return;
  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(path, `${JSON.stringify(hedge)}\n`, "utf8");
}

/** Serialized like trade writes, so two concurrent retries cannot both append. */
export function recordHedge(hedge: Hedge): Promise<void> {
  const write = () => recordHedgeUnlocked(hedge);
  hedgeWrite = hedgeWrite.then(write, write);
  return hedgeWrite;
}

// -------------------------------------------------------- official history --

export interface OfficialPoint {
  date: string;
  /** Local currency per USD, the same scale the charts and the UI use. */
  rate: number;
}

/**
 * Daily published official rates, for the span of the chart that predates the
 * index. A different quantity from the street median, and labelled as such
 * wherever it is drawn.
 *
 * Read from the **committed bundle**, not from `data/official/`. That
 * directory is gitignored working state, so a deployed instance has none of it
 * and the charts lost their whole pre-launch history — which is most of the
 * chart on any timeframe longer than a day. The bundle is static published
 * reference data, regenerated by `npm run backfill`, so committing it makes a
 * deploy self-contained and makes dev and production show the same history.
 *
 * The default limit covers two years of daily rates; the weekly and monthly
 * candles are aggregated from this, so capping it short silently shortened
 * them.
 */
export async function officialHistory(marketId: string, limit = 1200): Promise<OfficialPoint[]> {
  // TypeScript widens the JSON's `[date, rate]` pairs to `(string|number)[]`,
  // so the shape is asserted once here rather than at every use.
  const bundle = (await import("@/data/official-rates.json")).default as unknown as Record<
    string,
    [string, number][]
  >;
  const rows = bundle[marketId] ?? [];
  return rows
    .slice(Math.max(0, rows.length - limit))
    .map(([date, rate]) => ({ date, rate }));
}
