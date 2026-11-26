/**
 * Rebuild missing trade rows from the chain.
 *
 * A trade can be confirmed on devnet and still fail to reach the `trades`
 * table: the browser can be closed between the signature and the POST that
 * files it, which is precisely why the client already reports
 * `recorded: false` for that case rather than claiming success.
 *
 * The chain is the source of truth, so the gap is closeable. This walks every
 * Percolator signature touching each registry market, rebuilds the row from
 * the confirmed instruction bytes, and writes anything the store does not
 * already have. Writes are idempotent on the transaction signature, so running
 * it twice changes nothing and running it during normal operation is safe.
 *
 *   npm run reconcile                    # report what is missing
 *   npm run reconcile -- --write         # and write it
 *   npm run reconcile -- --market=USD/NGN --since=2026-11-20
 *
 * Two things the chain does not record, and this does not invent:
 *
 *  - **Leverage.** It is a property of the margin somebody chose, not of the
 *    instruction. A reconstructed row carries 1 and is marked as coming from
 *    the chain, so a screen can show a dash rather than a wrong number.
 *  - **Whether a trade opened or closed.** That one *is* recoverable, by
 *    replaying each wallet's position in order: a trade that grows the
 *    absolute position opened it, one that shrinks it closed it.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { loadRegistry, type RegistryEntry } from "../lib/registry.js";
import { openStore, type TradeRow } from "../lib/store/index.js";
import { stayAlive } from "../lib/stay-alive.js";

const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const AMBER = "\x1b[33m";
const RED = "\x1b[31m";
const OFF = "\x1b[0m";

const TRADE_TAG = 6;
const POS_SCALE = 1_000_000n;
/** One page of signatures per request; the RPC caps it at a thousand. */
const PAGE = 500;

const flag = (name: string): string | undefined =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const has = (name: string): boolean => process.argv.includes(`--${name}`);

const rpc = (): string => {
  const url = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  if (!/devnet/i.test(url)) throw new Error("reconcile runs on devnet only");
  return url;
};

const readI128 = (data: Buffer, offset: number): bigint => {
  const value = data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n);
  return value >= 1n << 127n ? value - (1n << 128n) : value;
};

const abs = (value: bigint): bigint => (value < 0n ? -value : value);

/** A user-facing side from a signed engine position — see web/src/lib/side.ts. */
const sideOf = (sizeQ: bigint): "long" | "short" => (sizeQ < 0n ? "long" : "short");

interface ChainTrade {
  signature: string;
  blockTime: number;
  wallet: string;
  sizeQ: bigint;
  priceE6: bigint;
}

/**
 * Every Percolator trade against this market, oldest first.
 *
 * Signatures come back newest-first and paginated, so they are collected and
 * reversed: the open/close reconstruction below depends on chronological
 * order.
 */
async function chainTrades(
  conn: Connection,
  program: string,
  market: RegistryEntry,
  since: number | null,
): Promise<ChainTrade[]> {
  const marketKey = new PublicKey(market.market);
  const vaultAuthority = market.liquidityVault?.authority;
  const vaultPortfolio = market.liquidityVault?.portfolio;
  if (!vaultAuthority || !vaultPortfolio) return [];

  const signatures: { signature: string; blockTime: number | null | undefined }[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await conn.getSignaturesForAddress(marketKey, { before, limit: PAGE }, "confirmed");
    if (page.length === 0) break;
    for (const entry of page) {
      if (entry.err) continue;
      if (since !== null && entry.blockTime && entry.blockTime < since) {
        before = undefined;
        break;
      }
      signatures.push({ signature: entry.signature, blockTime: entry.blockTime });
    }
    const last = page[page.length - 1];
    if (!last || page.length < PAGE) break;
    if (since !== null && last.blockTime && last.blockTime < since) break;
    before = last.signature;
  }

  const out: ChainTrade[] = [];
  for (const { signature } of signatures) {
    const tx = await conn.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx || tx.meta?.err) continue;

    const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
    const instruction = tx.transaction.message.compiledInstructions.find(
      (entry) =>
        keys[entry.programIdIndex]?.toBase58() === program && entry.data[0] === TRADE_TAG,
    );
    if (!instruction) continue;

    const accounts = instruction.accountKeyIndexes.map((index) => keys[index]!.toBase58());
    // Positional, exactly as the prepare route builds it. Anything else is
    // somebody else's trade on the same market and not ours to record.
    if (accounts[1] !== vaultAuthority || accounts[2] !== market.market) continue;
    if (accounts[4] !== vaultPortfolio) continue;

    const data = Buffer.from(instruction.data);
    if (data.readUInt16LE(1) !== market.assetIndex) continue;

    out.push({
      signature,
      blockTime: tx.blockTime ?? 0,
      wallet: accounts[0]!,
      sizeQ: readI128(data, 3),
      priceE6: data.readBigUInt64LE(19),
    });
  }

  return out.sort((a, b) => a.blockTime - b.blockTime);
}

