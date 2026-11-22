/**
 * F2 and F8 — the oracle push and the crank.
 *
 *   F2  "Median pushed when it moves more than 0.1% or 10 minutes pass;
 *        failed or paused markets stop accepting new positions."
 *   F8  "Funding and liquidations run on schedule."
 *
 * One loop does both, because they share the same cadence and the same
 * authority key: every two minutes it runs the index, pushes the markets that
 * the rule says should move, and cranks so funding and liquidations settle.
 *
 * Three things this deliberately does NOT do:
 *
 *   - It never pushes a paused market. A market that lost its sources keeps
 *     its last mark; the engine's own staleness handling takes over. Pushing a
 *     guessed price would be the one failure mode the index exists to prevent.
 *   - It never pushes a price it did not compute this pass. Stale is better
 *     than invented.
 *   - It does not crank a market with no open interest. There is nothing to
 *     settle and the engine answers EngineNonProgress, which would fill the
 *     log with noise that looks like failure.
 *
 *   npm run keeper              # one pass
 *   npm run keeper -- --loop
 *   npm run keeper -- --loop --every=120
 */

import { PublicKey } from "@solana/web3.js";
import {
  getAccountData,
  getConnection,
  loadOrCreateWallet,
  nowSlot,
  send,
} from "../lib/solana.js";
import {
  assetEngineOffset,
  assetSlotOffset,
  encPushAuthMark,
  ixAuthMark,
  ixCrank,
  readAssetControlSequences,
} from "../lib/percolator.js";
import { PERCOLATOR_PROGRAM_ID } from "../lib/solana.js";
import { PORTFOLIO_ACCOUNT_LEN } from "../vendor/percolator-v16/constants.js";
import { parseAsset, parseAssetOracleProfile } from "../vendor/percolator-v16/index.js";
import { getMarket } from "../lib/markets.js";
import { shouldPush, type IndexTick } from "../lib/index-math.js";
import { openStore, type Store } from "../lib/store/index.js";
import { runOnce, rollAllCandles, TICK_INTERVAL_MS } from "./index-service.js";
import { loadRegistry, type RegistryEntry } from "../lib/registry.js";

const DIM = "\x1b[2m", OFF = "\x1b[0m", GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m";

const toE6 = (usd: number): bigint => BigInt(Math.round(usd * 1_000_000));

export interface PushOutcome {
  market: string;
  pushed: boolean;
  reason: string;
  signature?: string;
  slot?: number;
  error?: string;
}

/**
 * Push one market's price, if the rule says to.
 *
 * The observation sequence has to be read immediately before sending: another
 * push (a retry that actually landed, say) moves it, and a stale sequence is
 * rejected by the program rather than silently applied.
 */
export async function pushMarket(
  conn: ReturnType<typeof getConnection>,
  admin: ReturnType<typeof loadOrCreateWallet>,
  entry: RegistryEntry,
  tick: IndexTick,
  store: Store,
): Promise<PushOutcome> {
  const last = await store.lastPush(entry.id);
  const decision = shouldPush(tick, last);
  if (!decision.push) {
    return { market: entry.id, pushed: false, reason: decision.reason };
  }

  const market = new PublicKey(entry.market);
  const data = await getAccountData(conn, market);
  const asset = parseAsset(data, assetEngineOffset(entry.assetIndex), entry.assetIndex);
  const seqs = readAssetControlSequences(data, entry.assetIndex);
  const slot = await nowSlot(conn);

  try {
    const sig = await send(
      conn,
      [admin],
      [
        ixAuthMark(
          admin.publicKey,
          market,
          encPushAuthMark(
            {
              assetIndex: entry.assetIndex,
              marketId: asset.marketId,
              nowSlot: slot,
              markE6: toE6(tick.unitPriceUsd!),
              observationSequence: seqs.oracleObservation + 1n,
              authorityEpoch: seqs.authorityEpoch,
            },
            entry.authMarkWire,
          ),
        ),
      ],
      { label: `PushAuthMark ${entry.id}` },
    );
    await store.markPushed(entry.id, tick.ts, String(sig), Number(slot));
    return {
      market: entry.id,
      pushed: true,
      reason: decision.reason,
      signature: String(sig),
      slot: Number(slot),
    };
  } catch (err) {
    return {
      market: entry.id,
      pushed: false,
      reason: decision.reason,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Crank a market so funding and liquidations settle.
 *
 * A crank progresses exactly one portfolio, so the caller supplies which. With
 * no open interest there is nothing to progress and the engine says so; that
 * is reported as "idle", not as an error.
 */
export async function crankMarket(
  conn: ReturnType<typeof getConnection>,
  admin: ReturnType<typeof loadOrCreateWallet>,
  entry: RegistryEntry,
  portfolios: PublicKey[],
): Promise<{ cranked: number; idle: number }> {
  const market = new PublicKey(entry.market);
  const data = await getAccountData(conn, market);
  const asset = parseAsset(data, assetEngineOffset(entry.assetIndex), entry.assetIndex);

  // Nothing open means nothing to settle.
  if (asset.oiEffLongQ === 0n && asset.oiEffShortQ === 0n) {
    return { cranked: 0, idle: portfolios.length };
  }

  let cranked = 0;
  let idle = 0;
  for (const pf of portfolios) {
    try {
      await send(conn, [admin], [ixCrank(admin.publicKey, market, pf, { nowSlot: await nowSlot(conn) })], {
        label: `Crank ${entry.id}`,
      });
      cranked += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/custom program error: 0x17\b/i.test(message)) {
        idle += 1;
      } else {
        throw err;
      }
    }
  }
  return { cranked, idle };
}

/** Find every Percolator portfolio bound to this market group. */
export async function discoverMarketPortfolios(
  conn: ReturnType<typeof getConnection>,
  entry: RegistryEntry,
): Promise<PublicKey[]> {
  const accounts = await conn.getProgramAccounts(PERCOLATOR_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { dataSize: PORTFOLIO_ACCOUNT_LEN },
      { memcmp: { offset: 16, bytes: entry.market } },
    ],
  });
  return accounts.map((account) => account.pubkey);
}

