/**
 * SPIKE 2 — oracle push and the circuit breaker.
 *
 * Proves, or fails loudly:
 *   1. We can push a price as the oracle authority and read it back.
 *   2. A push moves only the RAW TARGET. The economically meaningful
 *      `effective_price` does not move until a crank walks it there. A push
 *      without a crank changes nothing — the single most load-bearing fact
 *      about running this oracle.
 *   3. How the per-slot price cap (`max_price_move_bps_per_slot`) actually
 *      behaves. Source, policy_v16::effective_price_from_target:
 *
 *          if exposed { clamp_toward_engine_dt(anchor, target, cap, dt) }
 *          else       { target }
 *
 *      so the cap ONLY engages when the asset has open interest. On a market
 *      with no positions the effective price snaps straight to the target.
 *      The cap is there to protect open positions from a meltdown, not to rate
 *      limit the index. Spike 4 exercises the clamped path under real exposure.
 *   4. What two pushes in the same slot do.
 *
 *   npm run spike2
 *
 * Requires spike 1 to have run (reads out/parallel-devnet.json).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

import {
  getConnection,
  loadOrCreateWallet,
  ensureFunded,
  send,
  nowSlot,
  getAccountData,
  fromE6,
  PERCOLATOR_PROGRAM_ID,
} from "../lib/solana.js";
import {
  assetEngineOffset,
  assetSlotOffset,
  clampTowardTarget,
  encPushAuthMark,
  ixAuthMark,
  ixCrank,
  ixDeposit,
  ixInitPortfolio,
  vaultAuthority,
  MAX_ACCRUAL_DT_SLOTS,
  MAX_PRICE_MOVE_BPS_PER_SLOT,
  PORTFOLIO_ACCOUNT_LEN,
  readAssetControlSequences,
  type AuthMarkWire,
} from "../lib/percolator.js";
import { parseAsset, parseAssetOracleProfile, type AssetState } from "../vendor/percolator-v16/index.js";

const STATE_PATH = "out/parallel-devnet.json";
const DIM = "\x1b[2m", OFF = "\x1b[0m", GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m";

interface State {
  collateralMint?: string;
  market?: string;
  authMarkWire?: AuthMarkWire;
  portfolioA?: string;
  portfolioAFunded?: boolean;
  [k: string]: unknown;
}

function loadState(): State {
  if (!existsSync(STATE_PATH)) throw new Error(`${STATE_PATH} not found — run \`npm run spike1\` first`);
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
}
const saveState = (s: State): void => writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));

const usd = (e6: bigint): string => `$${fromE6(e6).toFixed(6)}`;

type Conn = ReturnType<typeof getConnection>;

/**
 * The market carries THREE price fields, and they mean different things:
 *
 *   profile.oracle_target_price_e6   written by PushAuthMark, immediately
 *   asset.raw_oracle_target_price    propagated profile -> engine by a crank
 *   asset.effective_price            what actually prices positions
 *
 * A push updates only the first. A crank moves the second and walks the third.
 * Checking the wrong one makes a working push look like a silent failure.
 */
async function readMarket(conn: Conn, market: PublicKey) {
  const data = await getAccountData(conn, market);
  return {
    asset: parseAsset(data, assetEngineOffset(0), 0),
    profile: parseAssetOracleProfile(data, assetSlotOffset(0), 0),
  };
}

async function readAsset0(conn: Conn, market: PublicKey): Promise<AssetState> {
  return (await readMarket(conn, market)).asset;
}

/**
 * Reads asset 0 until `want` holds, or gives up.
 *
 * `api.devnet.solana.com` load-balances across nodes, so a read issued right
 * after a confirmed write can land on a replica that has not caught up and
 * returns the PREVIOUS value. Observed lagging by several seconds under
 * congestion on 2026-11-20. Polling is the fix; a single read-after-write is
 * not safe against this endpoint.
 */
async function readUntil<T>(
  read: () => Promise<T>,
  want: (v: T) => boolean,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let v = await read();
  while (!want(v) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1_000));
    v = await read();
  }
  return v;
}

