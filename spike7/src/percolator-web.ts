/**
 * Minimal browser-side Percolator encoders.
 *
 * Deliberately NOT importing `src/vendor/percolator-v16/` or `src/lib/`: those
 * use Node's `Buffer` and `node:fs`, which would drag a polyfill into this test
 * page. Only three instructions are needed here, and they are small enough to
 * hand-roll against `Uint8Array`.
 *
 * Wire formats are the same ones spike 1 verified against the deployed program.
 */

import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export const PERCOLATOR_PROGRAM_ID = new PublicKey(
  "Bu1J8eQQN2mNnUgisSEd5StBG6zDaRb7fwDjN34VzgLG",
);
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

export const PORTFOLIO_ACCOUNT_LEN = 9411;
export const POS_SCALE = 1_000_000n;

const TAG_INIT_PORTFOLIO = 1;
const TAG_DEPOSIT = 3;

function u128le(v: bigint): Uint8Array {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setBigUint64(0, v & 0xffffffffffffffffn, true);
  dv.setBigUint64(8, v >> 64n, true);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Vault authority PDA: seeds ["vault", market] under the wrapper program. */
export function vaultAuthority(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("vault"), market.toBytes()],
    PERCOLATOR_PROGRAM_ID,
  )[0];
}

/** InitPortfolio: [owner(signer), market(w), portfolio(w)]. No arguments. */
export function ixInitPortfolio(
  owner: PublicKey,
  market: PublicKey,
  portfolio: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: PERCOLATOR_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: portfolio, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(new Uint8Array([TAG_INIT_PORTFOLIO])),
  });
}

/** Deposit: [owner(s), market(w), portfolio(w), ownerAta(w), vaultAta(w), tokenProgram]. */
export function ixDeposit(
  owner: PublicKey,
  market: PublicKey,
  portfolio: PublicKey,
  ownerAta: PublicKey,
  vaultAta: PublicKey,
  amount: bigint,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: PERCOLATOR_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: portfolio, isSigner: false, isWritable: true },
      { pubkey: ownerAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(
      concat([new Uint8Array([TAG_DEPOSIT]), u128le(amount)]),
    ),
  });
}

/** Portfolio `capital` (u128) lives at a fixed offset; enough for a balance read. */
export const PORTFOLIO_STATE_OFF = 16;
export const PA_CAPITAL = 132;
export const PA_PNL = 148;

export function readU128(data: Uint8Array, off: number): bigint {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return dv.getBigUint64(off, true) + (dv.getBigUint64(off + 8, true) << 64n);
}

export function readI128(data: Uint8Array, off: number): bigint {
  const v = readU128(data, off);
  return v >= 1n << 127n ? v - (1n << 128n) : v;
}
