/**
 * What Parallel stores, and the one interface everything reads it through.
 *
 * The PRD puts this in Supabase. The interface exists so the index service,
 * the keeper and the web app never import a database client directly — they
 * ask the store. That is what lets the whole pipeline run on a local JSON
 * driver before Supabase credentials exist, and switch over by setting two
 * environment variables rather than by editing call sites.
 *
 * On-chain state stays the source of truth for positions, balances and
 * liquidations. Everything here is cache and history.
 */

import type { IndexTick } from "../index-math.js";

export type Timeframe = "1H" | "4H" | "1D" | "1W" | "1M";

export const TIMEFRAMES: readonly Timeframe[] = ["1H", "4H", "1D", "1W", "1M"];

/** Minutes per candle, used to bucket ticks. */
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  "1H": 60,
  "4H": 4 * 60,
  "1D": 24 * 60,
  "1W": 7 * 24 * 60,
  "1M": 30 * 24 * 60,
};

export interface MarketRow {
  id: string;
  currency: string;
  symbol: string;
  unit: number;
  unitLabel: string;
  status: "live" | "beta" | "paused" | "stretch";
  region: string;
  maxLeverage: number;
  /** Percolator market account, once the market exists on devnet. */
  slabPubkey: string | null;
  /** Collateral vault ATA. */
  vaultPubkey: string | null;
}

/** An index tick as stored: the computed tick plus what happened on-chain. */
export interface StoredTick extends IndexTick {
  pushedTx: string | null;
  pushedSlot: number | null;
}

export interface Candle {
  marketId: string;
  timeframe: Timeframe;
  openTs: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ticks: number;
}

export interface TradeRow {
  marketId: string;
  wallet: string;
  side: "long" | "short";
  action: "open" | "close" | "liquidation";
  sizeUsdc: number;
  leverage: number;
  price: number;
  txSignature: string;
  ts: string;
}

/** What the keeper needs to apply the PRD's push rule. */
export interface LastPush {
  unitPriceUsd: number;
  at: number;
}

export interface Store {
  readonly name: string;

  /** Create the market registry if it is missing, update it if it is not. */
  upsertMarkets(rows: MarketRow[]): Promise<void>;
  markets(): Promise<MarketRow[]>;
  setMarketAddresses(id: string, slab: string, vault: string): Promise<void>;

  /** Idempotent on (market, ts): re-running the service cannot duplicate history. */
  saveTicks(ticks: StoredTick[]): Promise<void>;
  latestTick(marketId: string): Promise<StoredTick | null>;
  recentTicks(marketId: string, limit: number): Promise<StoredTick[]>;

  /** The last tick that actually went on-chain, for the >0.1%-or-10-minutes rule. */
  lastPush(marketId: string): Promise<LastPush | null>;
  markPushed(marketId: string, ts: string, tx: string, slot: number): Promise<void>;

  rollCandles(marketId: string, timeframe: Timeframe): Promise<number>;
  candles(marketId: string, timeframe: Timeframe, limit: number): Promise<Candle[]>;

  recordTrade(trade: TradeRow): Promise<void>;
  recentTrades(marketId: string | null, limit: number): Promise<TradeRow[]>;

  close(): Promise<void>;
}
