import { test } from "node:test";
import assert from "node:assert/strict";
import { openLots, positionRisk, summarize, type VerifiedTrade } from "@/lib/portfolio";
import { pnlSign } from "@/lib/side";

/**
 * The arithmetic behind somebody's own money.
 *
 * Realised P&L steps when a close settles; the cost basis is what the FIFO
 * walk leaves unmatched. Both are derived from `pnlSign` rather than from an
 * intuition about which way "long" points, because that intuition has been
 * wrong twice in this codebase.
 */

let clock = Date.parse("2026-11-20T10:00:00Z");
const trade = (over: Partial<VerifiedTrade>): VerifiedTrade => {
  clock += 60_000;
  return {
    marketId: "USD/NGN",
    wallet: "wallet",
    side: "long",
    action: "open",
    sizeUsdc: 1_000,
    leverage: 2,
    price: 0.7,
    txSignature: `sig-${clock}`,
    ts: new Date(clock).toISOString(),
    ...over,
  };
};

test("no trades means no curve and no realised P&L", () => {
  const summary = summarize([]);
  assert.equal(summary.realized, 0);
  assert.equal(summary.curve.length, 0);
  assert.equal(summary.trades, 0);
});

test("an open on its own realises nothing", () => {
  const summary = summarize([trade({})]);
  assert.equal(summary.realized, 0);
  assert.equal(summary.closes, 0);
  assert.equal(summary.volume, 1_000);
});

test("a long that profits realises a gain", () => {
  // A user-facing long is an engine short, so it gains as the engine price
  // falls: 0.70 in, 0.63 out is a 10% move in its favour.
  const summary = summarize([
    trade({ action: "open", side: "long", price: 0.7 }),
    trade({ action: "close", side: "long", price: 0.63 }),
  ]);
  assert.ok(Math.abs(summary.realized - 100) < 1e-9, String(summary.realized));
  assert.equal(summary.closes, 1);
  assert.equal(summary.curve.length >= 1, true);
});

test("a long that loses realises a loss, by the same arithmetic", () => {
  const summary = summarize([
    trade({ action: "open", side: "long", price: 0.7 }),
    trade({ action: "close", side: "long", price: 0.77 }),
  ]);
  assert.ok(Math.abs(summary.realized + 100) < 1e-9, String(summary.realized));
});

test("a short is the mirror of a long", () => {
  const long = summarize([
    trade({ action: "open", side: "long", price: 0.7 }),
    trade({ action: "close", side: "long", price: 0.63 }),
  ]).realized;
  const short = summarize([
    trade({ action: "open", side: "short", price: 0.7 }),
    trade({ action: "close", side: "short", price: 0.63 }),
  ]).realized;
  assert.ok(Math.abs(long + short) < 1e-9, `${long} vs ${short}`);
});

test("closes consume opens oldest-first", () => {
  // Two opens at different prices, one close for half the total: the first
  // open is the one unwound, so the realised figure is its move alone.
  const summary = summarize([
    trade({ action: "open", price: 0.7, sizeUsdc: 1_000 }),
    trade({ action: "open", price: 0.8, sizeUsdc: 1_000 }),
    trade({ action: "close", price: 0.63, sizeUsdc: 1_000 }),
  ]);
  assert.ok(Math.abs(summary.realized - 100) < 1e-9, String(summary.realized));
});

test("a close with no recorded open realises nothing rather than guessing", () => {
  const summary = summarize([trade({ action: "close", price: 0.63 })]);
  assert.equal(summary.realized, 0);
  assert.equal(summary.closes, 1);
});

test("the cost basis is what the FIFO walk leaves open", () => {
  const lots = openLots([
    trade({ action: "open", price: 0.7, sizeUsdc: 1_000 }),
    trade({ action: "open", price: 0.8, sizeUsdc: 3_000 }),
  ]);
  const lot = lots.get("USD/NGN|long");
  assert.ok(lot);
  assert.equal(lot.sizeUsdc, 4_000);
  // Size-weighted, not a plain mean: (1000·0.7 + 3000·0.8) / 4000.
  assert.ok(Math.abs(lot.entryPrice - 0.775) < 1e-12, String(lot.entryPrice));
});

test("a fully closed market leaves no lot behind", () => {
  const lots = openLots([
    trade({ action: "open", price: 0.7, sizeUsdc: 1_000 }),
    trade({ action: "close", price: 0.63, sizeUsdc: 1_000 }),
  ]);
  assert.equal(lots.size, 0);
});

test("a liquidation closes a lot like a close does", () => {
  const lots = openLots([
    trade({ action: "open", price: 0.7, sizeUsdc: 1_000 }),
    trade({ action: "liquidation", price: 0.9, sizeUsdc: 1_000 }),
  ]);
  assert.equal(lots.size, 0);
});

test("position risk reports margin, return and the room left", () => {
  const risk = positionRisk({
    notionalUsdc: 2_000,
    equityUsdc: 1_000,
    side: "long",
    markPrice: 0.63,
    entryPrice: 0.7,
  });
  assert.equal(risk.marginRatio, 50);
  assert.ok(Math.abs(risk.unrealizedUsdc! - 200) < 1e-9, String(risk.unrealizedUsdc));
  assert.ok(Math.abs(risk.returnPct! - 20) < 1e-9, String(risk.returnPct));
  assert.equal(risk.liquidationGapPct, 50);
});

test("position risk says nothing it cannot derive", () => {
  const risk = positionRisk({
    notionalUsdc: 2_000,
    equityUsdc: 1_000,
    side: "long",
    markPrice: 0.63,
    entryPrice: null,
  });
  assert.equal(risk.unrealizedUsdc, null);
  assert.equal(risk.returnPct, null);
  // The margin figures do not need a basis, so they are still there.
  assert.equal(risk.marginRatio, 50);
});

test("unrealised P&L follows the sign convention, not the price direction", () => {
  for (const side of ["long", "short"] as const) {
    const risk = positionRisk({
      notionalUsdc: 1_000,
      equityUsdc: 500,
      side,
      // The engine price fell, which is a gain for a long and a loss for a short.
      markPrice: 0.63,
      entryPrice: 0.7,
    });
    const expected = pnlSign(side) * 1_000 * (0.63 / 0.7 - 1);
    assert.ok(Math.abs(risk.unrealizedUsdc! - expected) < 1e-9, `${side}: ${risk.unrealizedUsdc}`);
  }
});
