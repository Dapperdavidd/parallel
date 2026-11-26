import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approximateLiquidationPrice,
  assertEnginePriceSane,
  EngineLayoutError,
  notionalAtoms,
  POS_SCALE,
  portfolioState,
  PORTFOLIO_ACCOUNT_LEN,
  sizeQForNotional,
} from "@/lib/server/percolator";
import { engineSign, pnlSign, sideOf } from "@/lib/side";

test("size and notional are inverses of each other", () => {
  const priceE6 = 694_028n; // USD per 1,000 NGN, from the registry
  const notional = 1_000_000_000n; // 1,000 tUSDC in atoms
  const sizeQ = sizeQForNotional(notional, priceE6);
  const roundTrip = notionalAtoms(sizeQ, priceE6);
  // Integer division loses at most one atom of the smaller unit.
  assert.ok(roundTrip <= notional && notional - roundTrip < 1_000n, `${roundTrip} vs ${notional}`);
});

test("notional ignores the sign of the position", () => {
  const priceE6 = 500_000n;
  assert.equal(notionalAtoms(2n * POS_SCALE, priceE6), notionalAtoms(-2n * POS_SCALE, priceE6));
});

test("a zero or negative size is refused rather than rounded", () => {
  assert.throws(() => sizeQForNotional(0n, 1n), /must be positive/);
  assert.throws(() => sizeQForNotional(-1n, 1n), /must be positive/);
  assert.throws(() => sizeQForNotional(1n, 0n), /must be positive/);
});

test("the engine price is accepted when it tracks the index", () => {
  // Measured on devnet: the engine sits within a few per cent of the index.
  const bps = assertEnginePriceSane(688_719n, 0.693730239527708, "USD/NGN");
  assert.ok(Math.abs(bps) < 200, `${bps}bps`);
});

test("a misread price field is refused rather than traded on", () => {
  // What a shifted offset looks like: a number from somewhere else entirely.
  assert.throws(
    () => assertEnginePriceSane(18_446_744_073n, 0.6937, "USD/NGN"),
    (error: unknown) => error instanceof EngineLayoutError,
  );
  assert.throws(
    () => assertEnginePriceSane(1n, 0.6937, "USD/NGN"),
    (error: unknown) => error instanceof EngineLayoutError,
  );
});

test("no index price means no trade", () => {
  assert.throws(() => assertEnginePriceSane(694_028n, 0, "USD/NGN"), /no price/);
});

test("liquidation sits a margin's width away, on the side that loses", () => {
  // Derived, not assumed. Engine P&L is `sizeQ × (exit − entry)`, and a
  // user-facing long carries a negative sizeQ, so a long profits as the
  // engine price falls and is liquidated when it rises. Getting this
  // backwards is what §7.16 was, and the first version of this function
  // had it backwards too.
  assert.equal(approximateLiquidationPrice(1, 2, "long"), 1.5);
  assert.equal(approximateLiquidationPrice(1, 2, "short"), 0.5);
  assert.equal(approximateLiquidationPrice(1, 5, "long"), 1.2);
  assert.equal(approximateLiquidationPrice(1, 5, "short"), 0.8);
  assert.throws(() => approximateLiquidationPrice(1, 0, "long"), /positive/);
});

test("liquidation agrees with the sign convention it is derived from", () => {
  // The property, rather than the arithmetic: a position is liquidated on the
  // side where its own P&L is negative. If `pnlSign` or `engineSign` ever
  // flips, this fails rather than quietly showing the wrong number.
  for (const side of ["long", "short"] as const) {
    const entry = 0.688719;
    const liquidation = approximateLiquidationPrice(entry, 3, side);
    const move = liquidation - entry;
    // pnlSign turns an engine price move into the user's P&L direction.
    const pnlAtLiquidation = pnlSign(side) * move;
    assert.ok(
      pnlAtLiquidation < 0,
      `${side} should be losing at its liquidation price, got ${pnlAtLiquidation}`,
    );
    // And the move is a full margin's width.
    assert.ok(Math.abs(Math.abs(move) / entry - 1 / 3) < 1e-12);
  }
});

test("a long's liquidation quote sits below its entry quote", () => {
  // The quote scale is the reciprocal of the engine's, so the direction
  // inverts. Mixing the two is how a screen ends up telling somebody they
  // are liquidated in the direction they are profiting.
  const unit = 1_000;
  const entry = 0.688719;
  const entryQuote = unit / entry;
  const longQuote = unit / approximateLiquidationPrice(entry, 3, "long");
  const shortQuote = unit / approximateLiquidationPrice(entry, 3, "short");
  assert.ok(longQuote < entryQuote, `${longQuote} should be under ${entryQuote}`);
  assert.ok(shortQuote > entryQuote, `${shortQuote} should be over ${entryQuote}`);
});

test("the user-facing side and the engine sign stay inverses", () => {
  assert.equal(engineSign("long"), -1n);
  assert.equal(engineSign("short"), 1n);
  assert.equal(sideOf(engineSign("long") * 5n), "long");
  assert.equal(sideOf(engineSign("short") * 5n), "short");
  assert.equal(pnlSign("long"), -1);
  assert.equal(pnlSign("short"), 1);
});

test("a portfolio account of the wrong size is refused, not parsed", () => {
  assert.throws(() => portfolioState(Buffer.alloc(PORTFOLIO_ACCOUNT_LEN - 1)), /Unexpected/);
  assert.throws(() => portfolioState(Buffer.alloc(0)), /Unexpected/);
});

test("an empty portfolio parses with no legs", () => {
  const state = portfolioState(Buffer.alloc(PORTFOLIO_ACCOUNT_LEN));
  assert.equal(state.legs.length, 0);
  assert.equal(state.capitalAtoms, 0n);
  assert.equal(state.pnlAtoms, 0n);
});
