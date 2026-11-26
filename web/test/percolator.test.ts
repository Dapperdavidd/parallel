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

test("liquidation sits a margin's width away, on the losing side", () => {
  // A user-facing long gains as the local currency strengthens, so it dies
  // below entry; a short dies above it.
  assert.equal(approximateLiquidationPrice(1, 2, "long"), 0.5);
  assert.equal(approximateLiquidationPrice(1, 2, "short"), 1.5);
  assert.equal(approximateLiquidationPrice(1, 5, "long"), 0.8);
  // At 1x a long cannot be liquidated by price alone: the price would have to
  // reach zero, which is what this returns.
  assert.equal(approximateLiquidationPrice(1, 1, "long"), 0);
  assert.throws(() => approximateLiquidationPrice(1, 0, "long"), /positive/);
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
