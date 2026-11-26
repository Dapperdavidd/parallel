/**
 * What the liquidity signer is willing to sign.
 *
 * Kept apart from the service so it can be tested as a pure function of the
 * bytes: every refusal below is a transaction shape that, if signed, would let
 * a compromised web app do something the signer exists to prevent.
 */

import { Message, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import type { Registry } from "./registry.js";

export const COMPUTE_BUDGET = new PublicKey("ComputeBudget111111111111111111111111111111");
/** Percolator's trade instruction tag. */
export const TRADE_TAG = 6;

interface Allowed {
  /** Percolator market account. */
  market: string;
  /** Parallel's own counterparty portfolio on that market. */
  portfolio: string;
  authority: string;
}

function allowedFor(registry: Registry, authority: string): Allowed[] {
  return registry.markets.flatMap((market) =>
    market.liquidityVault && market.currency === authority
      ? [
          {
            market: market.market,
            portfolio: market.liquidityVault.portfolio,
            authority: market.liquidityVault.authority,
          },
        ]
      : [],
  );
}

/**
 * Decide whether this message is a trade we are willing to sign.
 *
 * Returns the reason for refusal, or null when it passes. Every check is on
 * the bytes themselves — nothing in the request body is taken as a claim
 * about what the message contains.
 */
export function refusalReason(
  messageBytes: Buffer,
  authority: string,
  registry: Registry,
): string | null {
  const allowed = allowedFor(registry, authority);
  if (allowed.length === 0) return `no market in the registry uses the ${authority} authority`;

  let message: Message;
  try {
    message = Message.from(messageBytes);
  } catch {
    return "the message does not parse as a Solana transaction";
  }

  const program = new PublicKey(registry.percolatorProgram);
  const keys = message.accountKeys.map((key) => key.toBase58());
  const authorityKey = allowed[0]!.authority;

  const authorityIndex = keys.indexOf(authorityKey);
  if (authorityIndex < 0) return "the message does not include this authority";
  if (authorityIndex === 0) return "this authority may not be the fee payer";
  if (message.isAccountWritable(authorityIndex)) {
    return "this authority may not be writable in a trade";
  }

  const trades = [] as { accounts: string[]; data: Buffer }[];
  for (const instruction of message.instructions) {
    const programId = keys[instruction.programIdIndex];
    if (programId === COMPUTE_BUDGET.toBase58()) continue;
    if (programId !== program.toBase58()) return `unexpected program ${programId}`;
    // A compiled instruction's data is base58 in web3.js, not base64.
    trades.push({
      accounts: instruction.accounts.map((index) => keys[index]!),
      data: Buffer.from(bs58.decode(instruction.data)),
    });
  }
  if (trades.length !== 1) return `expected exactly one Percolator instruction, found ${trades.length}`;

  const trade = trades[0]!;
  if (trade.data[0] !== TRADE_TAG) return `Percolator instruction ${trade.data[0]} is not a trade`;
  if (trade.accounts.length < 5) return "the trade instruction is missing accounts";
  if (trade.accounts[1] !== authorityKey) return "the trade does not name this authority as the vault signer";

  const match = allowed.find(
    (entry) => entry.market === trade.accounts[2] && entry.portfolio === trade.accounts[4],
  );
  if (!match) return "the market and vault portfolio do not match the registry";
  return null;
}

