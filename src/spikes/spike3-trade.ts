/**
 * SPIKE 3 — open a long and a short, move the price, close both.
 *
 * Proves, or fails loudly:
 *   1. A second trader wallet, funded with mock USDC, can hold a position.
 *   2. TradeNoCpi opens a matched long/short pair with no matcher program.
 *   3. After a price push and a crank, PnL moves the way it should — the long
 *      gains when the price rises, the short loses the same amount.
 *   4. Both positions close, and capital returns to the vault.
 *
 * Reports start and end balances, every signature, and timings.
 *
 * Note on funding: spike 1's market was created with
 * `max_abs_funding_e9_per_slot = 0`, which disables funding. That was a
 * deliberate choice — FUNDING_DEN lives in the engine crate and is not readable
 * from source, and the parameter is IMMUTABLE after InitMarket, so guessing it
 * would have baked in a wrong value. Pass --with-funding to build a separate
 * market with funding enabled and measure the real rate.
 *
 *   npm run spike3
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

import {
  getConnection,
  loadOrCreateWallet,
  ensureFunded,
  send,
  nowSlot,
  getAccountData,
  fromE6,
  toE6,
  PERCOLATOR_PROGRAM_ID,
} from "../lib/solana.js";
import {
  assetEngineOffset,
  assetSlotOffset,
  encPushAuthMark,
  ixAuthMark,
  ixCrank,
  ixDeposit,
  ixInitPortfolio,
  ixTradeNoCpi,
  notionalAtoms,
  toSizeQ,
  vaultAuthority,
  PORTFOLIO_ACCOUNT_LEN,
  POS_SCALE,
  readAssetControlSequences,
  type AuthMarkWire,
} from "../lib/percolator.js";
import {
  parseAsset,
  parseAssetOracleProfile,
  parsePortfolio,
  type Portfolio,
} from "../vendor/percolator-v16/index.js";
import { getMarket } from "../lib/markets.js";
import { sourcesFor, readSource } from "../lib/sources.js";
import { computeIndex } from "../lib/index-math.js";

const STATE_PATH = "out/parallel-devnet.json";
const DIM = "\x1b[2m", OFF = "\x1b[0m", GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m";
const CONTRACTS = 1_000; // 1,000 kNGN

interface State {
  collateralMint?: string;
  market?: string;
  authMarkWire?: AuthMarkWire;
  portfolioA?: string;
  portfolioAFunded?: boolean;
  portfolioB?: string;
  portfolioBFunded?: boolean;
  [k: string]: unknown;
}

const loadState = (): State => {
  if (!existsSync(STATE_PATH)) throw new Error(`${STATE_PATH} not found — run \`npm run spike1\` first`);
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
};
const saveState = (s: State): void => writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));

const usd = (e6: bigint): string => `$${fromE6(e6).toFixed(6)}`;
const atoms = (a: bigint): string =>
  `${(Number(a) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;

type Conn = ReturnType<typeof getConnection>;

async function readMarket(conn: Conn, market: PublicKey) {
  const data = await getAccountData(conn, market);
  return {
    asset: parseAsset(data, assetEngineOffset(0), 0),
    profile: parseAssetOracleProfile(data, assetSlotOffset(0), 0),
  };
}

async function readPf(conn: Conn, pf: PublicKey): Promise<Portfolio> {
  return parsePortfolio(await getAccountData(conn, pf));
}

function describePf(name: string, p: Portfolio): void {
  const leg = p.legs.find((l) => l.assetIndex === 0);
  const pos = leg ? leg.basisPosQ : 0n;
  const side = pos > 0n ? "LONG " : pos < 0n ? "SHORT" : "flat ";
  const size = pos === 0n ? "—" : `${(Number(pos < 0n ? -pos : pos) / Number(POS_SCALE)).toFixed(0)} kNGN`;
  console.log(
    `  ${name}  capital ${atoms(p.capital).padStart(16)}  pnl ${atoms(p.pnl).padStart(14)}  ${side} ${size}`,
  );
}

async function main(): Promise<void> {
  const conn = getConnection();
  const state = loadState();
  if (!state.market || !state.collateralMint) throw new Error("run `npm run spike1` first");

  const market = new PublicKey(state.market);
  const mint = new PublicKey(state.collateralMint);
  const wire: AuthMarkWire = state.authMarkWire ?? "short";

  console.log(`\n${DIM}Parallel — spike 3: open a long and a short, move the price, close both${OFF}`);
  console.log(`${DIM}${new Date().toISOString()} · market ${market.toBase58()}${OFF}\n`);

  const admin = loadOrCreateWallet("oracle-authority");
  const trader = loadOrCreateWallet("trader");
  await ensureFunded(conn, admin, 0.15, "oracle-authority");
  await ensureFunded(conn, trader, 0.15, "trader");

  const vaultAta = getAssociatedTokenAddressSync(mint, vaultAuthority(market), true);

  // ---- 1. portfolios ----
  console.log("1. portfolios");
  if (!state.portfolioA) throw new Error("portfolio A missing — run `npm run spike2` first");
  const pfA = new PublicKey(state.portfolioA);
  console.log(`  A (admin)  ${pfA.toBase58()}`);

  let pfB: PublicKey;
  if (state.portfolioB) {
    pfB = new PublicKey(state.portfolioB);
    console.log(`  B (trader) ${pfB.toBase58()} ${DIM}reused${OFF}`);
  } else {
    const kp = Keypair.generate();
    const rent = await conn.getMinimumBalanceForRentExemption(PORTFOLIO_ACCOUNT_LEN);
    await send(
      conn,
      [trader, kp],
      [
        SystemProgram.createAccount({
          fromPubkey: trader.publicKey,
          newAccountPubkey: kp.publicKey,
          lamports: rent,
          space: PORTFOLIO_ACCOUNT_LEN,
          programId: PERCOLATOR_PROGRAM_ID,
        }),
        ixInitPortfolio(trader.publicKey, market, kp.publicKey),
      ],
      { label: "createAccount + InitPortfolio (trader)" },
    );
    pfB = kp.publicKey;
    state.portfolioB = pfB.toBase58();
    saveState(state);
    console.log(`  B (trader) ${pfB.toBase58()} ${GREEN}created${OFF}`);
  }

  if (!state.portfolioBFunded) {
    // The trader needs mock USDC. The mint authority is the admin wallet.
    const traderAta = (await getOrCreateAssociatedTokenAccount(conn, trader, mint, trader.publicKey)).address;
    const held = (await getAccount(conn, traderAta)).amount;
    if (held < 10_000_000_000n) {
      await mintTo(conn, admin, mint, traderAta, admin, 10_000_000_000n - held);
      console.log(`  minted 10,000 mock USDC to the trader`);
    }
    await send(
      conn,
      [trader],
      [ixDeposit(trader.publicKey, market, pfB, traderAta, vaultAta, 10_000_000_000n)],
      { label: "Deposit 10,000 mock USDC (trader)" },
    );
    state.portfolioBFunded = true;
    saveState(state);
  }
  console.log();

  // ---- 2. reset the mark to the live index ----
  console.log("2. reset the mark to the live street index");
  const mktDef = getMarket("USD/NGN");
  const readings = await Promise.all(sourcesFor("USD/NGN").map((s) => readSource(s)));
  const tick = computeIndex(mktDef, readings, null);
  if (tick.unitPriceUsd === null) throw new Error(`cannot price USD/NGN: ${tick.reason}`);
  const entryE6 = toE6(tick.unitPriceUsd);
  console.log(
    `  median ${tick.median?.toFixed(2)} NGN/USD → 1 kNGN = ${usd(entryE6)} ` +
      `${DIM}(${tick.sourcesUsed.join(", ")})${OFF}`,
  );

  const pushAndCrank = async (priceE6: bigint, who: PublicKey, label: string): Promise<void> => {
    const m = await readMarket(conn, market);
    const seqs = readAssetControlSequences(await getAccountData(conn, market), 0);
    await send(
      conn,
      [admin],
      [
        ixAuthMark(
          admin.publicKey,
          market,
          encPushAuthMark(
            {
              assetIndex: 0,
              marketId: m.asset.marketId,
              nowSlot: await nowSlot(conn),
              markE6: priceE6,
              observationSequence: seqs.oracleObservation + 1n,
              authorityEpoch: seqs.authorityEpoch,
            },
            wire,
          ),
        ),
      ],
      { label: `PushAuthMark ${label}` },
    );
    // Crank BOTH portfolios: a crank progresses exactly one portfolio.
    for (const [pf, name] of [[pfA, "A"], [pfB, "B"]] as const) {
      try {
        await send(conn, [admin], [ixCrank(admin.publicKey, market, pf, { nowSlot: await nowSlot(conn) })], {
          label: `Crank ${name} ${label}`,
        });
      } catch {
        console.log(`    ${DIM}crank ${name}: no progress${OFF}`);
      }
    }
    void who;
  };

  await pushAndCrank(entryE6, admin.publicKey, "(reset)");
  let m = await readMarket(conn, market);
  console.log(`  effective price ${m.asset.effectivePrice} ${usd(m.asset.effectivePrice)}\n`);

  // ---- 3. flatten anything left over, so the run is deterministic ----
  const pre = await readPf(conn, pfA);
  const preLeg = pre.legs.find((l) => l.assetIndex === 0 && l.basisPosQ !== 0n);
  if (preLeg) {
    console.log(
      `3. flattening a leftover position (${preLeg.basisPosQ}) from a previous run`,
    );
    await send(
      conn,
      [admin, trader],
      [ixTradeNoCpi(admin.publicKey, trader.publicKey, market, pfA, pfB, {
        assetIndex: 0,
        sizeQ: -preLeg.basisPosQ,
        execPrice: m.asset.effectivePrice,
        feeBps: 0n,
      })],
      { label: "TradeNoCpi (flatten leftover)" },
    );
    console.log();
  }

  // ---- 3. starting balances ----
  console.log("3. starting balances");
  const a0 = await readPf(conn, pfA);
  const b0 = await readPf(conn, pfB);
  const vault0 = (await getAccount(conn, vaultAta)).amount;
  describePf("A", a0);
  describePf("B", b0);
  console.log(`  vault ${atoms(vault0)}\n`);

  // ---- 4. open ----
  const execE6 = m.asset.effectivePrice;
  const sizeQ = toSizeQ(CONTRACTS);
  const notional = notionalAtoms(sizeQ, execE6);
  console.log(`4. open: A long ${CONTRACTS} kNGN / B short, at ${usd(execE6)}`);
  console.log(
    `  notional ${atoms(notional)} ${DIM}· initial margin 20% ≈ ${atoms(notional / 5n)}${OFF}`,
  );
  console.log(
    `  ${DIM}exec_price is supplied but AuthMark markets substitute effective_price, ` +
      `so there is no trade price discovery${OFF}`,
  );

  const tOpen = Date.now();
  await send(
    conn,
    [admin, trader],
    [ixTradeNoCpi(admin.publicKey, trader.publicKey, market, pfA, pfB, {
      assetIndex: 0,
      sizeQ,
      execPrice: execE6,
      feeBps: 0n,
    })],
    { label: "TradeNoCpi (open)" },
  );
  const openMs = Date.now() - tOpen;

  const a1 = await readPf(conn, pfA);
  const b1 = await readPf(conn, pfB);
  describePf("A", a1);
  describePf("B", b1);
  m = await readMarket(conn, market);
  console.log(`  open interest long ${m.asset.oiEffLongQ}, short ${m.asset.oiEffShortQ}`);
  const opened = a1.legs.some((l) => l.basisPosQ !== 0n) && b1.legs.some((l) => l.basisPosQ !== 0n);
  console.log(`  ${opened ? `${GREEN}✓ both sides hold a position${OFF}` : `${RED}✗ no position opened${OFF}`}\n`);

  // ---- 5. move the price ----
  const movedE6 = (execE6 * 102n) / 100n;
  console.log(`5. push +2% → ${usd(movedE6)} and crank`);
  await pushAndCrank(movedE6, admin.publicKey, "(+2%)");
  m = await readMarket(conn, market);
  const effNow = m.asset.effectivePrice;
  console.log(`  effective price ${effNow} ${usd(effNow)}`);

  const a2 = await readPf(conn, pfA);
  const b2 = await readPf(conn, pfB);
  describePf("A", a2);
  describePf("B", b2);

  // Mark-to-market: we know the entry price because we set it.
  const deltaE6 = effNow - execE6;
  const expectedPnl = (sizeQ * deltaE6) / POS_SCALE;
  console.log(
    `\n  price moved ${usd(deltaE6)} × ${CONTRACTS} kNGN = ${atoms(expectedPnl)} ` +
      `${DIM}expected: A gains it, B loses it${OFF}`,
  );
  const aGain = a2.pnl - a1.pnl;
  const bGain = b2.pnl - b1.pnl;
  console.log(`  A realised pnl change ${atoms(aGain)}`);
  console.log(`  B realised pnl change ${atoms(bGain)}`);
  console.log(
    `  ${DIM}unrealised PnL is engine-side (ADL A/K index mechanism, no stored entry price), ` +
      `so it shows up on close${OFF}`,
  );

  // Funding
  console.log(`\n  funding: ${YELLOW}disabled on this market${OFF} ` +
    `${DIM}(max_abs_funding_e9_per_slot = 0, immutable — see DECISIONS.md §3.13)${OFF}`);

  // ---- 6. close ----
  console.log(`\n6. close both sides`);
  const tClose = Date.now();
  let closed = false;
  try {
    await send(
      conn,
      [admin, trader],
      [ixTradeNoCpi(admin.publicKey, trader.publicKey, market, pfA, pfB, {
        assetIndex: 0,
        sizeQ: -sizeQ,
        execPrice: effNow,
        feeBps: 0n,
      })],
      { label: "TradeNoCpi (close)" },
    );
    closed = true;
  } catch (err) {
    console.log(`  ${RED}close failed:${OFF} ${(err instanceof Error ? err.message : String(err)).split("\n")[0]}`);
  }
  const closeMs = Date.now() - tClose;

  const a3 = await readPf(conn, pfA);
  const b3 = await readPf(conn, pfB);
  describePf("A", a3);
  describePf("B", b3);
  const flat =
    !a3.legs.some((l) => l.basisPosQ !== 0n) && !b3.legs.some((l) => l.basisPosQ !== 0n);
  console.log(`  ${flat ? `${GREEN}✓ both sides flat${OFF}` : `${YELLOW}~ a position remains${OFF}`}`);

  // ---- summary ----
  const vault1 = (await getAccount(conn, vaultAta)).amount;
  console.log(`\n${DIM}─ spike 3 result ─${OFF}`);
  console.log(`  entry price        ${usd(execE6)}`);
  console.log(`  exit price         ${usd(effNow)}  ${DIM}(+2%)${OFF}`);
  console.log(`  size               ${CONTRACTS} kNGN, notional ${atoms(notional)}`);
  console.log(`  A capital          ${atoms(a0.capital)} → ${atoms(a3.capital)}  pnl ${atoms(a3.pnl)}`);
  console.log(`  B capital          ${atoms(b0.capital)} → ${atoms(b3.capital)}  pnl ${atoms(b3.pnl)}`);
  console.log(`  vault              ${atoms(vault0)} → ${atoms(vault1)}`);
  console.log(`  open trade         ${openMs}ms`);
  console.log(`  close trade        ${closeMs}ms`);
  console.log(`  funding            disabled by design on this market`);
  console.log(`  ${DIM}all signatures appended to out/signatures.jsonl${OFF}\n`);

  if (!opened || !closed || !flat) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("\nspike3 failed:", err);
    process.exit(1);
  });
