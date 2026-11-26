/**
 * SPIKE 1 — create a Percolator market for the naira on devnet.
 *
 * Proves, or fails loudly:
 *   1. We can mint a 6-decimal mock USDC.
 *   2. We can create a Percolator v16 market with that mint as collateral.
 *   3. We can put asset 0 into AUTH_MARK mode with OUR wallet as oracle authority.
 *   4. Which AuthMark instruction wire the deployed program actually accepts —
 *      the 19-byte form the vendored TypeScript encodes, or the 43-byte form
 *      percolator-prog decodes. This is unknowable from source; see
 *      DECISIONS.md §3.14.
 *
 * It also reports the confirmed price scale and decimals, which the PRD asks
 * spike 1 to settle before market units are fixed.
 *
 *   npm run spike1
 *
 * State is written to out/parallel-devnet.json and reused on re-runs, so this
 * is safe to run repeatedly. Pass --fresh to build a brand-new market.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

import {
  getConnection,
  loadOrCreateWallet,
  ensureFunded,
  send,
  nowSlot,
  toE6,
  PERCOLATOR_PROGRAM_ID,
} from "../lib/solana.js";
import {
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
import { assetSlotOffset } from "../lib/percolator.js";
import { getMarket } from "../lib/markets.js";
import { sourcesFor, readSource, fetchOfficialRates } from "../lib/sources.js";
import { computeIndex } from "../lib/index-math.js";

const STATE_PATH = "out/parallel-devnet.json";
const MARKET_ID = "USD/NGN";
const DIM = "\x1b[2m", OFF = "\x1b[0m", GREEN = "\x1b[32m", RED = "\x1b[31m";

interface State {
  network: "devnet";
  percolatorProgram: string;
  collateralMint?: string;
  market?: string;
  marketAsset?: string;
  authMarkWire?: AuthMarkWire;
  fundingEnabled?: boolean;
  initialPriceE6?: string;
  createdAt?: string;
}

function loadState(): State {
  if (existsSync(STATE_PATH)) return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
  return { network: "devnet", percolatorProgram: PERCOLATOR_PROGRAM_ID.toBase58() };
}

function saveState(s: State): void {
  mkdirSync("out", { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

/** Live kNGN unit price, so the market starts at a realistic mark. */
async function liveUnitPriceUsd(): Promise<number> {
  const market = getMarket(MARKET_ID);
  const readings = await Promise.all(sourcesFor(MARKET_ID).map((s) => readSource(s)));
  let official: number | null = null;
  try {
    official = (await fetchOfficialRates()).rates[market.currency.toLowerCase()] ?? null;
  } catch {
    /* the band check is optional here */
  }
  const tick = computeIndex(market, readings, official);
  if (tick.unitPriceUsd === null) {
    throw new Error(`cannot price ${MARKET_ID}: ${tick.reason ?? tick.status}`);
  }
  console.log(
    `  ${MARKET_ID} median ${tick.median?.toFixed(2)} NGN/USD ` +
      `→ 1 ${market.unitLabel} = $${tick.unitPriceUsd.toFixed(6)} ` +
      `${DIM}(sources: ${tick.sourcesUsed.join(", ")})${OFF}`,
  );
  return tick.unitPriceUsd;
}

