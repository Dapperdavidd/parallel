/**
 * Street-rate sources, one adapter per venue.
 *
 * Every adapter returns the STREET RATE: units of local currency per 1 USDT.
 * Response shapes below were probed live on 2026-11-20 (see out/probe/) and
 * are transcribed from the real payloads, not from documentation.
 *
 * PRD oracle rule 2: use the mid (average of best bid and best ask) where a
 * venue gives both; for P2P order books use the best offer.
 */

import { fetchJson, mid, num, type FetchOpts } from "./http.js";

export type SourceKind = "exchange" | "p2p";

export interface SourceDef {
  /** Stable id, used in the per-source breakdown and on the public index page. */
  id: string;
  label: string;
  market: string;
  kind: SourceKind;
  url: string;
  /** Raw JSON -> local currency per 1 USDT. */
  parse: (json: unknown) => number;
  note?: string;
}

/* ------------------------------------------------------------------ *
 * Shape helpers. Deliberately defensive: these are public endpoints
 * with no contract, and a shape change must surface as a dead source
 * (which pauses the market) rather than a silently wrong price.
 * ------------------------------------------------------------------ */

const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (typeof v !== "object" || v === null) throw new Error(`${what}: not an object`);
  return v as Record<string, unknown>;
};

const arr = (v: unknown, what: string): unknown[] => {
  if (!Array.isArray(v)) throw new Error(`${what}: not an array`);
  return v;
};

/* ------------------------------------------------------------------ *
 * Venue adapters
 * ------------------------------------------------------------------ */

/** Quidax (Nigeria). {"data":{"ticker":{"buy":"1449.54","sell":"1455.36"}}} */
const quidax = (market: string, pair: string): SourceDef => ({
  id: "quidax", label: "Quidax", market, kind: "exchange",
  url: `https://app.quidax.io/api/v1/markets/tickers/${pair}`,
  parse: (j) => {
    const t = obj(obj(obj(j, "quidax").data, "quidax.data").ticker, "quidax.ticker");
    return mid(t.buy, t.sell, "quidax");
  },
});

/** Luno. {"pair":"USDTNGN","bid":"1450.01","ask":"1450.02","status":"ACTIVE"} */
const luno = (market: string, pair: string): SourceDef => ({
  id: "luno", label: "Luno", market, kind: "exchange",
  url: `https://api.luno.com/api/1/ticker?pair=${pair}`,
  parse: (j) => {
    const t = obj(j, "luno");
    if (t.status !== "ACTIVE") throw new Error(`market status ${String(t.status)}`);
    return mid(t.bid, t.ask, "luno");
  },
});

/** VALR (South Africa). {"bidPrice":"17.5493","askPrice":"17.5494"} */
const valr = (market: string, pair: string): SourceDef => ({
  id: "valr", label: "VALR", market, kind: "exchange",
  url: `https://api.valr.com/v1/public/${pair}/marketsummary`,
  parse: (j) => { const t = obj(j, "valr"); return mid(t.bidPrice, t.askPrice, "valr"); },
});

/** Bitso (Mexico / Colombia). {"payload":{"bid":"19.079","ask":"19.081"}} */
const bitso = (market: string, book: string): SourceDef => ({
  id: "bitso", label: "Bitso", market, kind: "exchange",
  url: `https://api.bitso.com/v3/ticker/?book=${book}`,
  parse: (j) => {
    const p = obj(obj(j, "bitso").payload, "bitso.payload");
    return mid(p.bid, p.ask, "bitso");
  },
});

/** BtcTurk. {"data":[{"bid":50.437,"ask":50.438}]} */
const btcturk = (market: string, pair: string): SourceDef => ({
  id: "btcturk", label: "BtcTurk", market, kind: "exchange",
  url: `https://api.btcturk.com/api/v2/ticker?pairSymbol=${pair}`,
  parse: (j) => {
    const rows = arr(obj(j, "btcturk").data, "btcturk.data");
    const t = obj(rows[0], "btcturk.data[0]");
    return mid(t.bid, t.ask, "btcturk");
  },
});

