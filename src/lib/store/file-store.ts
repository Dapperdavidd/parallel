/**
 * A Store backed by JSON files under `data/`.
 *
 * This is not a toy: it is what lets the index service, the keeper and the web
 * app run end to end before Supabase credentials exist, and it is a useful
 * offline mode afterwards. It keeps the same idempotency guarantees as the SQL
 * schema — ticks are unique on (market, ts), candles on (market, timeframe,
 * open) — so switching drivers cannot change behaviour.
 *
 * Writes are append-only line-delimited JSON, which survives a process dying
 * mid-write far better than rewriting one big array each tick.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
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

const readJson = <T>(path: string, fallback: T): T => {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
};

/** Write through a temp file so a crash cannot leave a half-written document. */
const writeJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
};

const readLines = <T>(path: string): T[] => {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      try {
        return JSON.parse(l) as T;
      } catch {
        return null;
      }
    })
    .filter((v): v is T => v !== null);
};

const appendLines = (path: string, rows: unknown[]): void => {
  if (rows.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
};

/** Floor a timestamp to the start of its candle bucket. */
export function bucketStart(ts: string, timeframe: Timeframe): string {
  const minutes = TIMEFRAME_MINUTES[timeframe];
  const ms = new Date(ts).getTime();
  return new Date(Math.floor(ms / (minutes * 60_000)) * minutes * 60_000).toISOString();
}

export class FileStore implements Store {
  readonly name: string;
  private readonly root: string;

  constructor(root = "data") {
    this.root = root;
    this.name = `file(${root})`;
    mkdirSync(root, { recursive: true });
  }

  private marketsPath = (): string => join(this.root, "markets.json");
  private ticksPath = (id: string): string =>
    join(this.root, "ticks", `${id.replace("/", "-")}.jsonl`);
  private candlesPath = (id: string): string =>
    join(this.root, "candles", `${id.replace("/", "-")}.json`);
  private tradesPath = (): string => join(this.root, "trades.jsonl");

  // ------------------------------------------------------------- markets --
  async upsertMarkets(rows: MarketRow[]): Promise<void> {
    const existing = readJson<MarketRow[]>(this.marketsPath(), []);
    const byId = new Map(existing.map((m) => [m.id, m]));
    for (const row of rows) {
      const prev = byId.get(row.id);
      // Addresses are written by the market-creation script, not by the
      // registry sync; never let a sync blank them.
      byId.set(row.id, {
        ...row,
        slabPubkey: row.slabPubkey ?? prev?.slabPubkey ?? null,
        vaultPubkey: row.vaultPubkey ?? prev?.vaultPubkey ?? null,
      });
    }
    writeJson(this.marketsPath(), [...byId.values()]);
  }

  async markets(): Promise<MarketRow[]> {
    return readJson<MarketRow[]>(this.marketsPath(), []);
  }

  async setMarketAddresses(id: string, slab: string, vault: string): Promise<void> {
    const rows = readJson<MarketRow[]>(this.marketsPath(), []);
    const row = rows.find((m) => m.id === id);
    if (!row) throw new Error(`unknown market ${id}`);
    row.slabPubkey = slab;
    row.vaultPubkey = vault;
    writeJson(this.marketsPath(), rows);
  }

  // --------------------------------------------------------------- ticks --
  async saveTicks(ticks: StoredTick[]): Promise<void> {
    const byMarket = new Map<string, StoredTick[]>();
    for (const t of ticks) {
      const list = byMarket.get(t.market) ?? [];
      list.push(t);
      byMarket.set(t.market, list);
    }
    for (const [marketId, list] of byMarket) {
      const path = this.ticksPath(marketId);
      // Unique on (market, ts), same as the SQL index.
      const seen = new Set(readLines<StoredTick>(path).map((t) => t.ts));
      appendLines(
        path,
        list.filter((t) => !seen.has(t.ts)),
      );
    }
  }

  async latestTick(marketId: string): Promise<StoredTick | null> {
    const all = readLines<StoredTick>(this.ticksPath(marketId));
    return all.length === 0 ? null : all[all.length - 1]!;
  }

  async recentTicks(marketId: string, limit: number): Promise<StoredTick[]> {
    const all = readLines<StoredTick>(this.ticksPath(marketId));
    return all.slice(Math.max(0, all.length - limit));
  }

  async lastPush(marketId: string): Promise<LastPush | null> {
    const all = readLines<StoredTick>(this.ticksPath(marketId));
    for (let i = all.length - 1; i >= 0; i--) {
      const t = all[i]!;
      if (t.pushedTx && t.unitPriceUsd !== null) {
        return { unitPriceUsd: t.unitPriceUsd, at: new Date(t.ts).getTime() };
      }
    }
    return null;
  }

  async markPushed(marketId: string, ts: string, tx: string, slot: number): Promise<void> {
    const path = this.ticksPath(marketId);
    const all = readLines<StoredTick>(path);
    const row = all.find((t) => t.ts === ts);
    if (!row) throw new Error(`no tick at ${ts} for ${marketId}`);
    row.pushedTx = tx;
    row.pushedSlot = slot;
    // Rewriting the log is acceptable here: a push happens at most every two
    // minutes, and the file holds one market.
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, all.map((t) => `${JSON.stringify(t)}\n`).join(""));
    renameSync(tmp, path);
  }

  // ------------------------------------------------------------- candles --
  async rollCandles(marketId: string, timeframe: Timeframe): Promise<number> {
    const ticks = readLines<StoredTick>(this.ticksPath(marketId)).filter(
      (t): t is StoredTick & { unitPriceUsd: number } => t.unitPriceUsd !== null,
    );
    const buckets = new Map<string, Candle>();
    for (const t of ticks) {
      const openTs = bucketStart(t.ts, timeframe);
      const c = buckets.get(openTs);
      if (!c) {
        buckets.set(openTs, {
          marketId,
          timeframe,
          openTs,
          open: t.unitPriceUsd,
          high: t.unitPriceUsd,
          low: t.unitPriceUsd,
          close: t.unitPriceUsd,
          ticks: 1,
        });
      } else {
        c.high = Math.max(c.high, t.unitPriceUsd);
        c.low = Math.min(c.low, t.unitPriceUsd);
        c.close = t.unitPriceUsd;
        c.ticks += 1;
      }
    }

    const path = this.candlesPath(marketId);
    const all = readJson<Record<string, Candle[]>>(path, {});
    all[timeframe] = [...buckets.values()].sort((a, b) => a.openTs.localeCompare(b.openTs));
    writeJson(path, all);
    return all[timeframe]!.length;
  }

  async candles(marketId: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const all = readJson<Record<string, Candle[]>>(this.candlesPath(marketId), {});
    const list = all[timeframe] ?? [];
    return list.slice(Math.max(0, list.length - limit));
  }

  // -------------------------------------------------------------- trades --
  async recordTrade(trade: TradeRow): Promise<void> {
    const path = this.tradesPath();
    const seen = new Set(readLines<TradeRow>(path).map((t) => t.txSignature));
    if (seen.has(trade.txSignature)) return;
    appendLines(path, [trade]);
  }

  async recentTrades(marketId: string | null, limit: number): Promise<TradeRow[]> {
    const all = readLines<TradeRow>(this.tradesPath()).filter(
      (t) => marketId === null || t.marketId === marketId,
    );
    return all.slice(Math.max(0, all.length - limit)).reverse();
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
