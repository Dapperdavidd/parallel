import "server-only";

import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { warn } from "./log";

export const PERCOLATOR_PROGRAM_ID = new PublicKey(
  "Bu1J8eQQN2mNnUgisSEd5StBG6zDaRb7fwDjN34VzgLG",
);
export const POS_SCALE = 1_000_000n;
export const PORTFOLIO_ACCOUNT_LEN = 9_411;

const MARKET_GROUP_OFF = 464;
const MARKET_GROUP_HEADER_LEN = 726;
const ASSET_ORACLE_WRAPPER_LEN = 512;
const ASSET_STATE_OFF = MARKET_GROUP_OFF + MARKET_GROUP_HEADER_LEN + ASSET_ORACLE_WRAPPER_LEN;
const EFFECTIVE_PRICE_OFF = ASSET_STATE_OFF + 25;
const OI_LONG_OFF = ASSET_STATE_OFF + 273;
const OI_SHORT_OFF = ASSET_STATE_OFF + 289;
const PORTFOLIO_STATE_OFF = 16;
export const PORTFOLIO_OWNER_OFF = PORTFOLIO_STATE_OFF + 100;
const PORTFOLIO_CAPITAL_OFF = PORTFOLIO_STATE_OFF + 132;
const PORTFOLIO_PNL_OFF = PORTFOLIO_STATE_OFF + 148;
const PORTFOLIO_LEGS_OFF = PORTFOLIO_STATE_OFF + 340;
const PORTFOLIO_LEG_LEN = 144;
const PORTFOLIO_LEG_COUNT = 16;

const u16le = (value: number): Buffer => {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
};
const u64le = (value: bigint): Buffer => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
};
const i128le = (value: bigint): Buffer => {
  const out = Buffer.alloc(16);
  const unsigned = value < 0n ? (1n << 128n) + value : value;
  out.writeBigUInt64LE(unsigned & ((1n << 64n) - 1n), 0);
  out.writeBigUInt64LE(unsigned >> 64n, 8);
  return out;
};
const u128 = (data: Buffer, offset: number): bigint =>
  data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n);
const i128 = (data: Buffer, offset: number): bigint => {
  const value = u128(data, offset);
  return value >= 1n << 127n ? value - (1n << 128n) : value;
};

export interface PortfolioLegState {
  assetIndex: number;
  marketId: bigint;
  side: number;
  basisPosQ: bigint;
}

export function portfolioState(data: Buffer) {
  if (data.length !== PORTFOLIO_ACCOUNT_LEN) throw new Error("Unexpected Percolator portfolio size");
  const legs: PortfolioLegState[] = [];
  for (let index = 0; index < PORTFOLIO_LEG_COUNT; index += 1) {
    const offset = PORTFOLIO_LEGS_OFF + index * PORTFOLIO_LEG_LEN;
    if (data.readUInt8(offset) === 0) continue;
    legs.push({
      assetIndex: data.readUInt32LE(offset + 1),
      marketId: data.readBigUInt64LE(offset + 5),
      side: data.readUInt8(offset + 13),
      basisPosQ: i128(data, offset + 14),
    });
  }
  return {
    marketGroupId: new PublicKey(data.subarray(PORTFOLIO_STATE_OFF, PORTFOLIO_STATE_OFF + 32)),
    owner: new PublicKey(data.subarray(PORTFOLIO_OWNER_OFF, PORTFOLIO_OWNER_OFF + 32)),
    capitalAtoms: u128(data, PORTFOLIO_CAPITAL_OFF),
    pnlAtoms: i128(data, PORTFOLIO_PNL_OFF),
    legs,
  };
}

export function marketRiskState(data: Buffer) {
  if (data.length < OI_SHORT_OFF + 16) throw new Error("Percolator market account is too short");
  return {
    effectivePriceE6: data.readBigUInt64LE(EFFECTIVE_PRICE_OFF),
    openInterestLongQ: u128(data, OI_LONG_OFF),
    openInterestShortQ: u128(data, OI_SHORT_OFF),
  };
}

export function sizeQForNotional(notionalAtoms: bigint, priceE6: bigint): bigint {
  if (notionalAtoms <= 0n || priceE6 <= 0n) throw new Error("Trade size and price must be positive");
  return (notionalAtoms * POS_SCALE) / priceE6;
}

export function notionalAtoms(sizeQ: bigint, priceE6: bigint): bigint {
  const absolute = sizeQ < 0n ? -sizeQ : sizeQ;
  return (absolute * priceE6) / POS_SCALE;
}

