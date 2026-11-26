import "server-only";

import { Connection } from "@solana/web3.js";
import { listMarkets, type Trade } from "@/lib/server/data";
import { rpcUrl } from "@/lib/server/env";
import { notionalAtoms, PERCOLATOR_PROGRAM_ID } from "@/lib/server/percolator";
import type { QuotePayload } from "@/lib/server/quotes";
import { Rejection } from "@/lib/server/respond";
import { sideOf } from "@/lib/side";

/**
 * Turn a signature plus the quote it came from into a row we will store.
 *
 * Two independent accounts of the same trade have to agree before anything is
 * written. The **quote** is what this server decided moments earlier — size,
 * price, leverage, which portfolio, which market — signed so it cannot have
 * been edited in the browser. The **transaction** is what devnet confirmed.
 *
 * Checking them against each other closes the gap that was left before: the
 * instruction was verified, but `leverage` was whatever the client claimed,
 * and a client could pair a real signature with any leverage it liked. Now
 * every stored field comes from one side or the other, and none from the
 * caller.
 */

export class TradeVerificationError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "TradeVerificationError";
  }
}

/** Devnet only: a history row must never describe a mainnet transaction. */
export const devnetConnection = (): Connection => new Connection(rpcUrl(), "confirmed");

const readI128 = (data: Uint8Array, offset: number): bigint => {
  const bytes = Buffer.from(data);
  const value = bytes.readBigUInt64LE(offset) + (bytes.readBigUInt64LE(offset + 8) << 64n);
  return value >= 1n << 127n ? value - (1n << 128n) : value;
};

export async function verifyTrade(input: {
  signature: string;
  quote: QuotePayload;
}): Promise<Trade> {
  const { quote } = input;
  const market = (await listMarkets()).find((entry) => entry.id === quote.marketId);
  if (!market?.liquidityVault) {
    throw new Rejection("not_found", "That market is no longer configured");
  }

  // The RPC throws for a signature it cannot even parse, which is the
  // caller's mistake rather than ours and should read as one.
  let tx;
  try {
    tx = await devnetConnection().getTransaction(input.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch (error) {
    throw new Rejection("conflict", "Devnet does not recognise that transaction signature", {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  if (!tx) {
    throw new Rejection(
      "conflict",
      "Devnet has not confirmed that transaction yet. It will appear once it does.",
    );
  }
  if (tx.meta?.err) throw new Rejection("conflict", "That transaction failed on devnet");

  const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
  const instruction = tx.transaction.message.compiledInstructions.find(
    (entry) => keys[entry.programIdIndex]?.equals(PERCOLATOR_PROGRAM_ID) && entry.data[0] === 6,
  );
  if (!instruction) throw new Rejection("conflict", "That transaction is not a Percolator trade");

  // Account order is fixed by the instruction, so matching it positionally
  // proves the trade was between this wallet and this market's own vault.
  const accounts = instruction.accountKeyIndexes.map((index) => keys[index]!.toBase58());
  const expected = [
    quote.wallet,
    market.liquidityVault.authority,
    market.market,
    quote.portfolio,
    market.liquidityVault.portfolio,
  ];
  if (expected.some((account, index) => accounts[index] !== account)) {
    throw new Rejection("conflict", "That transaction does not match the trade it is filed as");
  }

  const data = Buffer.from(instruction.data);
  if (data.readUInt16LE(1) !== market.assetIndex) {
    throw new Rejection("conflict", "That transaction trades a different asset");
  }
  const sizeQ = readI128(data, 3);
  const priceE6 = data.readBigUInt64LE(19);

  // The chain must carry exactly what the quote promised. A mismatch means the
  // transaction was built somewhere other than this server.
  if (sizeQ.toString() !== quote.sizeQ) {
    throw new Rejection("conflict", "That transaction is a different size than the quote");
  }
  if (priceE6.toString() !== quote.priceE6) {
    throw new Rejection("conflict", "That transaction was priced differently than the quote");
  }

  // The stored side is the side of the *position*, in the user-facing
  // convention (`lib/side.ts`). A close is the exact reverse of the leg it
  // settles, so its instruction sign is negated before being read back.
  const side = sideOf(quote.action === "open" ? sizeQ : -sizeQ);
  if (side !== quote.side) {
    throw new Rejection("conflict", "That transaction is on the other side of the market");
  }

  return {
    marketId: market.id,
    wallet: quote.wallet,
    side,
    action: quote.action,
    sizeUsdc: Number(notionalAtoms(sizeQ, priceE6)) / 1e6,
    leverage: quote.leverage,
    price: Number(priceE6) / 1e6,
    txSignature: input.signature,
    ts: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : new Date().toISOString(),
  };
}
