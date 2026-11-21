/**
 * Create one isolated, Parallel-controlled counterparty portfolio per market.
 *
 * The portfolio accounts are public devnet state. Their owner keypairs stay in
 * gitignored wallets/ and are later supplied to the web server as secrets.
 * The oracle authority pays portfolio rent and mints mock USDC; no real asset
 * or mainnet key is involved.
 *
 *   npm run vaults:create -- --dry-run
 *   npm run vaults:create -- USD/NGN
 */

import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { ensureFunded, getConnection, loadOrCreateWallet, send } from "../lib/solana.js";
import {
  ixDeposit,
  ixInitPortfolio,
  PORTFOLIO_ACCOUNT_LEN,
  vaultAuthority,
} from "../lib/percolator.js";
import { loadRegistry, saveRegistry } from "../lib/registry.js";

const CAPITAL_ATOMS = 50_000_000_000n;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const wanted = new Set(argv.filter((v) => !v.startsWith("--")));
  const registry = loadRegistry();
  if (!registry) throw new Error("market-registry.json is missing");

  const entries = registry.markets.filter((entry) => wanted.size === 0 || wanted.has(entry.id));
  const pending = entries.filter((entry) => !entry.liquidityVault);
  const connection = getConnection();
  const admin = loadOrCreateWallet("oracle-authority");
  const mint = new PublicKey(registry.collateralMint);
  const rent = await connection.getMinimumBalanceForRentExemption(PORTFOLIO_ACCOUNT_LEN);
  const needed = rent * pending.length + 20_000_000;
  const held = await connection.getBalance(admin.publicKey, "confirmed");

  console.log("\nParallel — isolated liquidity portfolios (devnet)");
  console.log(`${pending.length} to create · ${(rent / 1e9).toFixed(5)} SOL rent each`);
  console.log(`need about ${(needed / 1e9).toFixed(4)} SOL · authority holds ${(held / 1e9).toFixed(4)} SOL\n`);

  if (dryRun) return;
  if (held < needed) {
    throw new Error(
      `insufficient devnet SOL: fund ${admin.publicKey.toBase58()} with ${((needed - held) / 1e9 + 0.05).toFixed(2)} SOL`,
    );
  }
  await ensureFunded(connection, admin, needed / 1e9, "oracle-authority");

  for (const entry of entries) {
    if (entry.liquidityVault) {
      console.log(`${entry.id.padEnd(9)} already created · ${entry.liquidityVault.portfolio}`);
      continue;
    }

    const market = new PublicKey(entry.market);
    const owner = loadOrCreateWallet(`liquidity-${entry.currency.toLowerCase()}`);
    const portfolio = Keypair.generate();
    const ownerAta = (
      await getOrCreateAssociatedTokenAccount(connection, admin, mint, owner.publicKey)
    ).address;
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultAuthority(market), true);
    const current = await connection.getTokenAccountBalance(ownerAta, "confirmed");
    const currentAtoms = BigInt(current.value.amount);
    if (currentAtoms < CAPITAL_ATOMS) {
      await mintTo(connection, admin, mint, ownerAta, admin, CAPITAL_ATOMS - currentAtoms);
    }

    await send(
      connection,
      [admin, owner, portfolio],
      [
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: portfolio.publicKey,
          lamports: rent,
          space: PORTFOLIO_ACCOUNT_LEN,
          programId: new PublicKey(registry.percolatorProgram),
        }),
        ixInitPortfolio(owner.publicKey, market, portfolio.publicKey),
        ixDeposit(owner.publicKey, market, portfolio.publicKey, ownerAta, vaultAta, CAPITAL_ATOMS),
      ],
      { label: `Create liquidity portfolio ${entry.id}` },
    );

    entry.liquidityVault = {
      authority: owner.publicKey.toBase58(),
      portfolio: portfolio.publicKey.toBase58(),
      capitalAtoms: CAPITAL_ATOMS.toString(),
      maxNotionalUsdc: entry.status === "beta" ? 2_000 : 5_000,
      maxOpenInterestUsdc: entry.status === "beta" ? 20_000 : 50_000,
      createdAt: new Date().toISOString(),
    };
    saveRegistry(registry);
    console.log(`${entry.id.padEnd(9)} created · ${portfolio.publicKey.toBase58()}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
