/**
 * THE ONE MOCK FILE.
 *
 * PRD rule: "Phase 2 sample data lives in one mock file, so phase 3 can swap it
 * for real data without redesigning screens." Every number any screen shows
 * comes from here. If you are adding sample data, add it here, not in a
 * component.
 *
 * The shapes deliberately mirror what the real services already produce, so
 * Phase 3 is a swap rather than a rewrite:
 *   - `Market` mirrors `src/lib/markets.ts` plus the live index fields
 *   - `src` holds the sources that ACTUALLY answered in spike 5
 *   - prices are the real medians measured on 2026-11-20
 *
 * Deviations from the design hand-off prototype, all deliberate:
 *   - The prototype listed CoinDCX (INR), Mercado Bitcoin (BRL) and Lemon (ARS).
 *     Spike 5 found the first two hard-blocked behind HTTP 403 and we never used
 *     the third. Showing dead sources in the UI would be a lie we would have to
 *     unpick in Phase 3, so the real ones are listed instead.
 *   - Prices are the measured medians rather than the prototype's placeholders.
 */

export type MarketStatus = "Live" | "Beta";

export interface Market {
  /** ISO code, e.g. "NGN". */
  c: string;
  /** Currency symbol for the badge. */
  sym: string;
  name: string;
  /** Street median: local currency per 1 USD. */
  px: number;
  /** Official rate, for the gap. */
  off: number;
  /** Max leverage. Fixed on-chain at market creation — see PHASE-1-REPORT.md. */
  lev: number;
  st: MarketStatus;
  reg: string;
  /** Decimal places for display. */
  dp: number;
  /** Sources in the median. These are the ones that actually answer. */
  src: string[];
  /** How many units of local currency make one tradable contract. */
  unitSize: number;
  unitLabel: string;
}

/** Measured live on 2026-11-20 by `npm run spike5`. */
export const MARKETS: Market[] = [
  { c: "NGN", sym: "₦",   name: "Nigerian naira",      px: 1437.50, off: 1350.33, lev: 5, st: "Live", reg: "Africa",        dp: 2, src: ["Quidax", "Luno", "OKX P2P"],              unitSize: 1000, unitLabel: "kNGN" },
  { c: "ARS", sym: "$",   name: "Argentine peso",      px: 1742.19, off: 1559.24, lev: 5, st: "Live", reg: "Latin America", dp: 2, src: ["CriptoYa", "Binance spot", "Binance P2P"], unitSize: 1000, unitLabel: "kARS" },
  { c: "INR", sym: "₹",   name: "Indian rupee",        px:  103.08, off:   93.32, lev: 5, st: "Live", reg: "Asia",          dp: 2, src: ["WazirX", "Binance P2P"],                   unitSize: 100,  unitLabel: "100INR" },
  { c: "TRY", sym: "₺",   name: "Turkish lira",        px:   50.47, off:   50.46, lev: 5, st: "Live", reg: "Europe/Asia",   dp: 3, src: ["BtcTurk", "Binance spot", "Binance P2P"],  unitSize: 10,   unitLabel: "10TRY" },
  { c: "ZAR", sym: "R",   name: "South African rand",  px:   17.50, off:   17.29, lev: 5, st: "Live", reg: "Africa",        dp: 3, src: ["VALR", "Luno", "Binance spot"],            unitSize: 10,   unitLabel: "10ZAR" },
  { c: "BRL", sym: "R$",  name: "Brazilian real",      px:    6.00, off:    5.88, lev: 5, st: "Live", reg: "Latin America", dp: 4, src: ["Binance spot", "Binance P2P"],            unitSize: 1,    unitLabel: "BRL" },
  { c: "MXN", sym: "$",   name: "Mexican peso",        px:   19.02, off:   18.90, lev: 5, st: "Live", reg: "Latin America", dp: 3, src: ["Bitso", "Binance spot", "Binance P2P"],    unitSize: 10,   unitLabel: "10MXN" },
  { c: "COP", sym: "$",   name: "Colombian peso",      px: 3410.85, off: 3354.79, lev: 5, st: "Live", reg: "Latin America", dp: 1, src: ["Bitso", "Binance spot", "Binance P2P"],    unitSize: 1000, unitLabel: "kCOP" },
  { c: "PHP", sym: "₱",   name: "Philippine peso",     px:   63.88, off:   63.69, lev: 5, st: "Live", reg: "Asia",          dp: 3, src: ["Coins.ph", "Binance P2P"],                 unitSize: 100,  unitLabel: "100PHP" },
  { c: "GHS", sym: "₵",   name: "Ghanaian cedi",       px:   12.35, off:   11.74, lev: 2, st: "Beta", reg: "Africa",        dp: 3, src: ["Binance P2P", "OKX P2P"],                  unitSize: 10,   unitLabel: "10GHS" },
  { c: "PKR", sym: "₨",   name: "Pakistani rupee",     px:  286.05, off:  276.39, lev: 2, st: "Beta", reg: "Asia",          dp: 2, src: ["Binance P2P", "OKX P2P"],                  unitSize: 100,  unitLabel: "100PKR" },
  { c: "EGP", sym: "E£",  name: "Egyptian pound",      px:   55.15, off:   53.83, lev: 2, st: "Beta", reg: "Africa",        dp: 3, src: ["Binance P2P", "OKX P2P"],                  unitSize: 100,  unitLabel: "100EGP" },
  { c: "KES", sym: "KSh", name: "Kenyan shilling",     px:  130.64, off:  130.00, lev: 2, st: "Beta", reg: "Africa",        dp: 2, src: ["Binance P2P", "OKX P2P"],                  unitSize: 100,  unitLabel: "100KES" },
];