/** WazirX (India). {"bidPrice":"103.41","askPrice":"103.98"} */
const wazirx = (market: string, symbol: string): SourceDef => ({
  id: "wazirx", label: "WazirX", market, kind: "exchange",
  url: `https://api.wazirx.com/sapi/v1/ticker/24hr?symbol=${symbol}`,
  parse: (j) => { const t = obj(j, "wazirx"); return mid(t.bidPrice, t.askPrice, "wazirx"); },
});

/** Coins.ph (Philippines). {"bidPrice":"63.76","askPrice":"63.77"} */
const coinsph = (market: string, symbol: string): SourceDef => ({
  id: "coinsph", label: "Coins.ph", market, kind: "exchange",
  url: `https://api.pro.coins.ph/openapi/quote/v1/ticker/bookTicker?symbol=${symbol}`,
  parse: (j) => { const t = obj(j, "coinsph"); return mid(t.bidPrice, t.askPrice, "coinsph"); },
});

/** CriptoYa (Argentina). Uses the USDT leg of the crypto dollar, not the blue. */
const criptoya = (market: string): SourceDef => ({
  id: "criptoya", label: "CriptoYa (USDT)", market, kind: "exchange",
  url: "https://criptoya.com/api/dolar",
  note: "cripto.usdt leg; the blue rate is shown for context only",
  parse: (j) => {
    const u = obj(obj(obj(j, "criptoya").cripto, "criptoya.cripto").usdt, "criptoya.cripto.usdt");
    return mid(u.bid, u.ask, "criptoya");
  },
});

/** Binance spot via the public data mirror. {"bidPrice":"5.98330000","askPrice":"5.98340000"} */
const binanceSpot = (market: string, symbol: string): SourceDef => ({
  id: "binance_spot", label: "Binance spot", market, kind: "exchange",
  url: `https://data-api.binance.vision/api/v3/ticker/bookTicker?symbol=${symbol}`,
  parse: (j) => { const t = obj(j, "binance_spot"); return mid(t.bidPrice, t.askPrice, "binance_spot"); },
});

/**
 * Binance P2P quote price. {"data":{"fiat":"KES","price":130.68}}
 * Returns a single indicative BUY quote rather than a book, so there is no
 * mid to take. `data` is null for fiats Binance does not serve (e.g. NGN).
 */
const binanceP2P = (market: string, fiat: string): SourceDef => ({
  id: "binance_p2p", label: "Binance P2P", market, kind: "p2p",
  url: `https://www.binance.com/bapi/c2c/v1/public/c2c/agent/quote-price?fiat=${fiat}&asset=USDT&tradeType=BUY`,
  note: "indicative BUY quote, not an order book",
  parse: (j) => {
    const d = obj(j, "binance_p2p").data;
    if (d === null || d === undefined) throw new Error(`no P2P market for ${fiat}`);
    return num(obj(d, "binance_p2p.data").price, "binance_p2p.price");
  },
});

/**
 * OKX P2P order book. {"data":{"sell":[{"price":"1450.00"},…]}}
 * Ads come back ascending, so sell[0] is the best offer (PRD rule 2).
 */
const okxP2P = (market: string, fiat: string): SourceDef => ({
  id: "okx_p2p", label: "OKX P2P", market, kind: "p2p",
  url:
    `https://www.okx.com/v3/c2c/tradingOrders/books?quoteCurrency=${fiat}` +
    `&baseCurrency=USDT&side=sell&paymentMethod=all&userType=all`,
  note: "best sell offer from the public C2C book",
  parse: (j) => {
    const sell = arr(obj(obj(j, "okx_p2p").data, "okx_p2p.data").sell, "okx_p2p.sell");
    if (sell.length === 0) throw new Error("empty P2P book");
    const best = Math.min(
      ...sell.slice(0, 10).map((a) => num(obj(a, "okx_p2p ad").price, "okx_p2p.price")),
    );
    return best;
  },
});

/* ------------------------------------------------------------------ *
 * Per-market source table
 *
 * Deviations from the PRD's table, both forced by live probing on
 * 2026-11-20 and both replaced to keep the 2-source minimum:
 *   - USD/BRL: Mercado Bitcoin returns HTTP 403 (Cloudflare) -> Binance P2P
 *   - USD/INR: CoinDCX returns HTTP 403                      -> Binance P2P
 * ------------------------------------------------------------------ */

