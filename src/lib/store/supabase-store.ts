/**
 * A Store backed by Supabase (the PRD's choice).
 *
 * Uses the service-role key, so it bypasses row-level security and can write.
 * It is therefore server-only: never let this key reach the browser.
 *
 * Column names are snake_case in SQL and camelCase in TypeScript; the mapping
 * is done here and nowhere else.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  TIMEFRAME_MINUTES,
  type Candle,
  type LastPush,
  type MarketRow,
  type Store,
  type StoredTick,
  type Timeframe,
  type TradeRow,
} from "./types.js";

interface TickRow {
  market_id: string;
  ts: string;
  median: number | null;
  unit_price_usd: number | null;
  official: number | null;
  premium: number | null;
  status: string;
  reason: string | null;
  sources_used: string[];
  breakdown: unknown;
  pushed_tx: string | null;
  pushed_slot: number | null;
}

const toTick = (r: TickRow): StoredTick =>
  ({
    market: r.market_id,
    ts: r.ts,
    median: r.median,
    unitPriceUsd: r.unit_price_usd,
    official: r.official,
    premiumPct: r.premium,
    status: r.status,
    reason: r.reason ?? undefined,
    sourcesUsed: r.sources_used ?? [],
    dropped: [],
    failed: [],
    breakdown: (r.breakdown ?? []) as StoredTick["breakdown"],
    pushedTx: r.pushed_tx,
    pushedSlot: r.pushed_slot,
  }) as StoredTick;

const fromTick = (t: StoredTick): TickRow => ({
  market_id: t.market,
  ts: t.ts,
  median: t.median,
  unit_price_usd: t.unitPriceUsd,
  official: t.official,
  premium: t.premiumPct,
  status: t.status,
  reason: t.reason ?? null,
  sources_used: t.sourcesUsed,
  // The breakdown carries the dropped and failed sources too, so the public
  // index page can show exactly what happened without three more columns.
  breakdown: { readings: t.breakdown, dropped: t.dropped, failed: t.failed },
  pushed_tx: t.pushedTx,
  pushed_slot: t.pushedSlot,
});

export class SupabaseStore implements Store {
  readonly name = "supabase";
  private readonly db: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** Build one from the environment, or null when it is not configured. */
  static fromEnv(): SupabaseStore | null {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    return new SupabaseStore(url, key);
  }

  private check(error: { message: string } | null, what: string): void {
    if (error) throw new Error(`supabase ${what}: ${error.message}`);
  }

  // ------------------------------------------------------------- markets --
  async upsertMarkets(rows: MarketRow[]): Promise<void> {
    const { error } = await this.db.from("markets").upsert(
      rows.map((m) => ({
        id: m.id,
        currency: m.currency,
        symbol: m.symbol,
        unit: m.unit,
        unit_label: m.unitLabel,
        status: m.status,
        region: m.region,
        max_leverage: m.maxLeverage,
        // Addresses belong to the creation script; a registry sync must not
        // blank them, so they are only sent when present.
        ...(m.slabPubkey ? { slab_pubkey: m.slabPubkey } : {}),
        ...(m.vaultPubkey ? { vault_pubkey: m.vaultPubkey } : {}),
      })),
      { onConflict: "id" },
    );
    this.check(error, "upsertMarkets");
  }

  async markets(): Promise<MarketRow[]> {
    const { data, error } = await this.db.from("markets").select("*").order("id");
    this.check(error, "markets");
    return (data ?? []).map((m) => ({
      id: m.id,
      currency: m.currency,
      symbol: m.symbol,
      unit: m.unit,
      unitLabel: m.unit_label,
      status: m.status,
      region: m.region,
      maxLeverage: m.max_leverage,
      slabPubkey: m.slab_pubkey,
      vaultPubkey: m.vault_pubkey,
    }));
  }

  async setMarketAddresses(id: string, slab: string, vault: string): Promise<void> {
    const { error } = await this.db
      .from("markets")
      .update({ slab_pubkey: slab, vault_pubkey: vault })
      .eq("id", id);
    this.check(error, "setMarketAddresses");
  }

  // --------------------------------------------------------------- ticks --
  async saveTicks(ticks: StoredTick[]): Promise<void> {
    if (ticks.length === 0) return;
    const { error } = await this.db
      .from("index_ticks")
      .upsert(ticks.map(fromTick), { onConflict: "market_id,ts" });
    this.check(error, "saveTicks");
  }

  async latestTick(marketId: string): Promise<StoredTick | null> {
    const { data, error } = await this.db
      .from("index_ticks")
      .select("*")
      .eq("market_id", marketId)
      .order("ts", { ascending: false })
      .limit(1);
    this.check(error, "latestTick");
    return data && data.length > 0 ? toTick(data[0] as TickRow) : null;
  }

  async recentTicks(marketId: string, limit: number): Promise<StoredTick[]> {
    const { data, error } = await this.db
      .from("index_ticks")
      .select("*")
      .eq("market_id", marketId)
      .order("ts", { ascending: false })
      .limit(limit);
    this.check(error, "recentTicks");
    return (data ?? []).map((r) => toTick(r as TickRow)).reverse();
  }

  async lastPush(marketId: string): Promise<LastPush | null> {
    const { data, error } = await this.db
      .from("index_ticks")
      .select("ts, unit_price_usd")
      .eq("market_id", marketId)
      .not("pushed_tx", "is", null)
      .order("ts", { ascending: false })
      .limit(1);
    this.check(error, "lastPush");
    const row = data?.[0];
    if (!row || row.unit_price_usd === null) return null;
    return { unitPriceUsd: row.unit_price_usd, at: new Date(row.ts).getTime() };
  }

  async markPushed(marketId: string, ts: string, tx: string, slot: number): Promise<void> {
    const { error } = await this.db
      .from("index_ticks")
      .update({ pushed_tx: tx, pushed_slot: slot })
      .eq("market_id", marketId)
      .eq("ts", ts);
    this.check(error, "markPushed");
  }

  // ------------------------------------------------------------- candles --
  async rollCandles(marketId: string, timeframe: Timeframe): Promise<number> {
    // Roll from the ticks we have rather than from scratch each time: pull the
    // window the timeframe can cover, bucket it, and upsert.
    const minutes = TIMEFRAME_MINUTES[timeframe];
    const since = new Date(Date.now() - minutes * 60_000 * 240).toISOString();
    const { data, error } = await this.db
      .from("index_ticks")
      .select("ts, unit_price_usd")
      .eq("market_id", marketId)
      .gte("ts", since)
      .not("unit_price_usd", "is", null)
      .order("ts");
    this.check(error, "rollCandles read");

    const buckets = new Map<string, Candle>();
    for (const r of data ?? []) {
      const price = r.unit_price_usd as number;
      const openTs = new Date(
        Math.floor(new Date(r.ts).getTime() / (minutes * 60_000)) * minutes * 60_000,
      ).toISOString();
      const c = buckets.get(openTs);
      if (!c) {
        buckets.set(openTs, {
          marketId, timeframe, openTs,
          open: price, high: price, low: price, close: price, ticks: 1,
        });
      } else {
        c.high = Math.max(c.high, price);
        c.low = Math.min(c.low, price);
        c.close = price;
        c.ticks += 1;
      }
    }

    const rows = [...buckets.values()];
    if (rows.length > 0) {
      const { error: upErr } = await this.db.from("candles").upsert(
        rows.map((c) => ({
          market_id: c.marketId,
          timeframe: c.timeframe,
          open_ts: c.openTs,
          open: c.open, high: c.high, low: c.low, close: c.close,
          ticks: c.ticks,
        })),
        { onConflict: "market_id,timeframe,open_ts" },
      );
      this.check(upErr, "rollCandles write");
    }
    return rows.length;
  }

  async candles(marketId: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const { data, error } = await this.db
      .from("candles")
      .select("*")
      .eq("market_id", marketId)
      .eq("timeframe", timeframe)
      .order("open_ts", { ascending: false })
      .limit(limit);
    this.check(error, "candles");
    return (data ?? [])
      .map((c) => ({
        marketId: c.market_id,
        timeframe: c.timeframe as Timeframe,
        openTs: c.open_ts,
        open: c.open, high: c.high, low: c.low, close: c.close,
        ticks: c.ticks,
      }))
      .reverse();
  }

  // -------------------------------------------------------------- trades --
  async recordTrade(trade: TradeRow): Promise<void> {
    const { error } = await this.db.from("trades").upsert(
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
      { onConflict: "tx_signature" },
    );
    this.check(error, "recordTrade");
  }

  async recentTrades(marketId: string | null, limit: number): Promise<TradeRow[]> {
    let q = this.db.from("trades").select("*").order("ts", { ascending: false }).limit(limit);
    if (marketId) q = q.eq("market_id", marketId);
    const { data, error } = await q;
    this.check(error, "recentTrades");
    return (data ?? []).map((t) => ({
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

  async close(): Promise<void> {
    /* the client holds no pool */
  }
}
