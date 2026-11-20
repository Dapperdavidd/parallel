/**
 * Devnet plumbing: connection, wallets, transaction sending, signature logging.
 *
 * SAFETY: this module refuses to run against anything but devnet. Parallel is a
 * devnet-only project (PRD rule) and a mis-set RPC URL is the easiest way to
 * break that rule by accident.
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  type Signer,
} from "@solana/web3.js";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DEVNET_RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

/** Live Percolator v16 wrapper on devnet. See DECISIONS.md §3.2 — this is NOT
 *  either of the two program IDs quoted in the PRD, both of which are v12-era. */
export const PERCOLATOR_PROGRAM_ID = new PublicKey(
  "Bu1J8eQQN2mNnUgisSEd5StBG6zDaRb7fwDjN34VzgLG",
);

/** Passive/vAMM matcher, for the TradeCpi path. Not used by the Phase 1 spikes. */
export const MATCHER_PROGRAM_ID = new PublicKey(
  "5ogNxr4uFXZXoeJ4cP89kKZkx1FkbaD2FBQr91KoYZep",
);

/** v16 boxes ~19K of MarketGroup and ~7K of Portfolio on the heap; the 32 KiB
 *  default is not enough. Every working upstream script requests 256 KiB. */
export const HEAP_FRAME_BYTES = 256 * 1024;
export const DEFAULT_COMPUTE_UNITS = 1_400_000;

export function getConnection(): Connection {
  if (!/devnet/i.test(DEVNET_RPC)) {
    throw new Error(
      `refusing to connect: SOLANA_RPC_URL does not look like devnet (${DEVNET_RPC}). ` +
        `Parallel is devnet-only.`,
    );
  }
  return new Connection(DEVNET_RPC, "confirmed");
}

/* ------------------------------------------------------------------ *
 * Wallets — gitignored, devnet only (PRD rule 9)
 * ------------------------------------------------------------------ */

const WALLET_DIR = "wallets";

/**
 * Loads a named keypair from `wallets/<name>.json`, creating it if absent.
 * These are devnet throwaways. The directory is gitignored.
 */
export function loadOrCreateWallet(name: string): Keypair {
  const path = `${WALLET_DIR}/${name}.json`;
  if (existsSync(path)) {
    const secret = JSON.parse(readFileSync(path, "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }
  mkdirSync(dirname(path), { recursive: true });
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify([...kp.secretKey]), { mode: 0o600 });
  console.log(`  created devnet wallet ${name}: ${kp.publicKey.toBase58()}`);
  return kp;
}

/** Tops a wallet up from the devnet faucet if it is below `minSol`. */
export async function ensureFunded(
  conn: Connection,
  kp: Keypair,
  minSol: number,
  label: string,
): Promise<number> {
  const lamports = await conn.getBalance(kp.publicKey);
  const sol = lamports / 1e9;
  if (sol >= minSol) return sol;

  console.log(`  ${label} has ${sol.toFixed(4)} SOL, requesting airdrop…`);
  try {
    const sig = await conn.requestAirdrop(kp.publicKey, 1e9);
    await conn.confirmTransaction(sig, "confirmed");
  } catch (err) {
    throw new Error(
      `${label} has ${sol.toFixed(4)} SOL (need ${minSol}) and the faucet refused: ` +
        `${err instanceof Error ? err.message : String(err)}. ` +
        `Fund ${kp.publicKey.toBase58()} manually, e.g. at https://faucet.solana.com`,
    );
  }
  return (await conn.getBalance(kp.publicKey)) / 1e9;
}

/* ------------------------------------------------------------------ *
 * Transactions
 * ------------------------------------------------------------------ */

export interface SendOpts {
  computeUnits?: number;
  /** Set false for instructions that never touch the heap (e.g. plain transfers). */
  heapFrame?: boolean;
  label: string;
}

/**
 * Sends instructions with Percolator's required compute budget and heap frame,
 * then logs the signature (PRD rule 9: log every transaction signature).
 */
export async function send(
  conn: Connection,
  signers: Signer[],
  ixs: TransactionInstruction[],
  opts: SendOpts,
): Promise<string> {
  const { computeUnits = DEFAULT_COMPUTE_UNITS, heapFrame = true, label } = opts;

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  if (heapFrame) tx.add(ComputeBudgetProgram.requestHeapFrame({ bytes: HEAP_FRAME_BYTES }));
  for (const ix of ixs) tx.add(ix);

  const payer = signers[0];
  if (!payer) throw new Error("send() needs at least one signer");

  const t0 = Date.now();
  try {
    const sig = await sendAndConfirmTransaction(conn, tx, signers, {
      commitment: "confirmed",
      skipPreflight: false,
    });
    const ms = Date.now() - t0;
    logSignature({ label, signature: sig, ms, ok: true });
    console.log(`  ✓ ${label} — ${ms}ms — ${sig}`);
    return sig;
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    logSignature({ label, signature: null, ms, ok: false, error: msg });
    console.error(`  ✗ ${label} — ${ms}ms — ${msg}`);
    throw err;
  }
}

export interface SigRecord {
  label: string;
  signature: string | null;
  ms: number;
  ok: boolean;
  error?: string;
}

const SIG_LOG = "out/signatures.jsonl";

/** Appends to a durable newline-delimited log of every transaction attempted. */
export function logSignature(rec: SigRecord): void {
  mkdirSync("out", { recursive: true });
  appendFileSync(SIG_LOG, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n");
}

/* ------------------------------------------------------------------ *
 * Slots
 * ------------------------------------------------------------------ */

/**
 * Reads the current slot.
 *
 * Percolator's per-slot price-move budget is ZERO when `now_slot` equals the
 * engine's current slot, so two pushes or two cranks in the same slot fail or
 * trip a recovery gate (DECISIONS.md §3.4). Always re-read before each call.
 */
export async function nowSlot(conn: Connection): Promise<bigint> {
  return BigInt(await conn.getSlot("confirmed"));
}

/** Waits until the chain has advanced past `after`, so the step budget is non-zero. */
export async function waitForSlotAfter(
  conn: Connection,
  after: bigint,
  timeoutMs = 30_000,
): Promise<bigint> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await nowSlot(conn);
    if (s > after) return s;
    if (Date.now() > deadline) throw new Error(`slot did not advance past ${after} in ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

/* ------------------------------------------------------------------ *
 * Price scale
 * ------------------------------------------------------------------ */

export const E6 = 1_000_000;

/** USD price -> the engine's e6 integer. Prices are e6 throughout Percolator. */
export function toE6(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error(`bad price: ${usd}`);
  return BigInt(Math.round(usd * E6));
}

export function fromE6(e6: bigint): number {
  return Number(e6) / E6;
}
