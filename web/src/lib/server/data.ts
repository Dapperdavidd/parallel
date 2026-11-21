import "server-only";

import { readFile } from "node:fs/promises";
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

function db(): SupabaseClient | null {
  if (supabase !== undefined) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return supabase;
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
  const client = db();
  if (client) {
    const { data } = await client.from("markets").select("*").order("id");
    if (data && data.length > 0) {
      return data.map((m) => ({
        id: m.id,
        currency: m.currency,
        unit: m.unit,
        unitLabel: m.unit_label,
        status: m.status,
        maxLeverage: m.max_leverage,
        market: m.slab_pubkey ?? "",
        vault: m.vault_pubkey ?? "",
        assetIndex: 0,
      }));
    }
  }

  const reg = await readJson<{ markets: MarketInfo[] }>(REGISTRY, { markets: [] });
  return reg.markets;
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
    const { data } = await q;
    if (data) {
      return data.map((t) => ({
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
  }
  const all = await readLines<Trade>(join(DATA_DIR, "trades.jsonl"));
  const filtered = marketId ? all.filter((t) => t.marketId === marketId) : all;
  return filtered.slice(Math.max(0, filtered.length - limit)).reverse();
}

// -------------------------------------------------------- official history --

export interface OfficialPoint {
  date: string;
  rate: number;
  unitPriceUsd: number;
}

/**
 * Daily published official rates, for the span of the chart that predates the
 * index. A different quantity from the street median, and labelled as such
 * wherever it is drawn.
 */
export async function officialHistory(marketId: string, limit = 400): Promise<OfficialPoint[]> {
  const all = await readJson<OfficialPoint[]>(officialFile(marketId), []);
  return all.slice(Math.max(0, all.length - limit));
}
