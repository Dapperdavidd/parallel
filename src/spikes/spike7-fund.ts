/**
 * SPIKE 7, part 1 — fund a Privy embedded wallet.
 *
 * The Privy wallet is created in the browser and has nothing in it. Before it
 * can hold mock USDC or sign a Percolator instruction it needs:
 *   - a little devnet SOL for rent and fees
 *   - an associated token account for our mock USDC, with a balance
 *
 * Funding comes from `wallets/oracle-authority.json`, which this project
 * generated and which is the mock USDC mint authority. It never touches the
 * operator's personal Solana CLI keypair.
 *
 *   npm run spike7:fund <privy-wallet-address>
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";

import {
  getConnection,
  loadOrCreateWallet,
  ensureFunded,
  send,
  withRetry,
} from "../lib/solana.js";

const STATE_PATH = "out/parallel-devnet.json";
const DIM = "\x1b[2m", OFF = "\x1b[0m", GREEN = "\x1b[32m";

const SOL_FOR_WALLET = 0.12; // portfolio rent is ~0.066 SOL, plus fees
const USDC_FOR_WALLET = 5_000_000_000n; // 5,000 mock USDC

/** Reads one key from the gitignored root .env, without adding a dependency. */
function readEnv(key: string): string | null {
  if (!existsSync(".env")) return null;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`));
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Writes the page's static config and its Privy app id. */
function writePageConfig(market: string, collateralMint: string): void {
  mkdirSync("spike7/public", { recursive: true });
  writeFileSync(
    "spike7/public/devnet.json",
    JSON.stringify(
      {
        rpc: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
        market,
        collateralMint,
      },
      null,
      2,
    ),
  );
  const appId = readEnv("PRIVY_APP_ID");
  if (appId) {
    writeFileSync("spike7/.env.local", `VITE_PRIVY_APP_ID=${appId}\n`);
    console.log(`  wrote spike7/public/devnet.json and spike7/.env.local`);
  } else {
    console.log(`  wrote spike7/public/devnet.json`);
    console.log(`  ${DIM}PRIVY_APP_ID not found in .env — the page will refuse to start${OFF}`);
  }
}

async function main(): Promise<void> {
  const configOnly = process.argv.includes("--config-only");
  const raw = configOnly ? null : process.argv[2];

  if (!configOnly && !raw) {
    console.error("usage: npm run spike7:fund <privy-wallet-address>");
    console.error("       npm run spike7:fund -- --config-only");
    console.error("\nSign in on the spike 7 page first; it prints the address.");
    process.exit(1);
  }

  if (configOnly) {
    if (!existsSync(STATE_PATH)) throw new Error(`${STATE_PATH} not found — run \`npm run spike1\``);
    const s = JSON.parse(readFileSync(STATE_PATH, "utf8")) as {
      collateralMint?: string; market?: string;
    };
    if (!s.market || !s.collateralMint) throw new Error("state incomplete — run `npm run spike1`");
    console.log(`\n${DIM}Parallel — spike 7: writing page config only${OFF}\n`);
    writePageConfig(s.market, s.collateralMint);
    console.log(`\n${GREEN}✓ ready${OFF} — start the page with \`npm run spike7\`\n`);
    return;
  }

  let target: PublicKey;
  try {
    target = new PublicKey(raw as string);
  } catch {
    console.error(`"${raw}" is not a valid Solana address.`);
    console.error("Privy creates Ethereum wallets too — make sure you copied the Solana one.");
    process.exit(1);
  }

  if (!existsSync(STATE_PATH)) throw new Error(`${STATE_PATH} not found — run \`npm run spike1\` first`);
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as {
    collateralMint?: string; market?: string;
  };
  if (!state.collateralMint) throw new Error("no collateral mint in state — run `npm run spike1`");

  const conn = getConnection();
  const admin = loadOrCreateWallet("oracle-authority");
  const mint = new PublicKey(state.collateralMint);

  console.log(`\n${DIM}Parallel — spike 7: fund a Privy embedded wallet${OFF}`);
  console.log(`${DIM}target ${target.toBase58()}${OFF}\n`);

  await ensureFunded(conn, admin, 0.3, "oracle-authority");

  // ---- SOL ----
  const solNow = (await withRetry(() => conn.getBalance(target), "balance")) / 1e9;
  console.log(`1. devnet SOL (${solNow.toFixed(4)} held)`);
  if (solNow < SOL_FOR_WALLET) {
    const lamports = Math.ceil((SOL_FOR_WALLET - solNow) * 1e9);
    await send(
      conn,
      [admin],
      [SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: target, lamports })],
      { label: `transfer ${(lamports / 1e9).toFixed(3)} SOL`, heapFrame: false, computeUnits: 20_000 },
    );
  } else {
    console.log(`  ${DIM}already funded${OFF}`);
  }

  // ---- mock USDC ----
  console.log(`\n2. mock USDC`);
  const ata = getAssociatedTokenAddressSync(mint, target);
  await send(
    conn,
    [admin],
    [createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, target, mint)],
    { label: "create token account", heapFrame: false, computeUnits: 60_000 },
  );

  const held = (await getAccount(conn, ata)).amount;
  if (held < USDC_FOR_WALLET) {
    await mintTo(conn, admin, mint, ata, admin, USDC_FOR_WALLET - held);
  }
  const after = (await getAccount(conn, ata)).amount;

  // The page reads its devnet config from a static file rather than being
  // rebuilt whenever spike 1 makes a new market.
  console.log();
  writePageConfig(state.market ?? "", state.collateralMint);

  console.log(`\n${GREEN}✓ funded${OFF}`);
  console.log(`  address   ${target.toBase58()}`);
  console.log(`  SOL       ${((await conn.getBalance(target)) / 1e9).toFixed(4)}`);
  console.log(`  mock USDC ${(Number(after) / 1e6).toLocaleString("en-US")}`);
  console.log(`  token acct ${ata.toBase58()}`);
  console.log(`  market    ${state.market ?? "—"}\n`);
  console.log(`${DIM}Now return to the spike 7 page and open a position.${OFF}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nspike7:fund failed:", err);
    process.exit(1);
  });
