import "server-only";

import { Connection, PublicKey } from "@solana/web3.js";
import { listMarkets, type Trade } from "@/lib/server/data";
import { notionalAtoms, PERCOLATOR_PROGRAM_ID } from "@/lib/server/percolator";

/**
 * Turn a transaction signature into a trade record we are willing to store.
 *
 * Nothing a browser says about its own history is trusted. The signature is
 * fetched from devnet and the stored row is derived from the confirmed
 * instruction bytes: the side from the sign of `sizeQ`, the notional and the
 * price from the instruction itself. A caller can therefore only ever claim a
 * trade that actually happened, between the exact accounts it names.
 *
 * Shared by `/api/trades` and `/api/hedge`, so there is one copy of this check
 * rather than two that can drift apart.
 */

/** A rejection with the status the route should return. */
export class TradeVerificationError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "TradeVerificationError";
  }
}

export interface VerifyInput {
  signature: string;
  wallet: PublicKey;
  portfolio: PublicKey;
  marketId: string | undefined;
  action: "open" | "close";
  leverage: number;
}

/** Devnet only: a history row must never describe a mainnet transaction. */
export function devnetConnection(): Connection {
  const rpc =
    process.env.SOLANA_RPC_URL ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    "https://api.devnet.solana.com";
  if (!/devnet/i.test(rpc)) throw new Error("Trade history refuses a non-devnet RPC");
  return new Connection(rpc, "confirmed");
}

const readI128 = (data: Uint8Array, offset: number): bigint => {
  const bytes = Buffer.from(data);
  const value = bytes.readBigUInt64LE(offset) + (bytes.readBigUInt64LE(offset + 8) << 64n);
  return value >= 1n << 127n ? value - (1n << 128n) : value;
};

export async function verifyTrade(input: VerifyInput): Promise<Trade> {
  const market = (await listMarkets()).find((entry) => entry.id === input.marketId);
  if (!market?.liquidityVault) {
    throw new TradeVerificationError("Unknown or unconfigured market", 404);
  }

  const tx = await devnetConnection().getTransaction(input.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || tx.meta?.err) throw new TradeVerificationError("Transaction is missing or failed");

  const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
  const instruction = tx.transaction.message.compiledInstructions.find(
    (entry) => keys[entry.programIdIndex]?.equals(PERCOLATOR_PROGRAM_ID) && entry.data[0] === 6,
  );
  if (!instruction) throw new TradeVerificationError("Transaction has no Percolator trade");

  // Account order is fixed by the instruction, so matching it positionally
  // proves the trade was between this user and this market's own vault.
  const accounts = instruction.accountKeyIndexes.map((index) => keys[index]!.toBase58());
  const expected = [
    input.wallet.toBase58(),
    market.liquidityVault.authority,
    market.market,
    input.portfolio.toBase58(),
    market.liquidityVault.portfolio,
  ];
  if (expected.some((address, index) => accounts[index] !== address)) {
    throw new TradeVerificationError("Transaction accounts do not match this trade");
  }

  const data = Buffer.from(instruction.data);
  if (data.readUInt16LE(1) !== 0) throw new TradeVerificationError("Unsupported asset index");
  const sizeQ = readI128(data, 3);
  const priceE6 = data.readBigUInt64LE(19);

  // On an open the sign of `sizeQ` *is* the side; on a close it is the inverse,
  // because a close is the exact reverse of the leg it settles. Either way the
  // stored side is the side of the position, not of the instruction.
  const side = input.action === "open" ? (sizeQ > 0n ? "long" : "short") : sizeQ < 0n ? "long" : "short";

  return {
    marketId: market.id,
    wallet: input.wallet.toBase58(),
    side,
    action: input.action,
    sizeUsdc: Number(notionalAtoms(sizeQ, priceE6)) / 1e6,
    leverage: input.leverage,
    price: Number(priceE6) / 1e6,
    txSignature: input.signature,
    ts: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : new Date().toISOString(),
  };
}