export function tradeNoCpi(args: {
  user: PublicKey;
  vaultAuthority: PublicKey;
  market: PublicKey;
  userPortfolio: PublicKey;
  vaultPortfolio: PublicKey;
  sizeQ: bigint;
  effectivePriceE6: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: PERCOLATOR_PROGRAM_ID,
    keys: [
      { pubkey: args.user, isSigner: true, isWritable: false },
      { pubkey: args.vaultAuthority, isSigner: true, isWritable: false },
      { pubkey: args.market, isSigner: false, isWritable: true },
      { pubkey: args.userPortfolio, isSigner: false, isWritable: true },
      { pubkey: args.vaultPortfolio, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([
      Buffer.from([6]),
      u16le(0),
      i128le(args.sizeQ),
      u64le(args.effectivePriceE6),
      u64le(0n),
    ]),
  });
}

/**
 * How far the engine's price may sit from our own index before we refuse.
 *
 * Every offset in this file is a byte position in an account Percolator owns,
 * read from the v16 layout. If that program is upgraded and a field moves, the
 * parse does not fail — it returns a number from the wrong place, and a trade
 * would be priced on it. There is no version byte in the account to check
 * against, and the program's upgrade-data account does not resolve on devnet,
 * so the strongest available check is a cross-reference: the effective price
 * must look like the price our own index measured.
 *
 * In practice the two sit within about 5% of each other, because the keeper
 * pushes on a 0.1% move or every ten minutes. A misread field would be out by
 * orders of magnitude, so the band only has to be loose enough never to
 * inconvenience a real trade.
 */
const ENGINE_PRICE_BAND = 0.4;
/** Outside this, something is wrong but trading can continue; say so. */
const ENGINE_PRICE_DRIFT_WARNING = 0.1;

export class EngineLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineLayoutError";
  }
}

/**
 * Refuse to trade against a price that cannot be right.
 *
 * Returns the signed drift, in basis points, for the caller to show as part of
 * the quote: it is the honest "execution versus index" figure, and the only
 * number that tells a trader where they will actually be filled.
 */
export function assertEnginePriceSane(
  effectivePriceE6: bigint,
  indexUnitPriceUsd: number,
  marketId: string,
): number {
  if (!(indexUnitPriceUsd > 0)) {
    throw new EngineLayoutError("The index has no price for this market");
  }
  const engine = Number(effectivePriceE6) / 1e6;
  if (!(engine > 0)) {
    throw new EngineLayoutError("The engine reports no price for this market");
  }
  const drift = engine / indexUnitPriceUsd - 1;
  if (Math.abs(drift) > ENGINE_PRICE_BAND) {
    throw new EngineLayoutError(
      "The engine price disagrees with the index beyond what we will trade on",
    );
  }
  if (Math.abs(drift) > ENGINE_PRICE_DRIFT_WARNING) {
    warn({
      event: "engine_price_drift",
      marketId,
      engine,
      index: indexUnitPriceUsd,
      driftBps: Math.round(drift * 10_000),
    });
  }
  return Math.round(drift * 10_000);
}

/**
 * Where the position is wiped out, to the nearest honest approximation.
 *
 * Percolator holds maintenance margin in the market account, at an offset this
 * app does not read, so this is the textbook figure: a position is gone when
 * the price has moved against it by its own margin, which is `1/leverage` of
 * the notional. It ignores fees and accrued funding, both of which bring the
 * real liquidation slightly nearer, so it is quoted as an approximation and
 * never as a promise.
 *
 * **The direction is the easy thing to get backwards**, and §7.16 of the
 * decision log is what happened the last time it was. Work it from
 * `lib/side.ts` rather than from intuition:
 *
 *   - the engine price here is USD per contract, a contract being a bundle of
 *     local currency, so the price *falls* as the local currency weakens;
 *   - a user-facing long profits when the local currency weakens
 *     (`engineSign("long") === -1n`, and engine P&L is
 *     `sizeQ × (exit − entry)`), so it profits as this price falls;
 *   - therefore a long is liquidated when this price **rises**.
 *
 * In the familiar quote — local currency per USD, the reciprocal — that comes
 * out the other way round, which is why the two must never be mixed: a long's
 * liquidation quote is *below* its entry quote.
 */
export function approximateLiquidationPrice(
  entryPriceUsd: number,
  leverage: number,
  side: "long" | "short",
): number {
  if (leverage <= 0) throw new Error("Leverage must be positive");
  const move = entryPriceUsd / leverage;
  return side === "long" ? entryPriceUsd + move : Math.max(0, entryPriceUsd - move);
}
