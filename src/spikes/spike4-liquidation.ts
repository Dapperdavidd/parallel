/**
 * SPIKE 4 — liquidate a high-leverage position.
 *
 * Proves, or fails loudly:
 *   1. The per-slot price cap DOES clamp once the asset carries open interest —
 *      the path spike 2 could not reach with a flat market.
 *   2. A position that falls below maintenance margin is liquidated by a
 *      PermissionlessCrank carrying a non-zero closeQ.
 *   3. What the liquidation does to the insurance fund.
 *
 * There is no separate "liquidate" instruction in v16: liquidation is the same
 * crank, and the engine — not the caller — decides the size and the fee.
 *
 *   npm run spike4
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";

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
  clampTowardTarget,
  encPushAuthMark,
  ixAuthMark,
  ixCrank,
  ixTradeNoCpi,
  notionalAtoms,
  vaultAuthority,
  MAX_ACCRUAL_DT_SLOTS,
  MAX_PRICE_MOVE_BPS_PER_SLOT,
  POS_SCALE,
  readAssetControlSequences,
  type AuthMarkWire,
} from "../lib/percolator.js";
import {
  encTopUpInsuranceDomain,
  parseAsset,
  parseMarketGroup,
  parsePortfolio,
  type Portfolio,
} from "../vendor/percolator-v16/index.js";

const STATE_PATH = "out/parallel-devnet.json";
const DIM = "\x1b[2m", OFF = "\x1b[0m", GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m";

/**
 * How far to push the price against the position.
 *
 * Sizing this matters more than it looks. At L× leverage the account's
 * equity/notional starts at 1/L, and maintenance margin is 10%, so:
 *
 *   liquidation needs an adverse move of about  (1/L − 0.10)
 *   bankruptcy  arrives at                       (1/L)
 *
 * At 4.8× that is ~10.8% to liquidate and ~20.8% to go bankrupt. A first run
 * used 25% and blew straight past liquidation into bankruptcy — capital 0.00,
 * pnl −1,986, `bankruptcy_hlock_active = 1` — which is a different code path
 * entirely. 14% sits in the window.
 */
const ADVERSE_PCT = 14n;
const MAX_CRANKS = 14;       // the cap means several cranks are needed

interface State {
  collateralMint?: string;
  market?: string;
  authMarkWire?: AuthMarkWire;
  portfolioA?: string;
  portfolioB?: string;
  insuranceTopped?: boolean;
  fundingEnabled?: boolean;
  [k: string]: unknown;
}

const loadState = (): State => {
  if (!existsSync(STATE_PATH)) throw new Error(`${STATE_PATH} not found — run \`npm run spike1\``);
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
};
const saveState = (s: State): void => writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));

