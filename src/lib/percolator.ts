/**
 * Parallel's wrapper over the vendored Percolator v16 library.
 *
 * All adaptation lives here so `src/vendor/percolator-v16/` stays a clean,
 * re-syncable diff against upstream.
 *
 * THE ABI PROBLEM THIS FILE SOLVES
 * --------------------------------
 * The vendored TypeScript is pinned to percolator-prog HEAD `70294cb` and
 * encodes the SHORT AuthMark wire:
 *     [tag, asset_index:u16, now_slot:u64, mark_e6:u64]                 19 bytes
 *
 * percolator-prog at HEAD `bd07155` decodes a LONGER one:
 *     [tag, asset_index:u16, market_id:u64, now_slot:u64, mark_e6:u64,
 *      observation_sequence:u64, authority_epoch:u64]                   43 bytes
 *
 * A working 6-decimal-USDC deployment (percolator-vaults examples/devnet.rs)
 * uses the long form. `encInitMarket`, by contrast, matches the Rust decoder
 * field-for-field — the drift is localised to these two tags, which is exactly
 * why it is easy to miss.
 *
 * We cannot tell from source which build is deployed at the canonical program
 * id, so we encode BOTH and let spike 1 settle it on-chain.
 */

import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { PERCOLATOR_PROGRAM_ID } from "./solana.js";
import {
  MARKET_GROUP_OFF,
  MARKET_GROUP_HEADER_LEN,
  ASSET_SLOT_LEN,
  marketAccountLenFor,
  encInitMarket,
  type InitMarketArgs,
} from "../vendor/percolator-v16/index.js";

export { marketAccountLenFor, encInitMarket, type InitMarketArgs };

/* ------------------------------------------------------------------ *
 * Little-endian writers (the vendored module does not export its own)
 * ------------------------------------------------------------------ */

const u8 = (v: number): Buffer => Buffer.from([v & 0xff]);

const u16le = (v: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v, 0);
  return b;
};

const u64le = (v: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return b;
};

/* ------------------------------------------------------------------ *
 * Instruction tags (percolator-prog src/v16_program.rs tag decoder)
 * ------------------------------------------------------------------ */

export const TAG_INIT_MARKET = 0;
export const TAG_INIT_PORTFOLIO = 1;
export const TAG_DEPOSIT = 3;
export const TAG_PERMISSIONLESS_CRANK = 5;
export const TAG_TRADE_NO_CPI = 6;
export const TAG_CONFIGURE_AUTH_MARK = 62;
export const TAG_PUSH_AUTH_MARK = 63;

/** Oracle modes. The mode is selected by WHICH TAG you send, not by a feed id. */
export const ORACLE_MODE = {
  Manual: 0,
  HybridAfterHours: 1,
  EwmaMark: 2,
  AuthMark: 3,
} as const;

/* ------------------------------------------------------------------ *
 * Asset control sequences
 *
 * Layout from percolator-prog src/v16_program.rs:
 *   ASSET_ORACLE_PROFILE_LEN   = 424
 *   ASSET_ORACLE_WRAPPER_LEN   = 512
 *   ASSET_CONTROL_SEQUENCES_OFF = ASSET_ORACLE_PROFILE_LEN  = 424
 *   ASSET_CONTROL_SEQUENCES_LEN = 512 - 424                 = 88  (11 x u64)
 *   slot_offset(i) = MARKET_GROUP_OFF + MARKET_GROUP_HEADER_LEN + i * ASSET_SLOT_LEN
 *
 * For asset 0 that is 464 + 726 + 424 = 1614.
 * ------------------------------------------------------------------ */

export const ASSET_ORACLE_PROFILE_LEN = 424;
export const ASSET_CONTROL_SEQUENCES_LEN = 88;

export function assetSlotOffset(assetIndex: number): number {
  return MARKET_GROUP_OFF + MARKET_GROUP_HEADER_LEN + assetIndex * ASSET_SLOT_LEN;
}

export function assetControlSequencesOffset(assetIndex: number): number {
  return assetSlotOffset(assetIndex) + ASSET_ORACLE_PROFILE_LEN;
}

/**
 * The eleven independent monotonic watermarks guarding authority-gated
 * instructions. Each lane has its own counter; asset 0 owns the market-wide ones.
 */