async function main(): Promise<void> {
  const conn = getConnection();
  const state = loadState();
  if (!state.market || !state.collateralMint) {
    throw new Error("state is missing market/mint — run `npm run spike1` first");
  }
  const market = new PublicKey(state.market);
  const mint = new PublicKey(state.collateralMint);
  const wire: AuthMarkWire = state.authMarkWire ?? "short";

  console.log(`\n${DIM}Parallel — spike 2: oracle push and the circuit breaker${OFF}`);
  console.log(`${DIM}${new Date().toISOString()} · market ${market.toBase58()} · ${wire} wire${OFF}\n`);

  const admin = loadOrCreateWallet("oracle-authority");
  await ensureFunded(conn, admin, 0.2, "oracle-authority");

  // ---- 1. a portfolio, so we have something to crank ----
  console.log("1. keeper portfolio");
  let portfolio: PublicKey;
  if (state.portfolioA) {
    portfolio = new PublicKey(state.portfolioA);
    console.log(`  reusing ${portfolio.toBase58()}`);
  } else {
    const kp = Keypair.generate();
    const rent = await conn.getMinimumBalanceForRentExemption(PORTFOLIO_ACCOUNT_LEN);
    console.log(`  size ${PORTFOLIO_ACCOUNT_LEN} B, rent ${(rent / 1e9).toFixed(5)} SOL`);
    await send(
      conn,
      [admin, kp],
      [
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: kp.publicKey,
          lamports: rent,
          space: PORTFOLIO_ACCOUNT_LEN,
          programId: PERCOLATOR_PROGRAM_ID,
        }),
        ixInitPortfolio(admin.publicKey, market, kp.publicKey),
      ],
      { label: "createAccount + InitPortfolio" },
    );
    portfolio = kp.publicKey;
    state.portfolioA = portfolio.toBase58();
    saveState(state);
  }

  // Funding is tracked separately from creation: a transient RPC failure
  // between the two must not leave the portfolio permanently unfunded.
  if (!state.portfolioAFunded) {
    const adminAta = (await getOrCreateAssociatedTokenAccount(conn, admin, mint, admin.publicKey)).address;
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultAuthority(market), true);
    await send(
      conn,
      [admin],
      [ixDeposit(admin.publicKey, market, portfolio, adminAta, vaultAta, 10_000_000_000n)],
      { label: "Deposit 10,000 mock USDC" },
    );
    state.portfolioAFunded = true;
    saveState(state);
  } else {
    console.log(`  ${DIM}already funded${OFF}`);
  }
  console.log();

  // ---- 2. baseline ----
  console.log("2. baseline");
  let asset = await readAsset0(conn, market);
  const exposed = asset.oiEffLongQ !== 0n || asset.oiEffShortQ !== 0n;
  console.log(`  raw target      ${asset.rawOracleTargetPrice}  ${usd(asset.rawOracleTargetPrice)}`);
  console.log(`  effective price ${asset.effectivePrice}  ${usd(asset.effectivePrice)}`);
  console.log(`  open interest   long ${asset.oiEffLongQ}, short ${asset.oiEffShortQ} ` +
    `${exposed ? `${YELLOW}(exposed — the cap will clamp)${OFF}` : `${DIM}(none — the cap will NOT clamp)${OFF}`}`);
  console.log();

  const pushPrice = async (markE6: bigint, label: string): Promise<number> => {
    const slot = await nowSlot(conn);
    // The short wire ignores these two, but read them so the long-wire path
    // stays correct if devnet is ever upgraded.
    const seqs = readAssetControlSequences(await getAccountData(conn, market), 0);
    const ix = ixAuthMark(
      admin.publicKey,
      market,
      encPushAuthMark(
        {
          assetIndex: 0,
          marketId: asset.marketId,
          nowSlot: slot,
          markE6,
          observationSequence: seqs.oracleObservation + 1n,
          authorityEpoch: seqs.authorityEpoch,
        },
        wire,
      ),
    );
    const t0 = Date.now();
    await send(conn, [admin], [ix], { label });
    return Date.now() - t0;
  };

  const crank = async (label: string): Promise<void> => {
    const slot = await nowSlot(conn);
    try {
      await send(conn, [admin], [ixCrank(admin.publicKey, market, portfolio, { nowSlot: slot })], { label });
    } catch {
      console.log(`    ${DIM}crank made no progress (normal when nothing has changed)${OFF}`);
    }
  };

  // ---- 3. push, read back, crank ----
  console.log("3. push a small move (+0.5%), read it back, then crank");
  const base = asset.effectivePrice > 0n ? asset.effectivePrice : asset.rawOracleTargetPrice;
  const small = (base * 1005n) / 1000n;
  const pushMs = await pushPrice(small, "PushAuthMark (+0.5%)");

  let snap = await readUntil(
    () => readMarket(conn, market),
    (m) => m.profile.oracleTargetPriceE6 === small,
  );
  const targetMoved = snap.profile.oracleTargetPriceE6 === small;
  const effBeforeCrank = snap.asset.effectivePrice;
  console.log(
    `  profile target  ${snap.profile.oracleTargetPriceE6}  ${usd(snap.profile.oracleTargetPriceE6)} ` +
      `${targetMoved ? `${GREEN}✓ the push updated it immediately${OFF}` : `${RED}✗ expected ${small}${OFF}`}`,
  );
  console.log(
    `  engine target   ${snap.asset.rawOracleTargetPrice}  ${usd(snap.asset.rawOracleTargetPrice)} ` +
      `${DIM}(propagated only by a crank)${OFF}`,
  );
  console.log(
    `  effective price ${effBeforeCrank}  ${usd(effBeforeCrank)} ` +
      `${effBeforeCrank === base ? `${GREEN}✓ unchanged by the push alone${OFF}` : `${DIM}already moved${OFF}`}`,
  );

  await crank("PermissionlessCrank (walk toward target)");
  snap = await readUntil(() => readMarket(conn, market), (m) => m.asset.effectivePrice === small);
  asset = snap.asset;
  console.log(`  after crank     ${asset.effectivePrice}  ${usd(asset.effectivePrice)}`);
  const crankMoved = asset.effectivePrice !== effBeforeCrank;
  console.log(
    `  ${crankMoved ? `${GREEN}✓` : `${RED}✗`}${OFF} the crank, not the push, is what moves the effective price\n`,
  );

  // ---- 4. a large push: how does the cap behave? ----
  console.log("4. push a large move (+25%) and observe the per-slot cap");
  const pLast = asset.effectivePrice;
  const slotBefore = asset.slotLast;
  const big = (pLast * 125n) / 100n;
  console.log(`  from ${pLast} ${usd(pLast)} → target ${big} ${usd(big)} ${DIM}(+25%)${OFF}`);

  await pushPrice(big, "PushAuthMark (+25%)");
  snap = await readUntil(
    () => readMarket(conn, market),
    (m) => m.profile.oracleTargetPriceE6 === big,
  );
  const bigTargetSet = snap.profile.oracleTargetPriceE6 === big;
  console.log(
    `  profile target  ${snap.profile.oracleTargetPriceE6} ` +
      `${bigTargetSet ? `${GREEN}✓ accepted in full, uncapped at the push${OFF}` : `${RED}✗ expected ${big}${OFF}`}`,
  );

  const crankSlot = await nowSlot(conn);
  await crank("PermissionlessCrank (after a +25% jump)");
  asset = await readAsset0(conn, market);

  const elapsed = crankSlot > slotBefore ? crankSlot - slotBefore : 1n;
  const dt = elapsed < MAX_ACCRUAL_DT_SLOTS ? elapsed : MAX_ACCRUAL_DT_SLOTS;
  const clamped = clampTowardTarget(pLast, big, MAX_PRICE_MOVE_BPS_PER_SLOT, dt);
  const actual = asset.effectivePrice;
  const nowExposed = asset.oiEffLongQ !== 0n || asset.oiEffShortQ !== 0n;

  console.log(`  slots elapsed       ${elapsed} ${DIM}(dt capped at max_accrual_dt_slots = ${MAX_ACCRUAL_DT_SLOTS})${OFF}`);
  console.log(`  if exposed, ceiling ${clamped}  ${usd(clamped)}`);
  console.log(`  actual effective    ${actual}  ${usd(actual)}`);

  // The expectation depends entirely on whether the asset carries open interest.
  let capOk: boolean;
  if (nowExposed) {
    capOk = actual <= clamped;
    console.log(
      `  ${capOk ? `${GREEN}✓ clamped by the per-slot cap${OFF}` : `${RED}✗ exceeded the ceiling${OFF}`} ` +
        `${DIM}(open interest present)${OFF}`,
    );
    if (actual < big) {
      const gapPct = (Number(big - actual) / Number(big)) * 100;
      console.log(`  ${YELLOW}target/effective lag: ${gapPct.toFixed(2)}% below target${OFF}`);
      console.log(`  ${DIM}while this gap is open, withdrawals and PnL conversion go conservative${OFF}`);
    }
  } else {
    capOk = actual === big;
    console.log(
      `  ${capOk ? `${GREEN}✓ snapped straight to target${OFF}` : `${RED}✗ expected ${big}${OFF}`} ` +
        `${DIM}(no open interest, so effective_price_from_target returns the target unclamped)${OFF}`,
    );
    console.log(`  ${DIM}the cap protects open positions; with none there is nothing to protect${OFF}`);
    console.log(`  ${DIM}spike 4 exercises the clamped path under real exposure${OFF}`);
  }
  console.log();

  // ---- 5. same-slot double push ----
  console.log("5. two pushes in the same slot");
  const slotA = await nowSlot(conn);
  let sameSlotNote: string;
  try {
    await pushPrice(asset.rawOracleTargetPrice + 1n, "PushAuthMark (same slot #1)");
    await pushPrice(asset.rawOracleTargetPrice + 2n, "PushAuthMark (same slot #2)");
    const slotB = await nowSlot(conn);
    sameSlotNote =
      slotB === slotA
        ? "both landed in one slot and were accepted; the step budget is zero so the effective price cannot advance"
        : `slot advanced ${slotA} → ${slotB}, so this was not a true same-slot test (both pushes accepted)`;
    console.log(`  ${GREEN}✓${OFF} ${sameSlotNote}`);
  } catch (err) {
    sameSlotNote = `rejected: ${(err instanceof Error ? err.message : String(err)).split("\n")[0]}`;
    console.log(`  ${YELLOW}~${OFF} ${sameSlotNote}`);
  }

  // ---- summary ----
  asset = await readAsset0(conn, market);
  console.log(`\n${DIM}─ spike 2 result ─${OFF}`);
  console.log(`  push latency        ~${pushMs}ms`);
  console.log(`  raw target          ${asset.rawOracleTargetPrice}  ${usd(asset.rawOracleTargetPrice)}`);
  console.log(`  effective price     ${asset.effectivePrice}  ${usd(asset.effectivePrice)}`);
  console.log(`  a push alone        moves the raw target only — a crank is required`);
  console.log(`  circuit breaker     max_price_move_bps_per_slot = ${MAX_PRICE_MOVE_BPS_PER_SLOT}, immutable`);
  console.log(`                      clamps ONLY when the asset has open interest`);
  console.log(`  cap formula         p_last × ${MAX_PRICE_MOVE_BPS_PER_SLOT} × dt / 10000, dt capped at ${MAX_ACCRUAL_DT_SLOTS}`);
  console.log(`  same-slot pushes    ${sameSlotNote}`);
  console.log(`  keeper portfolio    ${portfolio.toBase58()}\n`);

  if (!targetMoved || !crankMoved || !bigTargetSet || !capOk) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("\nspike2 failed:", err);
    process.exit(1);
  });