/** Shown in the landing table — a representative slice, not all 13. */
export const LANDING_ROWS = ["NGN", "ARS", "INR", "TRY", "GHS", "PKR", "EGP", "KES"];

export const byCode = (c: string): Market =>
  MARKETS.find((m) => m.c === c) ?? MARKETS[0]!;

/** Street premium over the official rate, in percent. */
export const premium = (m: Market): number => (m.px / m.off - 1) * 100;

/** USD price of one tradable contract. */
export const unitPriceUsd = (m: Market): number => m.unitSize / m.px;

export const fmt = (n: number, d = 2): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/* ------------------------------------------------------------------ *
 * Candles
 *
 * Deterministic from the market code, so a screenshot taken today matches one
 * taken tomorrow and reviews are comparable. Phase 3 replaces this with the
 * `candles` table built from `index_ticks`.
 * ------------------------------------------------------------------ */

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export function candlesFor(m: Market, count = 120, stepSec = 3600): Candle[] {
  let seed = m.c.charCodeAt(0) * 31 + m.c.charCodeAt(1) * 7 + m.c.charCodeAt(2);
  const rnd = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const out: Candle[] = [];
  // Start a little below today's price and drift up to it, so the last candle
  // closes exactly at the market's quoted street price.
  let p = m.px * (1 - 0.035);
  const now = Math.floor(Date.now() / 1000 / stepSec) * stepSec;

  for (let i = 0; i < count; i++) {
    const open = p;
    const close = open * (1 + (rnd() - 0.46) * 0.006);
    out.push({
      time: now - (count - 1 - i) * stepSec,
      open,
      close,
      high: Math.max(open, close) * (1 + rnd() * 0.002),
      low: Math.min(open, close) * (1 - rnd() * 0.002),
    });
    p = close;
  }

  // Rescale so the series ends on the real quoted price.
  const k = m.px / p;
  for (const c of out) {
    c.open *= k; c.close *= k; c.high *= k; c.low *= k;
  }
  return out;
}

/** The official rate line drawn under the candles (PRD F6 overlay). */
export const officialSeries = (m: Market, candles: Candle[]) =>
  candles.map((c) => ({ time: c.time, value: m.off }));

/* ------------------------------------------------------------------ *
 * Account, positions
 * ------------------------------------------------------------------ */

export interface Position {
  id: number;
  c: string;
  side: "long" | "short";
  /** Margin committed, in tUSDC. */
  size: number;
  lev: number;
  entry: number;
}

export const STARTING_BALANCE = 10_000;
export const DEMO_WALLET = "7xKp…9fQ2";

/** Unrealised PnL for a position at the market's current price. */
export function positionPnl(p: Position): number {
  const m = byCode(p.c);
  const move = (m.px / p.entry - 1) * (p.side === "long" ? 1 : -1);
  return p.size * p.lev * move;
}

/** Liquidation price estimate shown before confirming (PRD F5). */
export function liquidationPrice(m: Market, side: "long" | "short", lev: number): number {
  // Maintenance margin is 10% of notional on our markets, so the position is
  // liquidated once the move eats (1/lev − 0.10) of it. See PHASE-1-REPORT.md.
  const room = Math.max(0.02, 1 / lev - 0.1);
  return side === "long" ? m.px * (1 - room) : m.px * (1 + room);
}

export const TRADING_FEE_BPS = 6; // 0.06%

/* ------------------------------------------------------------------ *
 * Index page / source panel
 * ------------------------------------------------------------------ */

export interface SourceReading {
  name: string;
  rate: number;
  inMedian: boolean;
}

/** Per-source breakdown, spread realistically around the median. */
export function sourceReadings(m: Market): SourceReading[] {
  let seed = m.c.charCodeAt(1) * 17 + 3;
  const rnd = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return m.src.map((name) => {
    const drift = (rnd() - 0.5) * 0.012; // within about ±0.6%
    const rate = m.px * (1 + drift);
    return { name, rate, inMedian: Math.abs(drift) <= 0.03 };
  });
}

/** How long ago the index last pushed on-chain. */
export const LAST_PUSH_SECONDS_AGO = 47;

/* ------------------------------------------------------------------ *
 * Landing page copy that varies
 * ------------------------------------------------------------------ */

export const FEATURES: [string, string][] = [
  ["Trade perps", "Go long or short the dollar against your currency with up to 5x. Every trade settles on Solana."],
  ["Hedge your savings", "Hold naira? One tap protects its dollar value. No bank account, no forms."],
  ["A price you can check", "The index is open. See every source, the median, and when it was pushed on-chain."],
  ["Your money, one view", "Balance, open positions and profit in one place. Your wallet is yours."],
];