async function main(): Promise<void> {
  const fresh = process.argv.includes("--fresh");
  const withFunding = process.argv.includes("--with-funding");
  const conn = getConnection();
  // --fresh builds a new market (and therefore new portfolios, which are bound
  // to a market) but keeps the collateral mint, which is market-independent and
  // already holds balances.
  const prior = loadState();
  const state: State = fresh
    ? {
        network: "devnet",
        percolatorProgram: PERCOLATOR_PROGRAM_ID.toBase58(),
        collateralMint: prior.collateralMint,
        fundingEnabled: withFunding,
      }
    : prior;
  if (!fresh && withFunding !== Boolean(state.fundingEnabled)) {
    throw new Error("funding is immutable; rerun with --fresh --with-funding");
  }

  console.log(`\n${DIM}Parallel — spike 1: create a Percolator market for the naira${OFF}`);
  console.log(`${DIM}${new Date().toISOString()} · program ${PERCOLATOR_PROGRAM_ID.toBase58()}${OFF}\n`);

  // ---- 1. wallet ----
  console.log("1. wallet");
  const admin = loadOrCreateWallet("oracle-authority");
  const sol = await ensureFunded(conn, admin, 0.5, "oracle-authority");
  console.log(`  ${admin.publicKey.toBase58()} — ${sol.toFixed(4)} SOL\n`);

  // ---- 2. mock USDC, 6 decimals ----
  console.log("2. collateral mint (mock USDC, 6 decimals)");
  let mint: PublicKey;
  if (state.collateralMint) {
    mint = new PublicKey(state.collateralMint);
    console.log(`  reusing ${mint.toBase58()}`);
  } else {
    mint = await createMint(conn, admin, admin.publicKey, null, 6);
    state.collateralMint = mint.toBase58();
    saveState(state);
    console.log(`  created ${mint.toBase58()}`);
  }
  const mintInfo = await getMint(conn, mint);
  console.log(`  decimals ${mintInfo.decimals}, supply ${mintInfo.supply}`);
  if (mintInfo.decimals !== 6) throw new Error(`expected 6 decimals, got ${mintInfo.decimals}`);

  // Fund ourselves with mock USDC for later spikes. The ATA must exist before
  // mintTo, so create it idempotently first.
  const adminAta = (
    await getOrCreateAssociatedTokenAccount(conn, admin, mint, admin.publicKey)
  ).address;
  const TARGET_USDC = 1_000_000n; // 1,000,000 mock USDC
  const have = (await getAccount(conn, adminAta)).amount;
  if (have < TARGET_USDC * 1_000_000n) {
    await mintTo(conn, admin, mint, adminAta, admin, TARGET_USDC * 1_000_000n - have);
  }
  const bal = (await getAccount(conn, adminAta)).amount;
  console.log(`  admin ATA ${adminAta.toBase58()} holds ${Number(bal) / 1e6} mock USDC\n`);

  // ---- 3. live price ----
  console.log("3. starting mark");
  const unitUsd = await liveUnitPriceUsd();
  const initialPriceE6 = toE6(unitUsd);
  console.log(`  initial_price (e6) = ${initialPriceE6}\n`);

  // ---- 4. market account + InitMarket ----
  console.log("4. market");
  let market: PublicKey;
  if (state.market) {
    market = new PublicKey(state.market);
    console.log(`  reusing ${market.toBase58()}`);
  } else {
    const marketKp = Keypair.generate();
    const space = marketAccountLenFor(1);
    const rent = await conn.getMinimumBalanceForRentExemption(space);
    console.log(`  size ${space} B, rent ${(rent / 1e9).toFixed(5)} SOL`);

    const params = buildMarketParams({
      initialPriceE6,
      maxLeverage: getMarket(MARKET_ID).maxLeverage,
      maintenanceMarginBps: 1_000n,
      maxAbsFundingE9PerSlot: withFunding ? MAX_ABS_FUNDING_E9_PER_SLOT : 0n,
    });
    console.log(
      `  initial_margin_bps ${params.initialMarginBps} (= ${
        10_000 / Number(params.initialMarginBps)
      }x), maintenance ${params.maintenanceMarginBps}`,
    );
    console.log(`  funding cap ${params.maxAbsFundingE9PerSlot} e9/slot`);

    const vaultAuth = vaultAuthority(marketKp.publicKey);
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultAuth, true);

    const ixs: TransactionInstruction[] = [
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: marketKp.publicKey,
        lamports: rent,
        space,
        programId: PERCOLATOR_PROGRAM_ID,
      }),
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        vaultAta,
        vaultAuth,
        mint,
        TOKEN_PROGRAM_ID,
      ),
      ixInitMarket(admin.publicKey, marketKp.publicKey, mint, params),
    ];

    await send(conn, [admin, marketKp], ixs, { label: "createAccount + vault ATA + InitMarket" });
    market = marketKp.publicKey;
    state.market = market.toBase58();
    state.initialPriceE6 = initialPriceE6.toString();
    state.createdAt = new Date().toISOString();
    saveState(state);
    console.log(`  market  ${market.toBase58()}`);
    console.log(`  vault   ${vaultAta.toBase58()} ${DIM}(authority ${vaultAuth.toBase58()})${OFF}`);
  }
  console.log();

  // ---- 5. ConfigureAuthMark — probe both wires ----
  console.log("5. AUTH_MARK oracle mode (probing both instruction wires)");
  const info = await conn.getAccountInfo(market, "confirmed");
  if (!info) throw new Error(`market account ${market.toBase58()} not found`);
  const data = info.data;
  console.log(`  market account ${data.length} B`);

  const asset0 = parseAsset(data, assetSlotOffset(0), 0);
  const seqs = readAssetControlSequences(data, 0);
  console.log(`  asset 0 market_id ${asset0.marketId}`);
  console.log(
    `  sequences: oracle_observation ${seqs.oracleObservation}, authority_epoch ${seqs.authorityEpoch}`,
  );

  const profileOff = assetSlotOffset(0);
  const before = parseAssetOracleProfile(data, profileOff, 0);
  console.log(`  oracle_mode before: ${before.oracleMode} ${DIM}(0 = Manual)${OFF}`);

  let accepted: AuthMarkWire | null = state.authMarkWire ?? null;
  if (before.oracleMode === ORACLE_MODE.AuthMark) {
    console.log(
      `  ${GREEN}already in AUTH_MARK${OFF}` +
        (accepted ? ` via the ${accepted} wire` : ` ${DIM}(wire unrecorded — rerun with --fresh to probe)${OFF}`),
    );
  } else {
    for (const wire of ["long", "short"] as const) {
      const slot = await nowSlot(conn);
      const ix = ixAuthMark(
        admin.publicKey,
        market,
        encConfigureAuthMark(
          {
            assetIndex: 0,
            marketId: asset0.marketId,
            nowSlot: slot,
            initialMarkE6: initialPriceE6,
            observationSequence: seqs.oracleObservation + 1n,
            authorityEpoch: seqs.authorityEpoch,
          },
          wire,
        ),
      );
      console.log(`  trying ${wire} wire (${ix.data.length} bytes)…`);
      try {
        await send(conn, [admin], [ix], { label: `ConfigureAuthMark (${wire} wire)` });
        accepted = wire;
        break;
      } catch {
        console.log(`    ${RED}${wire} wire rejected${OFF}`);
      }
    }
  }

  if (!accepted) {
    console.error(`\n${RED}BLOCKER: neither AuthMark wire was accepted.${OFF}`);
    console.error(`Fallback: the Commoneffort/percolator-vaults deployment ` +
      `(8o3uV87X2CvPYfPwM1sxeaYYE7sGWsTUiEy7SskEMM3P) runs a live 6-decimal USDC ` +
      `AuthMark market and is a documented alternative. See DECISIONS.md §3.15.`);
    process.exitCode = 1;
    return;
  }
  state.authMarkWire = accepted;
  state.marketAsset = "0";
  saveState(state);
  console.log();

  // ---- 6. verify ----
  console.log("6. verify");
  const after = await conn.getAccountInfo(market, "confirmed");
  if (!after) throw new Error("market vanished");
  const profile = parseAssetOracleProfile(after.data, profileOff, 0);
  const seqsAfter = readAssetControlSequences(after.data, 0);

  const checks: [string, boolean, string][] = [
    ["oracle_mode is AUTH_MARK (3)", profile.oracleMode === ORACLE_MODE.AuthMark, `got ${profile.oracleMode}`],
    ["oracle authority is our wallet", profile.oracleAuthority.equals(admin.publicKey), `got ${profile.oracleAuthority.toBase58()}`],
    ["unit_scale is 0 (forced in AuthMark)", Number(profile.unitScale) === 0, `got ${profile.unitScale}`],
    ["invert is 0 (forced in AuthMark)", Number(profile.invert) === 0, `got ${profile.invert}`],
    ["observation sequence advanced", seqsAfter.oracleObservation > seqs.oracleObservation || accepted === "short", `${seqs.oracleObservation} → ${seqsAfter.oracleObservation}`],
  ];

  let allOk = true;
  for (const [name, ok, detail] of checks) {
    console.log(`  ${ok ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`} ${name} ${DIM}${detail}${OFF}`);
    if (!ok) allOk = false;
  }

  console.log(`\n${DIM}─ spike 1 result ─${OFF}`);
  console.log(`  collateral mint   ${mint.toBase58()} (6 decimals)`);
  console.log(`  market            ${market.toBase58()}`);
  console.log(`  oracle authority  ${admin.publicKey.toBase58()}`);
  console.log(`  price scale       e6 — initial mark ${initialPriceE6} = $${unitUsd.toFixed(6)} per kNGN`);
  console.log(`  AuthMark wire     ${GREEN}${accepted}${OFF}`);
  console.log(`  state written to  ${STATE_PATH}\n`);

  if (!allOk) process.exitCode = 1;
}

main()
  .then(() => {
    // web3.js keeps RPC sockets alive; without this the process lingers and can
    // surface an unhandled connect-timeout after the run has already succeeded.
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error("\nspike1 failed:", err);
    process.exit(1);
  });