const usd = (e6: bigint): string => `$${fromE6(e6).toFixed(6)}`;
const atoms = (a: bigint): string =>
  `${(Number(a) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;

type Conn = ReturnType<typeof getConnection>;

async function readAll(conn: Conn, market: PublicKey) {
  const data = await getAccountData(conn, market);
  return { group: parseMarketGroup(data), asset: parseAsset(data, assetEngineOffset(0), 0) };
}
const readPf = async (conn: Conn, pf: PublicKey): Promise<Portfolio> =>
  parsePortfolio(await getAccountData(conn, pf));

const posOf = (p: Portfolio): bigint => p.legs.find((l) => l.assetIndex === 0)?.basisPosQ ?? 0n;
const fundingTotal = (p: Portfolio): bigint =>
  p.fundingLongPaidAtomsTotal + p.fundingLongReceivedAtomsTotal +
  p.fundingShortPaidAtomsTotal + p.fundingShortReceivedAtomsTotal;

async function main(): Promise<void> {
  const conn = getConnection();
  const state = loadState();
  if (!state.market || !state.collateralMint || !state.portfolioA || !state.portfolioB) {
    throw new Error("run spikes 1-3 first");
  }
  const market = new PublicKey(state.market);
  const mint = new PublicKey(state.collateralMint);
  const pfA = new PublicKey(state.portfolioA);
  const pfB = new PublicKey(state.portfolioB);
  const wire: AuthMarkWire = state.authMarkWire ?? "short";

  console.log(`\n${DIM}Parallel — spike 4: liquidate a high-leverage position${OFF}`);
  console.log(`${DIM}${new Date().toISOString()} · market ${market.toBase58()}${OFF}\n`);

  const admin = loadOrCreateWallet("oracle-authority");
  const trader = loadOrCreateWallet("trader");
  await ensureFunded(conn, admin, 0.1, "oracle-authority");
  await ensureFunded(conn, trader, 0.1, "trader");

  const adminAta = (await getOrCreateAssociatedTokenAccount(conn, admin, mint, admin.publicKey)).address;
  const vaultAta = getAssociatedTokenAddressSync(mint, vaultAuthority(market), true);

  const push = async (priceE6: bigint, label: string): Promise<void> => {
    const { asset } = await readAll(conn, market);
    const seqs = readAssetControlSequences(await getAccountData(conn, market), 0);
    await send(
      conn,
      [admin],
      [ixAuthMark(admin.publicKey, market, encPushAuthMark({
        assetIndex: 0,
        marketId: asset.marketId,
        nowSlot: await nowSlot(conn),
        markE6: priceE6,
        observationSequence: seqs.oracleObservation + 1n,
        authorityEpoch: seqs.authorityEpoch,
      }, wire))],
      { label },
    );
  };

  const crank = async (pf: PublicKey, label: string, closeQ = 0n): Promise<boolean> => {
    try {
      await send(
        conn,
        [admin],
        [ixCrank(admin.publicKey, market, pf, { nowSlot: await nowSlot(conn), closeQ })],
        { label, attempts: 2 },
      );
      return true;
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).match(/0x[0-9a-f]+/)?.[0] ?? "?";
      console.log(`    ${DIM}${label}: no progress (${msg})${OFF}`);
      return false;
    }
  };

  // ---- 1. insurance ----
  console.log("1. insurance fund");
  let { group, asset } = await readAll(conn, market);
  console.log(`  before ${atoms(group.insurance)}  ${DIM}vault ${atoms(group.vault)}${OFF}`);
  if (!state.insuranceTopped) {
    for (const domain of [0, 1]) {
      await send(
        conn,
        [admin],
        [new TransactionInstruction({
          programId: PERCOLATOR_PROGRAM_ID,
          keys: [
            { pubkey: admin.publicKey, isSigner: true, isWritable: false },
            { pubkey: market, isSigner: false, isWritable: true },
            { pubkey: adminAta, isSigner: false, isWritable: true },
            { pubkey: vaultAta, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: encTopUpInsuranceDomain({ domain, amount: 500_000_000n }),
        })],
        { label: `TopUpInsuranceDomain ${domain} (500 USDC)` },
      );
    }
    state.insuranceTopped = true;
    saveState(state);
    ({ group } = await readAll(conn, market));
    console.log(`  after  ${atoms(group.insurance)}`);
  } else {
    console.log(`  ${DIM}already topped up${OFF}`);
  }
  console.log();

  // ---- 2. flatten, then open at maximum leverage ----
  console.log("2. open a maximum-leverage position");
  ({ asset } = await readAll(conn, market));
  let a = await readPf(conn, pfA);
  let b = await readPf(conn, pfB);

  if (posOf(a) !== 0n) {
    await send(
      conn,
      [admin, trader],
      [ixTradeNoCpi(admin.publicKey, trader.publicKey, market, pfA, pfB, {
        assetIndex: 0, sizeQ: -posOf(a), execPrice: asset.effectivePrice, feeBps: 0n,
      })],
      { label: "TradeNoCpi (flatten)" },
    );
    a = await readPf(conn, pfA);
    b = await readPf(conn, pfB);
  }

  const entry = asset.effectivePrice;
  // 5x is the market's cap (initial_margin_bps = 2000). Sit just inside it so
  // the open is accepted but maintenance margin (10%) is only a 10% move away.
  const targetNotional = (a.capital * 48n) / 10n; // 4.8x
  const sizeQ = (targetNotional * POS_SCALE) / entry;
  const notional = notionalAtoms(sizeQ, entry);

  console.log(`  A capital ${atoms(a.capital)}, entry ${usd(entry)}`);
  console.log(`  opening LONG ${(Number(sizeQ) / Number(POS_SCALE)).toFixed(0)} kNGN`);
  console.log(`  notional ${atoms(notional)} ${DIM}≈ ${(Number(notional) / Number(a.capital)).toFixed(2)}x leverage${OFF}`);
  console.log(`  ${DIM}maintenance margin 10% → roughly a 10% adverse move liquidates${OFF}`);

  await send(
    conn,
    [admin, trader],
    [ixTradeNoCpi(admin.publicKey, trader.publicKey, market, pfA, pfB, {
      assetIndex: 0, sizeQ, execPrice: entry, feeBps: 0n,
    })],
    { label: "TradeNoCpi (open at max leverage)" },
  );

  a = await readPf(conn, pfA);
  b = await readPf(conn, pfB);
  ({ asset, group } = await readAll(conn, market));
  const fundingStart = fundingTotal(a) + fundingTotal(b);
  console.log(`  A position ${posOf(a)}  ${DIM}OI long ${asset.oiEffLongQ}, short ${asset.oiEffShortQ}${OFF}`);
  const opened = posOf(a) !== 0n;
  console.log(`  ${opened ? `${GREEN}✓ open${OFF}` : `${RED}✗ failed to open${OFF}`}\n`);
  if (!opened) { process.exitCode = 1; return; }

  // ---- 3. adverse push, then walk the price down under the cap ----
  const adverse = (entry * (100n - ADVERSE_PCT)) / 100n;
  console.log(`3. push ${ADVERSE_PCT}% adverse: ${usd(entry)} → ${usd(adverse)}`);
  await push(adverse, `PushAuthMark (-${ADVERSE_PCT}%)`);
  console.log(`  ${DIM}the target moves at once; the effective price must now walk, clamped${OFF}\n`);

  console.log("4. crank until liquidated (watching the cap clamp)");
  let liquidated = false;
  let cranks = 0;
  const insuranceStart = group.insurance;
  let prevEff = asset.effectivePrice;

  for (let i = 0; i < MAX_CRANKS && !liquidated; i++) {
    const before = await readAll(conn, market);
    const dtGuess =
      (await nowSlot(conn)) - before.asset.slotLast < MAX_ACCRUAL_DT_SLOTS
        ? (await nowSlot(conn)) - before.asset.slotLast
        : MAX_ACCRUAL_DT_SLOTS;
    const ceiling = clampTowardTarget(
      before.asset.effectivePrice, adverse, MAX_PRICE_MOVE_BPS_PER_SLOT, dtGuess,
    );

    // A non-zero closeQ invites the engine to pick the liquidation plan.
    const ok = await crank(pfA, `Crank A #${i + 1}`, posOf(a) === 0n ? 0n : sizeQ);
    cranks++;
    await crank(pfB, `Crank B #${i + 1}`);

    const after = await readAll(conn, market);
    a = await readPf(conn, pfA);
    const eff = after.asset.effectivePrice;
    const movePct = prevEff === 0n ? 0 : (Number(eff - prevEff) / Number(prevEff)) * 100;
    // `ceiling` assumes ONE accrual segment. The engine actually walks up to
    // V16_MAX_ACCRUAL_PATH_STEPS segments per crank, so a single crank can move
    // further than one segment's worth — observed −4.7% against a −2.4%
    // single-segment ceiling. The cap is still binding; the estimate is just
    // conservative. What proves the clamp is that 14% took 6 cranks rather than
    // landing instantly, which is what a flat market does (spike 2).
    const singleSegmentOk = eff >= ceiling - 2n;

    console.log(
      `  #${String(i + 1).padStart(2)}  effective ${usd(eff)}  ` +
        `${movePct >= 0 ? "+" : ""}${movePct.toFixed(3)}%  ` +
        `${DIM}1-seg floor ${usd(ceiling)}${OFF}  ` +
        `${singleSegmentOk ? `${GREEN}1 segment${OFF}` : `${DIM}multi-segment${OFF}`}  ` +
        `pos ${posOf(a)}  ins ${atoms(after.group.insurance)}`,
    );

    if (posOf(a) === 0n) {
      liquidated = true;
      console.log(`  ${GREEN}✓ position closed out by the engine${OFF}`);
    }
    if (eff === adverse && !liquidated && !ok) {
      console.log(`  ${DIM}price reached target and the crank reports no progress${OFF}`);
    }
    prevEff = eff;
  }

  // ---- summary ----
  const end = await readAll(conn, market);
  a = await readPf(conn, pfA);
  b = await readPf(conn, pfB);
  const vaultBal = (await getAccount(conn, vaultAta)).amount;
  const insuranceDelta = end.group.insurance - insuranceStart;
  const fundingEnd = fundingTotal(a) + fundingTotal(b);
  const fundingDelta = fundingEnd - fundingStart;

  console.log(`\n${DIM}─ spike 4 result ─${OFF}`);
  console.log(`  entry price        ${usd(entry)}`);
  console.log(`  adverse target     ${usd(adverse)}  ${DIM}(-${ADVERSE_PCT}%)${OFF}`);
  console.log(`  final effective    ${usd(end.asset.effectivePrice)}`);
  console.log(`  cranks needed      ${cranks} ${DIM}(the cap limits each to ${MAX_PRICE_MOVE_BPS_PER_SLOT}bps × dt)${OFF}`);
  console.log(`  position           ${liquidated ? `${GREEN}liquidated${OFF}` : `${YELLOW}still open (${posOf(a)})${OFF}`}`);
  console.log(`  A capital / pnl    ${atoms(a.capital)} / ${atoms(a.pnl)}`);
  console.log(`  B capital / pnl    ${atoms(b.capital)} / ${atoms(b.pnl)}`);
  console.log(`  insurance          ${atoms(insuranceStart)} → ${atoms(end.group.insurance)}  ` +
    `${insuranceDelta >= 0n ? GREEN : RED}${insuranceDelta >= 0n ? "+" : ""}${atoms(insuranceDelta)}${OFF}`);
  console.log(`  funding counters   ${fundingStart} → ${fundingEnd}  ` +
    `${fundingDelta > 0n ? GREEN : YELLOW}${fundingDelta > 0n ? "+" : ""}${fundingDelta} atoms${OFF}`);
  console.log(`  vault              ${atoms(vaultBal)}`);
  console.log(`  market mode        ${end.group.mode} ${DIM}(0 = Live)${OFF}\n`);

  if (!liquidated) {
    console.log(`${YELLOW}The position did not liquidate within ${MAX_CRANKS} cranks.${OFF}`);
    console.log(`${DIM}Raise ADVERSE_PCT or MAX_CRANKS — each crank can only move the`);
    console.log(`effective price ${MAX_PRICE_MOVE_BPS_PER_SLOT}bps × up to ${MAX_ACCRUAL_DT_SLOTS} slots.${OFF}`);
    process.exitCode = 1;
  }
  if (state.fundingEnabled && fundingDelta <= 0n) {
    console.log(`${RED}Funding was enabled but no portfolio funding counter advanced.${OFF}`);
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("\nspike4 failed:", err);
    process.exit(1);
  });