async function hasOpenInterest(
  conn: ReturnType<typeof getConnection>,
  entry: RegistryEntry,
): Promise<boolean> {
  const data = await getAccountData(conn, new PublicKey(entry.market));
  const asset = parseAsset(data, assetEngineOffset(entry.assetIndex), entry.assetIndex);
  return asset.oiEffLongQ !== 0n || asset.oiEffShortQ !== 0n;
}

/** Is this market currently accepting new positions? F2's second half. */
export function acceptingPositions(tick: IndexTick | null): boolean {
  return tick !== null && tick.status === "ok";
}

/* ------------------------------------------------------------------ CLI -- */

async function pass(
  conn: ReturnType<typeof getConnection>,
  admin: ReturnType<typeof loadOrCreateWallet>,
  store: Store,
  registry: NonNullable<ReturnType<typeof loadRegistry>>,
): Promise<void> {
  const defs = registry.markets.map((m) => getMarket(m.id));
  const res = await runOnce(store, defs);
  await rollAllCandles(store, defs);

  console.log(`${DIM}── ${new Date().toISOString()} · index ${res.elapsedMs} ms ──${OFF}`);

  for (const entry of registry.markets) {
    const tick = res.ticks.find((t) => t.market === entry.id);
    if (!tick) continue;

    if (tick.status !== "ok") {
      // Not a failure of ours: the market pauses by design and keeps its mark.
      console.log(
        `${entry.id.padEnd(9)} ${YELLOW}paused${OFF}  ${DIM}${tick.reason ?? tick.status} · ` +
          `no push, no new positions${OFF}`,
      );
    } else {
      const out = await pushMarket(conn, admin, entry, tick, store);
      if (out.error) {
        console.log(`${entry.id.padEnd(9)} ${RED}push failed${OFF} ${DIM}${out.error}${OFF}`);
      } else if (out.pushed) {
        console.log(
          `${entry.id.padEnd(9)} ${GREEN}pushed${OFF}  $${tick.unitPriceUsd!.toFixed(6)} ` +
            `${DIM}${out.reason} · slot ${out.slot}${OFF}`,
        );
      } else {
        console.log(`${entry.id.padEnd(9)} ${DIM}held    ${out.reason}${OFF}`);
      }
    }

    // Cranking is independent of whether this pass produced a safe new mark.
    // A paused index must not freeze funding or an already-eligible liquidation.
    try {
      if (await hasOpenInterest(conn, entry)) {
        const portfolios = await discoverMarketPortfolios(conn, entry);
        const result = await crankMarket(conn, admin, entry, portfolios);
        console.log(
          `${entry.id.padEnd(9)} ${GREEN}cranked${OFF} ${result.cranked}/${portfolios.length} ` +
            `${DIM}${result.idle} idle${OFF}`,
        );
      }
    } catch (err) {
      console.log(
        `${entry.id.padEnd(9)} ${RED}crank failed${OFF} ` +
          `${DIM}${err instanceof Error ? err.message : String(err)}${OFF}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const loop = argv.includes("--loop");
  const everyArg = argv.find((a) => a.startsWith("--every="));
  const everyMs = everyArg ? Number(everyArg.slice(8)) * 1000 : TICK_INTERVAL_MS;

  const registry = loadRegistry();
  if (!registry || registry.markets.length === 0) {
    console.error("no markets — run `npm run markets:create` first");
    process.exit(1);
  }

  const conn = getConnection();
  const admin = loadOrCreateWallet("oracle-authority");
  const store = openStore();

  console.log(`\n${DIM}Parallel — keeper · store: ${store.name}${OFF}`);
  console.log(
    `${DIM}${registry.markets.length} market(s) · oracle ${admin.publicKey.toBase58()} · ` +
      `${loop ? `every ${everyMs / 1000}s` : "single pass"}${OFF}\n`,
  );

  // Verify we actually hold the authority before trying to push with it.
  const first = registry.markets[0]!;
  const data = await getAccountData(conn, new PublicKey(first.market));
  const profile = parseAssetOracleProfile(data, assetSlotOffset(first.assetIndex), first.assetIndex);
  if (!profile.oracleAuthority.equals(admin.publicKey)) {
    console.error(
      `${RED}oracle authority mismatch: market expects ${profile.oracleAuthority.toBase58()}, ` +
        `wallet is ${admin.publicKey.toBase58()}${OFF}`,
    );
    process.exit(1);
  }

  let stopping = false;
  const onSignal = (): void => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log(`\n${DIM}finishing this pass, then stopping…${OFF}`);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  for (;;) {
    try {
      await pass(conn, admin, store, registry);
    } catch (err) {
      // A bad pass must not kill the keeper: the next one is two minutes away.
      console.error(`${RED}pass failed:${OFF} ${err instanceof Error ? err.message : err}`);
    }
    if (!loop || stopping) break;
    await new Promise((r) => setTimeout(r, everyMs));
    if (stopping) break;
  }

  await store.close();
  console.log();
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (invokedDirectly) {
  main().catch((err) => {
    console.error("keeper failed:", err);
    process.exit(1);
  });
}
