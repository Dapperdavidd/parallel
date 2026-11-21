import "server-only";

import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export const PERCOLATOR_PROGRAM_ID = new PublicKey(
  "Bu1J8eQQN2mNnUgisSEd5StBG6zDaRb7fwDjN34VzgLG",
);
export const POS_SCALE = 1_000_000n;

const MARKET_GROUP_OFF = 464;
const MARKET_GROUP_HEADER_LEN = 726;
const ASSET_ORACLE_WRAPPER_LEN = 512;
const ASSET_STATE_OFF = MARKET_GROUP_OFF + MARKET_GROUP_HEADER_LEN + ASSET_ORACLE_WRAPPER_LEN;
const EFFECTIVE_PRICE_OFF = ASSET_STATE_OFF + 25;
const OI_LONG_OFF = ASSET_STATE_OFF + 273;
const OI_SHORT_OFF = ASSET_STATE_OFF + 289;

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