export interface AssetControlSequences {
  oracleObservation: bigint;
  backingFee: bigint;
  authorityEpoch: bigint;
  tradeFee: bigint;
  liquidationFee: bigint;
  maintenanceFee: bigint;
  feeRedirect: bigint;
  marketInitFee: bigint;
  permissionlessResolve: bigint;
  insuranceTopUp: bigint;
  backingTopUp: bigint;
}

export function readAssetControlSequences(
  data: Buffer,
  assetIndex: number,
): AssetControlSequences {
  const off = assetControlSequencesOffset(assetIndex);
  if (data.length < off + ASSET_CONTROL_SEQUENCES_LEN) {
    throw new Error(
      `market account too short for asset ${assetIndex} control sequences: ` +
        `need ${off + ASSET_CONTROL_SEQUENCES_LEN}, have ${data.length}`,
    );
  }
  const at = (i: number): bigint => data.readBigUInt64LE(off + i * 8);
  return {
    oracleObservation: at(0),
    backingFee: at(1),
    authorityEpoch: at(2),
    tradeFee: at(3),
    liquidationFee: at(4),
    maintenanceFee: at(5),
    feeRedirect: at(6),
    marketInitFee: at(7),
    permissionlessResolve: at(8),
    insuranceTopUp: at(9),
    backingTopUp: at(10),
  };
}

/* ------------------------------------------------------------------ *
 * AuthMark encoders — both wire formats
 * ------------------------------------------------------------------ */

export type AuthMarkWire = "short" | "long";

export interface ConfigureAuthMarkArgs {
  assetIndex: number;
  marketId: bigint;
  nowSlot: bigint;
  initialMarkE6: bigint;
  observationSequence: bigint;
  authorityEpoch: bigint;
}

export function encConfigureAuthMark(a: ConfigureAuthMarkArgs, wire: AuthMarkWire): Buffer {
  if (wire === "short") {
    return Buffer.concat([
      u8(TAG_CONFIGURE_AUTH_MARK),
      u16le(a.assetIndex),
      u64le(a.nowSlot),
      u64le(a.initialMarkE6),
    ]);
  }
  return Buffer.concat([
    u8(TAG_CONFIGURE_AUTH_MARK),
    u16le(a.assetIndex),
    u64le(a.marketId),
    u64le(a.nowSlot),
    u64le(a.initialMarkE6),
    u64le(a.observationSequence),
    u64le(a.authorityEpoch),
  ]);
}

export interface PushAuthMarkArgs {
  assetIndex: number;
  marketId: bigint;
  nowSlot: bigint;
  markE6: bigint;
  observationSequence: bigint;
  authorityEpoch: bigint;
}

export function encPushAuthMark(a: PushAuthMarkArgs, wire: AuthMarkWire): Buffer {
  if (wire === "short") {
    return Buffer.concat([
      u8(TAG_PUSH_AUTH_MARK),
      u16le(a.assetIndex),
      u64le(a.nowSlot),
      u64le(a.markE6),
    ]);
  }
  return Buffer.concat([
    u8(TAG_PUSH_AUTH_MARK),
    u16le(a.assetIndex),
    u64le(a.marketId),
    u64le(a.nowSlot),
    u64le(a.markE6),
    u64le(a.observationSequence),
    u64le(a.authorityEpoch),
  ]);
}

/* ------------------------------------------------------------------ *
 * Account metas
 * ------------------------------------------------------------------ */

/** InitMarket: [admin(signer), market(writable), collateral mint]. No vault here. */
export function ixInitMarket(
  admin: PublicKey,
  market: PublicKey,
  mint: PublicKey,
  args: InitMarketArgs,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: PERCOLATOR_PROGRAM_ID,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
    ],
    data: encInitMarket(args),
  });
}

/** ConfigureAuthMark / PushAuthMark: [authority(signer), market(writable)]. */
export function ixAuthMark(
  authority: PublicKey,
  market: PublicKey,
  data: Buffer,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: PERCOLATOR_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
    ],
    data,
  });
}

/* ------------------------------------------------------------------ *
 * PDAs
 * ------------------------------------------------------------------ */

/** The collateral vault authority. Seeds are ["vault", market] under the wrapper. */
export function vaultAuthority(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    PERCOLATOR_PROGRAM_ID,
  )[0];
}

