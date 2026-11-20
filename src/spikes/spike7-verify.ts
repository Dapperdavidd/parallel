/**
 * SPIKE 7, part 3 — verify on-chain, independently of the page.
 *
 * The Privy modal saying "Transaction complete!" is its own report. This reads
 * devnet directly: it finds every Percolator portfolio on our market, shows who
 * owns it and how much capital it holds, and flags the ones that are NOT the
 * two wallets this project generated — i.e. the Privy embedded wallet.
 *
 *   npm run spike7:verify
 */

import { existsSync, readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { getConnection, loadOrCreateWallet, withRetry, PERCOLATOR_PROGRAM_ID } from "../lib/solana.js";
import { vaultAuthority, PORTFOLIO_ACCOUNT_LEN } from "../lib/percolator.js";
import { parsePortfolio } from "../vendor/percolator-v16/index.js";

const STATE_PATH = "out/parallel-devnet.json";
const DIM = "\x1b[2m", OFF = "\x1b[0m", GREEN = "\x1b[32m", LIME = "\x1b[92m";

const atoms = (a: bigint): string =>
  `${(Number(a) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;

async function main(): Promise<void> {
  if (!existsSync(STATE_PATH)) throw new Error(`${STATE_PATH} not found — run \`npm run spike1\``);
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as {
    market?: string; collateralMint?: string; portfolioA?: string; portfolioB?: string;
  };
  if (!state.market || !state.collateralMint) throw new Error("run `npm run spike1` first");

  const conn = getConnection();
  const market = new PublicKey(state.market);
  const mint = new PublicKey(state.collateralMint);

  console.log(`\n${DIM}Parallel — spike 7: on-chain verification${OFF}`);
  console.log(`${DIM}market ${market.toBase58()}${OFF}\n`);

  // Wallets this project generated, so anything else is the Privy wallet.
  const known = new Map<string, string>();
  for (const name of ["oracle-authority", "trader"]) {
    try {
      known.set(loadOrCreateWallet(name).publicKey.toBase58(), name);
    } catch { /* not created yet */ }
  }

  const accounts = await withRetry(
    () =>
      conn.getProgramAccounts(PERCOLATOR_PROGRAM_ID, {
        filters: [{ dataSize: PORTFOLIO_ACCOUNT_LEN }],
      }),
    "scan portfolios",
  );

  const mine = accounts
    .map(({ pubkey, account }) => ({ pubkey, pf: parsePortfolio(account.data) }))
    .filter(({ pf }) => pf.marketGroupId.equals(market));

  console.log(`portfolios on this market: ${mine.length}\n`);

  let privyFound = false;
  for (const { pubkey, pf } of mine) {
    const owner = pf.owner.toBase58();
    const label = known.get(owner);
    const isPrivy = !label;
    if (isPrivy && pf.capital > 0n) privyFound = true;

    console.log(
      `  ${isPrivy ? `${LIME}●${OFF}` : `${DIM}○${OFF}`} ${pubkey.toBase58()}`,
    );
    console.log(
      `     owner   ${owner} ${label ? `${DIM}(${label})${OFF}` : `${LIME}← Privy embedded wallet${OFF}`}`,
    );
    console.log(`     capital ${atoms(pf.capital)}   pnl ${atoms(pf.pnl)}`);

    if (isPrivy) {
      const ata = getAssociatedTokenAddressSync(mint, pf.owner);
      const bal = await getAccount(conn, ata).catch(() => null);
      console.log(`     wallet  ${bal ? atoms(bal.amount) : "no token account"} held outside the engine`);
      const sol = await conn.getBalance(pf.owner);
      console.log(`     SOL     ${(sol / 1e9).toFixed(4)}`);
    }
    console.log();
  }

  const vaultAta = getAssociatedTokenAddressSync(mint, vaultAuthority(market), true);
  const vault = await getAccount(conn, vaultAta);
  console.log(`vault total ${atoms(vault.amount)}\n`);

  if (privyFound) {
    console.log(`${GREEN}✓ SPIKE 7 PASSES${OFF}`);
    console.log(
      `  A wallet created from an email sign-in holds mock USDC and has signed\n` +
        `  real Percolator instructions on devnet: createAccount, InitPortfolio\n` +
        `  and Deposit. Its capital is live in the engine's vault.\n`,
    );
  } else {
    console.log(`${DIM}No non-project portfolio with capital found yet.${OFF}`);
    console.log(`${DIM}Complete the deposit on the spike 7 page, then re-run this.${OFF}\n`);
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("\nspike7:verify failed:", err);
    process.exit(1);
  });
