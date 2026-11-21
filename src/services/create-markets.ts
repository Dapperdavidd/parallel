/**
 * F3 — the 13 launch markets on devnet.
 *
 * "All 13 launch markets exist with the correct unit, collateral mint and
 * oracle authority."
 *
 * One Percolator market per currency, every one sharing the mock-USDC mint
 * spike 1 created, every one with our oracle wallet as its AuthMark authority,
 * and every one opened at its live street price so the first push is a nudge
 * rather than a jump.
 *
 * The run is idempotent: a market already in the registry is verified and
 * skipped, so this is safe to re-run after a partial failure.
 *
 *   npm run markets:create                 # all 13
 *   npm run markets:create -- USD/NGN      # one
 *   npm run markets:create -- --dry-run    # price and cost, no transactions
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PERCOLATOR_PROGRAM_ID,
  ensureFunded,
  getConnection,
  loadOrCreateWallet,
  nowSlot,
  send,
} from "../lib/solana.js";
import {
  assetSlotOffset,
  buildMarketParams,
  encConfigureAuthMark,
  ixAuthMark,
  ixInitMarket,
  marketAccountLenFor,
  readAssetControlSequences,
  vaultAuthority,
  ORACLE_MODE,
  MAX_ABS_FUNDING_E9_PER_SLOT,
  type AuthMarkWire,
} from "../lib/percolator.js";
import { parseAsset, parseAssetOracleProfile } from "../vendor/percolator-v16/index.js";
import { LAUNCH_MARKETS, getMarket, type MarketDef } from "../lib/markets.js";
import { fetchOfficialRates, readSource, sourcesFor } from "../lib/sources.js";
import { computeIndex } from "../lib/index-math.js";
import { openStore, type MarketRow } from "../lib/store/index.js";

const DIM = "\x1b[2m", OFF = "\x1b[0m", GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m";

/** Committed, so the app and keeper can find the markets without a database. */
export const REGISTRY_PATH = "market-registry.json";
const SPIKE_STATE = "out/parallel-devnet.json";

export interface RegistryEntry {
  id: string;
  currency: string;
  unit: number;
  unitLabel: string;
  status: string;
  maxLeverage: number;
  market: string;
  vault: string;
  assetIndex: number;
  authMarkWire: AuthMarkWire;
  initialPriceE6: string;
  createdAt: string;
}

export interface Registry {
  network: "devnet";
  percolatorProgram: string;
  collateralMint: string;
  oracleAuthority: string;
  markets: RegistryEntry[];
}

export function loadRegistry(): Registry | null {
  if (!existsSync(REGISTRY_PATH)) return null;
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as Registry;
}

const saveRegistry = (r: Registry): void =>
  writeFileSync(REGISTRY_PATH, `${JSON.stringify(r, null, 2)}\n`);

const toE6 = (usd: number): bigint => BigInt(Math.round(usd * 1_000_000));

