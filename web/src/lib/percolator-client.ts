"use client";

import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export const PERCOLATOR_PROGRAM_ID = new PublicKey(
  "ETx36xGKMcfnWEwap89NfMFkVYGgD7nbPZGa2FrJKhDM",
);
export const PORTFOLIO_ACCOUNT_LEN = 9411;
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const u128le = (value: bigint): Buffer => {
  const out = Buffer.alloc(16);
  out.writeBigUInt64LE(value & ((1n << 64n) - 1n), 0);
  out.writeBigUInt64LE(value >> 64n, 8);
  return out;
};

export function associatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  )[0];
}

export function initPortfolio(owner: PublicKey, market: PublicKey, portfolio: PublicKey) {
  return new TransactionInstruction({
    programId: PERCOLATOR_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: portfolio, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([1]),
  });
}

export function deposit(
  owner: PublicKey,
  market: PublicKey,
  portfolio: PublicKey,
  ownerAta: PublicKey,
  collateralVault: PublicKey,
  amount: bigint,
) {
  return new TransactionInstruction({
    programId: PERCOLATOR_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: portfolio, isSigner: false, isWritable: true },
      { pubkey: ownerAta, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([3]), u128le(amount)]),
  });
}