/* ------------------------------------------------------------------ *
 * Market parameters
 *
 * Baseline is percolator-vaults examples/devnet.rs — a working 6-decimal USDC
 * deployment — adjusted for Parallel's leverage tiers. See DECISIONS.md §3.13.
 *
 * HARD CONSTRAINT, engine-enforced:
 *   max_price_move_bps_per_slot * max_accrual_dt_slots + liquidation_fee_bps
 *       <= maintenance_margin_bps
 *
 * Every one of these is IMMUTABLE after InitMarket. There is no UpdateConfig
 * instruction in v16. Getting one wrong means building a new market.
 * ------------------------------------------------------------------ */

export const MAX_PRICE_MOVE_BPS_PER_SLOT = 24n;
export const MAX_ACCRUAL_DT_SLOTS = 10n;
export const LIQUIDATION_FEE_BPS = 5n;

/** Percolator expresses leverage as margin: max_leverage = 10_000 / initial_margin_bps. */
export function initialMarginBpsForLeverage(maxLeverage: number): bigint {
  if (!Number.isFinite(maxLeverage) || maxLeverage <= 0) {
    throw new Error(`bad leverage: ${maxLeverage}`);
  }
  const bps = Math.round(10_000 / maxLeverage);
  if (bps < 1 || bps > 10_000) throw new Error(`leverage ${maxLeverage}x out of range`);
  return BigInt(bps);
}

export interface MarketParamOpts {
  /** USD price of one tradable unit, already in e6. */
  initialPriceE6: bigint;
  maxLeverage: number;
  /** Maintenance margin. Must satisfy the hard constraint above. */
  maintenanceMarginBps?: bigint;
  /** Immutable, and FUNDING_DEN is engine-side, so default off. See DECISIONS.md. */
  maxAbsFundingE9PerSlot?: bigint;
}

export function buildMarketParams(opts: MarketParamOpts): InitMarketArgs {
  const initialMarginBps = initialMarginBpsForLeverage(opts.maxLeverage);
  const maintenanceMarginBps = opts.maintenanceMarginBps ?? initialMarginBps / 2n;

  const floor =
    MAX_PRICE_MOVE_BPS_PER_SLOT * MAX_ACCRUAL_DT_SLOTS + LIQUIDATION_FEE_BPS;
  if (maintenanceMarginBps < floor) {
    throw new Error(
      `maintenance_margin_bps ${maintenanceMarginBps} is below the engine floor ${floor} ` +
        `(= max_price_move ${MAX_PRICE_MOVE_BPS_PER_SLOT} x dt ${MAX_ACCRUAL_DT_SLOTS} ` +
        `+ liq_fee ${LIQUIDATION_FEE_BPS}). The market would be rejected.`,
    );
  }
  if (maintenanceMarginBps > initialMarginBps) {
    throw new Error(
      `maintenance_margin_bps ${maintenanceMarginBps} exceeds initial_margin_bps ${initialMarginBps}`,
    );
  }

  return {
    maxPortfolioAssets: 1,
    hMin: 0n,
    hMax: 6_480_000n,
    initialPrice: opts.initialPriceE6,
    minNonzeroMmReq: 500n,
    minNonzeroImReq: 600n,
    maintenanceMarginBps,
    initialMarginBps,
    maxTradingFeeBps: 10_000n,
    tradeFeeBaseBps: 0n,
    liquidationFeeBps: LIQUIDATION_FEE_BPS,
    liquidationFeeCap: 50_000_000n,
    minLiquidationAbs: 0n,
    maxPriceMoveBpsPerSlot: MAX_PRICE_MOVE_BPS_PER_SLOT,
    maxAccrualDtSlots: MAX_ACCRUAL_DT_SLOTS,
    maxAbsFundingE9PerSlot: opts.maxAbsFundingE9PerSlot ?? 0n,
    minFundingLifetimeSlots: 10_000_000n,
    maxAccountBSettlementChunks: 1n,
    maxBankruptCloseChunks: 1n,
    maxBankruptCloseLifetimeSlots: 100n,
    publicBChunkAtoms: 1_000_000n,
    maintenanceFeePerSlot: 0n,
  };
}
