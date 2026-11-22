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

const seconds = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

/**
 * Engine arithmetic, not an interpretation of the market name: a leg's P&L is
 * `sizeQ × (exit − entry)`, and `sizeQ` carries the sign. In notional terms
 * that is `notional × (exit / entry − 1)` for a long and the negative of it
 * for a short, which is what this computes. So "long" here means whatever the
 * engine meant by a positive `basisPosQ`, and the figure is right regardless
 * of how the pair is quoted on screen.
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
    const sign = trade.side === "long" ? 1 : -1;

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