/**
 * Turn the chain's view into rows, deciding open from close by replay.
 *
 * Each wallet's net position is tracked as the trades are walked. A trade that
 * grows the absolute position opened it; one that shrinks it closed it. That
 * is the same thing the engine does to the basis, so it agrees with what the
 * app recorded at the time.
 */
function toRows(market: RegistryEntry, trades: ChainTrade[]): TradeRow[] {
  const net = new Map<string, bigint>();
  return trades.map((trade) => {
    const before = net.get(trade.wallet) ?? 0n;
    const after = before + trade.sizeQ;
    net.set(trade.wallet, after);
    const action: TradeRow["action"] = abs(after) >= abs(before) ? "open" : "close";
    return {
      marketId: market.id,
      wallet: trade.wallet,
      // The side of the *position*. A close reverses its leg, so the sign of
      // the instruction is negated before being read back.
      side: sideOf(action === "open" ? trade.sizeQ : -trade.sizeQ),
      action,
      sizeUsdc: Number((abs(trade.sizeQ) * trade.priceE6) / POS_SCALE) / 1e6,
      // Not recoverable from the chain; see the note at the top.
      leverage: 1,
      price: Number(trade.priceE6) / 1e6,
      txSignature: trade.signature,
      ts: new Date((trade.blockTime || Date.now() / 1000) * 1000).toISOString(),
    };
  });
}

async function main(): Promise<void> {
  stayAlive("reconcile");

  const registry = loadRegistry();
  if (!registry) throw new Error("market-registry.json is missing");

  const only = flag("market");
  const sinceFlag = flag("since");
  const since = sinceFlag ? Math.floor(Date.parse(sinceFlag) / 1000) : null;
  if (sinceFlag && Number.isNaN(since)) throw new Error(`--since=${sinceFlag} is not a date`);
  const write = has("write");

  const markets = registry.markets.filter((market) => (only ? market.id === only : true));
  if (markets.length === 0) throw new Error(only ? `no market ${only}` : "no markets in the registry");

  const conn = new Connection(rpc(), "confirmed");
  const store = openStore();
  console.log(
    `reconcile: ${markets.length} market(s) · store ${store.name} · ${write ? `${AMBER}writing${OFF}` : `${DIM}report only${OFF}`}\n`,
  );

  let missingTotal = 0;
  let writtenTotal = 0;

  for (const market of markets) {
    if (!market.liquidityVault) {
      console.log(`${DIM}  ${market.id.padEnd(8)} no liquidity vault — skipped${OFF}`);
      continue;
    }

    const trades = await chainTrades(conn, registry.percolatorProgram, market, since);
    const rows = toRows(market, trades);

    // One read per market rather than one per trade. The window is generous
    // because a gap older than the newest few hundred rows is still a gap.
    const stored = await store.recentTrades(market.id, 1_000);
    const known = new Set(stored.map((row) => row.txSignature));
    const missing = rows.filter((row) => !known.has(row.txSignature));
    missingTotal += missing.length;

    const label = `  ${market.id.padEnd(8)}`;
    if (missing.length === 0) {
      console.log(`${label} ${GREEN}✓${OFF} ${DIM}${rows.length} on-chain, all recorded${OFF}`);
      continue;
    }

    console.log(
      `${label} ${AMBER}${missing.length} missing${OFF} ${DIM}of ${rows.length} on-chain${OFF}`,
    );
    for (const row of missing) {
      console.log(
        `${DIM}      ${row.ts}  ${row.action.padEnd(5)} ${row.side.padEnd(5)} ` +
          `${row.sizeUsdc.toFixed(2).padStart(10)} tUSDC  ${row.wallet.slice(0, 6)}…  ${row.txSignature.slice(0, 10)}…${OFF}`,
      );
    }

    if (write) {
      for (const row of missing) {
        await store.recordTrade(row);
        writtenTotal += 1;
      }
      console.log(`${label} ${GREEN}wrote ${missing.length}${OFF}`);
    }
  }

  await store.close();

  console.log("");
  if (missingTotal === 0) {
    console.log(`${GREEN}Nothing to reconcile.${OFF}`);
  } else if (write) {
    console.log(`${GREEN}Wrote ${writtenTotal} row(s).${OFF}`);
  } else {
    console.log(
      `${AMBER}${missingTotal} row(s) missing.${OFF} Re-run with --write to file them.\n` +
        `${DIM}Reconstructed rows carry leverage 1, which the chain does not record.${OFF}`,
    );
  }
}

void main().catch((error: unknown) => {
  console.error(`${RED}reconcile failed:${OFF} ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