/** The live unit price, so a new market opens at the real street rate. */
async function liveUnitPrice(
  market: MarketDef,
  official: Record<string, number>,
): Promise<{ usd: number; median: number; sources: string[] }> {
  const readings = await Promise.all(sourcesFor(market.id).map((s) => readSource(s)));
  const tick = computeIndex(market, readings, official[market.currency.toLowerCase()] ?? null);
  if (tick.unitPriceUsd === null || tick.median === null) {
    throw new Error(`cannot price ${market.id}: ${tick.reason ?? tick.status}`);
  }
  return { usd: tick.unitPriceUsd, median: tick.median, sources: tick.sourcesUsed };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const ids = argv.filter((a) => !a.startsWith("--"));
  const wanted = ids.length > 0 ? ids.map(getMarket) : [...LAUNCH_MARKETS];

  const conn = getConnection();
  const admin = loadOrCreateWallet("oracle-authority");

  // The mock USDC mint from spike 1 is the collateral for every market: one
  // mint means one balance for the user across all thirteen.
  if (!existsSync(SPIKE_STATE)) {
    throw new Error(`${SPIKE_STATE} is missing — run \`npm run spike1\` first`);
  }
  const spike = JSON.parse(readFileSync(SPIKE_STATE, "utf8")) as { collateralMint?: string };
  if (!spike.collateralMint) throw new Error("no collateralMint in the spike state");
  const mint = new PublicKey(spike.collateralMint);

  const registry: Registry = loadRegistry() ?? {
    network: "devnet",
    percolatorProgram: PERCOLATOR_PROGRAM_ID.toBase58(),
    collateralMint: mint.toBase58(),
    oracleAuthority: admin.publicKey.toBase58(),
    markets: [],
  };
  const have = new Map(registry.markets.map((m) => [m.id, m]));

  console.log(`\n${DIM}Parallel — create the launch markets on devnet${OFF}`);
  console.log(`${DIM}collateral ${mint.toBase58()} · oracle ${admin.publicKey.toBase58()}${OFF}`);
  console.log(
    `${DIM}funding cap ${MAX_ABS_FUNDING_E9_PER_SLOT} e9/slot ` +
      `(~${((Number(MAX_ABS_FUNDING_E9_PER_SLOT) / 1e9) * 9000 * 100).toFixed(3)}%/hour max)${OFF}\n`,
  );

  // Price everything first: a market that cannot be priced must not be created
  // at a made-up mark, and knowing the full cost up front beats finding out
  // halfway through.
  let official: Record<string, number> = {};
  try {
    official = (await fetchOfficialRates()).rates;
  } catch {
    console.log(`${YELLOW}official rates unavailable — the ±15% band is skipped this run${OFF}`);
  }

  const space = marketAccountLenFor(1);
  const rent = await conn.getMinimumBalanceForRentExemption(space);
  const todo = wanted.filter((m) => !have.has(m.id));
  console.log(
    `${todo.length} to create, ${wanted.length - todo.length} already in the registry · ` +
      `rent ${(rent / 1e9).toFixed(5)} SOL each ≈ ${((rent * todo.length) / 1e9).toFixed(4)} SOL\n`,
  );

  const balance = (await conn.getBalance(admin.publicKey)) / 1e9;
  const needed = (rent * todo.length) / 1e9 + 0.02 * todo.length;
  if (balance < needed) {
    console.error(
      `${RED}oracle wallet holds ${balance.toFixed(4)} SOL, needs about ${needed.toFixed(4)}.${OFF}\n` +
        `Fund it with:  solana transfer ${admin.publicKey.toBase58()} ${(needed - balance + 0.05).toFixed(2)} --url devnet --allow-unfunded-recipient\n`,
    );
    process.exitCode = 1;
    return;
  }

  const created: RegistryEntry[] = [];

  for (const def of wanted) {
    const existing = have.get(def.id);
    if (existing) {
      console.log(`${def.id.padEnd(9)} ${DIM}already created · ${existing.market}${OFF}`);
      continue;
    }

    let price: { usd: number; median: number; sources: string[] };
    try {
      price = await liveUnitPrice(def, official);
    } catch (err) {
      console.log(`${def.id.padEnd(9)} ${RED}skipped${OFF} ${err instanceof Error ? err.message : err}`);
      continue;
    }

    const initialPriceE6 = toE6(price.usd);
    console.log(
      `${def.id.padEnd(9)} ${price.median.toFixed(2)} ${def.currency}/USD → ` +
        `1 ${def.unitLabel} = $${price.usd.toFixed(6)} ${DIM}(${price.sources.join(", ")})${OFF}`,
    );

    if (dryRun) continue;

    // Percolator wants maintenance margin at or below initial. Beta markets
    // are 2x (5_000 bps initial), live are 5x (2_000 bps); half of initial
    // clears the engine's floor of 245 bps in both cases.
    const params = buildMarketParams({
      initialPriceE6,
      maxLeverage: def.maxLeverage,
      maxAbsFundingE9PerSlot: MAX_ABS_FUNDING_E9_PER_SLOT,
    });

    const kp = Keypair.generate();
    const vaultAuth = vaultAuthority(kp.publicKey);
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultAuth, true);

    const ixs: TransactionInstruction[] = [
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: kp.publicKey,
        lamports: rent,
        space,
        programId: PERCOLATOR_PROGRAM_ID,
      }),
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey, vaultAta, vaultAuth, mint, TOKEN_PROGRAM_ID,
      ),
      ixInitMarket(admin.publicKey, kp.publicKey, mint, params),
    ];

    try {
      await send(conn, [admin, kp], ixs, { label: `InitMarket ${def.id}` });
    } catch (err) {
      console.log(`${" ".repeat(10)}${RED}InitMarket failed: ${err instanceof Error ? err.message : err}${OFF}`);
      continue;
    }

    // AUTH_MARK, so our index drives the price. Spike 1 established that this
    // deployment takes the short wire; try it first and fall back rather than
    // assume.
    const info = await conn.getAccountInfo(kp.publicKey, "confirmed");
    if (!info) {
      console.log(`${" ".repeat(10)}${RED}market account vanished${OFF}`);
      continue;
    }
    const asset0 = parseAsset(info.data, assetSlotOffset(0), 0);
    const seqs = readAssetControlSequences(info.data, 0);

    let wire: AuthMarkWire | null = null;
    for (const candidate of ["short", "long"] as const) {
      try {
        await send(
          conn,
          [admin],
          [
            ixAuthMark(
              admin.publicKey,
              kp.publicKey,
              encConfigureAuthMark(
                {
                  assetIndex: 0,
                  marketId: asset0.marketId,
                  nowSlot: await nowSlot(conn),
                  initialMarkE6: initialPriceE6,
                  observationSequence: seqs.oracleObservation + 1n,
                  authorityEpoch: seqs.authorityEpoch,
                },
                candidate,
              ),
            ),
          ],
          { label: `ConfigureAuthMark ${def.id} (${candidate})` },
        );
        wire = candidate;
        break;
      } catch {
        /* try the other wire */
      }
    }

    if (!wire) {
      console.log(`${" ".repeat(10)}${RED}neither AuthMark wire accepted — market left in Manual mode${OFF}`);
      continue;
    }

    // Verify rather than assume: read the profile back.
    const after = await conn.getAccountInfo(kp.publicKey, "confirmed");
    const profile = parseAssetOracleProfile(after!.data, assetSlotOffset(0), 0);
    const ok =
      profile.oracleMode === ORACLE_MODE.AuthMark &&
      profile.oracleAuthority.equals(admin.publicKey);
    if (!ok) {
      console.log(`${" ".repeat(10)}${RED}verification failed: mode ${profile.oracleMode}${OFF}`);
      continue;
    }

    const entry: RegistryEntry = {
      id: def.id,
      currency: def.currency,
      unit: def.unitSize,
      unitLabel: def.unitLabel,
      status: def.status,
      maxLeverage: def.maxLeverage,
      market: kp.publicKey.toBase58(),
      vault: vaultAta.toBase58(),
      assetIndex: 0,
      authMarkWire: wire,
      initialPriceE6: initialPriceE6.toString(),
      createdAt: new Date().toISOString(),
    };
    registry.markets.push(entry);
    created.push(entry);
    saveRegistry(registry); // after every market, so a crash loses nothing
    console.log(
      `${" ".repeat(10)}${GREEN}created${OFF} ${entry.market} ${DIM}vault ${entry.vault} · ${wire} wire${OFF}`,
    );
  }

  if (dryRun) {
    console.log(`\n${DIM}dry run — nothing was created${OFF}\n`);
    return;
  }

  // Mirror the registry into the store, so the app reads markets from one place.
  const store = openStore();
  const rows: MarketRow[] = registry.markets.map((m) => {
    const def = getMarket(m.id);
    return {
      id: m.id,
      currency: m.currency,
      symbol: m.id,
      unit: m.unit,
      unitLabel: m.unitLabel,
      status: def.status === "live" ? "live" : def.status === "beta" ? "beta" : "stretch",
      region: def.region,
      maxLeverage: m.maxLeverage,
      slabPubkey: m.market,
      vaultPubkey: m.vault,
    };
  });
  await store.upsertMarkets(rows);
  await store.close();

  console.log(
    `\n${created.length} created this run · ${registry.markets.length}/${LAUNCH_MARKETS.length} markets live`,
  );
  console.log(`${DIM}registry: ${REGISTRY_PATH} · store: ${store.name}${OFF}\n`);
  if (registry.markets.length < LAUNCH_MARKETS.length) process.exitCode = 1;
}

mkdirSync("out", { recursive: true });
main().catch((err) => {
  console.error("create-markets failed:", err);
  process.exit(1);
});