export const SOURCES: readonly SourceDef[] = [
  quidax("USD/NGN", "usdtngn"), luno("USD/NGN", "USDTNGN"), okxP2P("USD/NGN", "NGN"),

  valr("USD/ZAR", "USDTZAR"), luno("USD/ZAR", "USDTZAR"), binanceSpot("USD/ZAR", "USDTZAR"),

  criptoya("USD/ARS"), binanceSpot("USD/ARS", "USDTARS"), binanceP2P("USD/ARS", "ARS"),

  binanceSpot("USD/BRL", "USDTBRL"), binanceP2P("USD/BRL", "BRL"),

  bitso("USD/MXN", "usdt_mxn"), binanceSpot("USD/MXN", "USDTMXN"), binanceP2P("USD/MXN", "MXN"),

  bitso("USD/COP", "usdt_cop"), binanceSpot("USD/COP", "USDTCOP"), binanceP2P("USD/COP", "COP"),

  btcturk("USD/TRY", "USDTTRY"), binanceSpot("USD/TRY", "USDTTRY"), binanceP2P("USD/TRY", "TRY"),

  wazirx("USD/INR", "usdtinr"), binanceP2P("USD/INR", "INR"),

  coinsph("USD/PHP", "USDTPHP"), binanceP2P("USD/PHP", "PHP"),

  binanceP2P("USD/KES", "KES"), okxP2P("USD/KES", "KES"),
  binanceP2P("USD/GHS", "GHS"), okxP2P("USD/GHS", "GHS"),
  binanceP2P("USD/EGP", "EGP"), okxP2P("USD/EGP", "EGP"),
  binanceP2P("USD/PKR", "PKR"), okxP2P("USD/PKR", "PKR"),
];

export function sourcesFor(market: string): SourceDef[] {
  return SOURCES.filter((s) => s.market === market);
}

export interface SourceReading {
  id: string;
  label: string;
  kind: SourceKind;
  ok: boolean;
  /** Street rate, local currency per 1 USDT. Present when ok. */
  rate?: number;
  error?: string;
  ms: number;
}

/**
 * A venue either answers quickly or is being filtered, so the read budget is
 * deliberately short.
 *
 * The default elsewhere is 12s, which was costing a whole pass ~40s on a
 * network that blocks most venues at TCP connect: the time is spent waiting on
 * hosts that will never answer. Six seconds is far more than any reachable
 * venue needs — the ones that work here answer in well under a second — and it
 * lets the shorter breaker cooldown retry often without the pass getting long.
 * See DECISIONS.md §7.18.
 */
const SOURCE_TIMEOUT_MS = 6_000;

export async function readSource(s: SourceDef, opts?: FetchOpts): Promise<SourceReading> {
  const t0 = Date.now();
  opts = { timeoutMs: SOURCE_TIMEOUT_MS, ...opts };
  const base = { id: s.id, label: s.label, kind: s.kind };
  try {
    const rate = s.parse(await fetchJson(s.url, opts));
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`bad rate ${rate}`);
    return { ...base, ok: true, rate, ms: Date.now() - t0 };
  } catch (err) {
    return { ...base, ok: false, error: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 };
  }
}

/* ------------------------------------------------------------------ *
 * Official rate: daily sanity check only, never part of the median.
 * ------------------------------------------------------------------ */

const OFFICIAL_URL =
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json";

export interface OfficialRates {
  date: string;
  /** Lowercase ISO code -> units per 1 USD. */
  rates: Record<string, number>;
}

export async function fetchOfficialRates(): Promise<OfficialRates> {
  const j = obj(await fetchJson(OFFICIAL_URL, { timeoutMs: 15_000 }), "official");
  const usd = obj(j.usd, "official.usd");
  const rates: Record<string, number> = {};
  for (const [k, v] of Object.entries(usd)) if (typeof v === "number") rates[k] = v;
  return { date: String(j.date ?? "unknown"), rates };
}
