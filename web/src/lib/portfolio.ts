/**
 * What the portfolio page can honestly derive from verified records.
 *
 * The trade store holds only trades the server confirmed on devnet and matched
 * instruction-by-instruction, so everything computed here traces back to a
 * signature. There is no seeded series and no interpolation: realised P&L
 * steps when a close settles, and between closes the curve is flat because
 * nothing was realised.
 *
 * Unrealised P&L is deliberately *not* computed here — the engine stores it in
 * the portfolio account, and that stored figure is the one the UI shows.
 */

export interface VerifiedTrade {
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

export interface CurvePoint {
  time: number;
  value: number;
}

export interface RealizedSummary {
  /** Cumulative realised P&L over time, for the chart. */
  curve: CurvePoint[];
  realized: number;
  /** Notional across every verified trade, opens and closes alike. */
  volume: number;
  trades: number;
  closes: number;
}

import { pnlSign } from "./side";

const seconds = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

/**
 * Engine arithmetic, not an interpretation of the market name: a leg's P&L is
 * `sizeQ × (exit − entry)`, and `sizeQ` carries the sign. `side` here is the
 * **user-facing** side, so the sign comes from `pnlSign` — a user-facing long
 * is an engine short, and gains as the price of the local-currency bundle
 * falls. See `lib/side.ts` for why.
 *
 * Closes are matched to opens FIFO within a market and side, because that is
 * the order the engine itself unwinds a basis.
 */
export function summarize(trades: VerifiedTrade[]): RealizedSummary {
  const ordered = [...trades].sort((a, b) => seconds(a.ts) - seconds(b.ts));
  const open = new Map<string, { sizeUsdc: number; price: number }[]>();
  const steps: CurvePoint[] = [];

  let realized = 0;
  let volume = 0;
  let closes = 0;

  for (const trade of ordered) {
    volume += trade.sizeUsdc;
    const key = `${trade.marketId}|${trade.side}`;
    const sign = pnlSign(trade.side);

    if (trade.action === "open") {
      const queue = open.get(key) ?? [];
      queue.push({ sizeUsdc: trade.sizeUsdc, price: trade.price });
      open.set(key, queue);
      continue;
    }

    if (trade.action !== "close") continue;
    closes += 1;

    // Consume the oldest opens this close reverses. A close with no recorded
    // open — a position opened before the store existed — realises nothing
    // rather than guessing an entry price.
    const queue = open.get(key) ?? [];
    let remaining = trade.sizeUsdc;
    while (remaining > 1e-9 && queue.length > 0) {
      const leg = queue[0]!;
      const matched = Math.min(remaining, leg.sizeUsdc);
      if (leg.price > 0) realized += sign * matched * (trade.price / leg.price - 1);
      remaining -= matched;
      leg.sizeUsdc -= matched;
      if (leg.sizeUsdc <= 1e-9) queue.shift();
    }
    open.set(key, queue);

    steps.push({ time: seconds(trade.ts), value: realized });
  }

  // The curve opens at zero on the first trade, so the first realised step is
  // visible as a move rather than as the whole chart.
  const curve: CurvePoint[] = [];
  if (steps.length > 0 && ordered.length > 0) {
    const first = seconds(ordered[0]!.ts);
    if (first < steps[0]!.time) curve.push({ time: first, value: 0 });
  }
  for (const step of steps) {
    // lightweight-charts needs strictly increasing times; a second with two
    // closes in it keeps the later cumulative value.
    const last = curve[curve.length - 1];
    if (last && last.time === step.time) last.value = step.value;
    else curve.push(step);
  }

  return { curve, realized, volume, trades: ordered.length, closes };
}

/**
 * What is still open, and what it was opened at.
 *
 * `summarize` already walks the opens FIFO to realise closes; this returns
 * what that walk leaves behind — the unmatched opens, with the size-weighted
 * price they were entered at. That is the cost basis, and it is the missing
 * piece for every figure the portfolio could not show: unrealised P&L per
 * position, the return on a position rather than on the account, and how far
 * the mark has to move before the position is gone.
 *
 * A position opened before this store existed has no recorded open, so it
 * reports no basis rather than a guessed one.
 */
export interface OpenLot {
  marketId: string;
  side: "long" | "short";
  /** Notional still open, in tUSDC. */
  sizeUsdc: number;
  /** Size-weighted entry, in USD per contract — the engine's own scale. */
  entryPrice: number;
}

export function openLots(trades: VerifiedTrade[]): Map<string, OpenLot> {
  const ordered = [...trades].sort((a, b) => seconds(a.ts) - seconds(b.ts));
  const queues = new Map<string, { sizeUsdc: number; price: number }[]>();

  for (const trade of ordered) {
    const key = `${trade.marketId}|${trade.side}`;
    const queue = queues.get(key) ?? [];
    if (trade.action === "open") {
      queue.push({ sizeUsdc: trade.sizeUsdc, price: trade.price });
      queues.set(key, queue);
      continue;
    }
    if (trade.action !== "close" && trade.action !== "liquidation") continue;
    let remaining = trade.sizeUsdc;
    while (remaining > 1e-9 && queue.length > 0) {
      const leg = queue[0]!;
      const matched = Math.min(remaining, leg.sizeUsdc);
      remaining -= matched;
      leg.sizeUsdc -= matched;
      if (leg.sizeUsdc <= 1e-9) queue.shift();
    }
    queues.set(key, queue);
  }

  const out = new Map<string, OpenLot>();
  for (const [key, queue] of queues) {
    const sizeUsdc = queue.reduce((total, leg) => total + leg.sizeUsdc, 0);
    if (sizeUsdc <= 1e-9) continue;
    const weighted = queue.reduce((total, leg) => total + leg.sizeUsdc * leg.price, 0);
    const [marketId, side] = key.split("|") as [string, "long" | "short"];
    out.set(key, { marketId, side, sizeUsdc, entryPrice: weighted / sizeUsdc });
  }
  return out;
}

/**
 * How much room a position has left.
 *
 * `marginRatio` is equity against notional: at 5x leverage a fresh position
 * starts near 20%, and nears zero as it loses. `liquidationGapPct` is how far
 * the engine's price has to move against the position before its margin is
 * gone — the figure a trader actually watches, and one no screen here showed.
 *
 * Approximate for the same reason as `approximateLiquidationPrice`: the
 * engine's maintenance margin sits at an account offset this app does not
 * read, and fees and funding bring the real point slightly nearer.
 */
export interface PositionRisk {
  /** Equity over notional, as a percentage. Null without a notional. */
  marginRatio: number | null;
  /** Unrealised P&L on this position, in tUSDC. Null without a cost basis. */
  unrealizedUsdc: number | null;
  /** Return on the margin behind it, as a percentage. */
  returnPct: number | null;
  /** How far the engine price must move against it, as a percentage. */
  liquidationGapPct: number | null;
}

export function positionRisk(input: {
  /** Notional of the open position, in tUSDC. */
  notionalUsdc: number;
  /** Equity in the portfolio backing it, in tUSDC. */
  equityUsdc: number;
  side: "long" | "short";
  /** Engine price now, USD per contract. */
  markPrice: number;
  /** Entry from the cost basis, USD per contract. Null when unrecorded. */
  entryPrice: number | null;
}): PositionRisk {
  const { notionalUsdc, equityUsdc, side, markPrice, entryPrice } = input;
  const marginRatio = notionalUsdc > 0 ? (equityUsdc / notionalUsdc) * 100 : null;

  const unrealizedUsdc =
    entryPrice !== null && entryPrice > 0 && markPrice > 0
      ? pnlSign(side) * notionalUsdc * (markPrice / entryPrice - 1)
      : null;

  // Margin at risk is the equity standing behind this position, so the move
  // it can absorb is that equity as a share of the notional.
  const liquidationGapPct =
    notionalUsdc > 0 && equityUsdc > 0 ? Math.min(100, (equityUsdc / notionalUsdc) * 100) : null;

  const margin = marginRatio !== null && marginRatio > 0 ? (notionalUsdc * marginRatio) / 100 : null;
  const returnPct =
    unrealizedUsdc !== null && margin !== null && margin > 0
      ? (unrealizedUsdc / margin) * 100
      : null;

  return { marginRatio, unrealizedUsdc, returnPct, liquidationGapPct };
}

/**
 * The familiar quote for a market, from the engine's USD-per-contract price.
 *
 * A contract is a bundle of local currency — 1,000 naira, say — so the price
 * the engine stores is upside down relative to how the rate is spoken about.
 * This is the same conversion the candles route applies, kept identical so the
 * portfolio and the chart cannot disagree.
 */
export function localQuote(unit: number, effectivePriceE6: string): number | null {
  const unitPrice = Number(BigInt(effectivePriceE6)) / 1_000_000;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  return unit / unitPrice;
}
