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

const DIM = "\x1b[2m";
const OFF = "\x1b[0m";
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

/**
 * Priority fee. Devnet is congested enough that unprioritised transactions get
 * dropped and expire before confirmation — observed repeatedly on 2026-11-20.
 * Upstream's own test suite uses the same 50,000 microLamports.
 */
export const DEFAULT_PRIORITY_MICROLAMPORTS = Number(
  process.env.PRIORITY_MICROLAMPORTS ?? 50_000,
);

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
 * RPC resilience
 *
 * The public devnet endpoint drops connections regularly. A spike that dies
 * halfway through leaves on-chain state half-built, so reads retry.
 * ------------------------------------------------------------------ */

export async function withRetry<T>(
  fn: () => Promise<T>,
  what: string,
  attempts = 4,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const wait = 500 * 2 ** i;
        console.log(`  ${DIM}${what} failed (attempt ${i + 1}/${attempts}), retrying in ${wait}ms${OFF}`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw new Error(
    `${what} failed after ${attempts} attempts: ` +
      `${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/** Reads an account, retrying through transient RPC failures. */
export async function getAccountData(conn: Connection, pubkey: PublicKey): Promise<Buffer> {
  const info = await withRetry(
    () => conn.getAccountInfo(pubkey, "confirmed"),
    `read ${pubkey.toBase58().slice(0, 8)}…`,
  );
  if (!info) throw new Error(`account ${pubkey.toBase58()} not found`);
  return info.data;
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
  if (name === "oracle-authority") {
    const inline = process.env.PARALLEL_ORACLE_AUTHORITY_SECRET;
    if (inline) {
      const secret = JSON.parse(inline) as number[];
      const keypair = Keypair.fromSecretKey(Uint8Array.from(secret));
      console.log(`  loaded devnet wallet ${name} from the environment`);
      return keypair;
    }
  }
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

/**
 * Ensures a wallet holds at least `minSol`, or explains exactly how to fund it.
 *
 * Deliberately does NOT read the operator's personal keypair. Devnet's airdrop
 * RPC currently answers 410 Gone, so funding is a manual, explicit step — which
 * is the right shape for anything that moves money, even play money.
 */
export async function ensureFunded(
  conn: Connection,
  kp: Keypair,
  minSol: number,
  label: string,
): Promise<number> {
  const balance = async (): Promise<number> =>
    (await withRetry(() => conn.getBalance(kp.publicKey), `balance of ${label}`)) / 1e9;

  let sol = await balance();
  if (sol >= minSol) return sol;

  const needed = minSol - sol;
  console.log(`  ${label} has ${sol.toFixed(4)} SOL, needs ${minSol}`);

  try {
    const sig = await conn.requestAirdrop(kp.publicKey, Math.ceil(needed * 1e9));
    await conn.confirmTransaction(sig, "confirmed");
    sol = await balance();
    if (sol >= minSol) {
      console.log(`  airdropped → ${sol.toFixed(4)} SOL`);
      return sol;
    }
  } catch {
    console.log(`  ${DIM}devnet faucet unavailable${OFF}`);
  }

  throw new Error(
    `${label} (${kp.publicKey.toBase58()}) holds ${sol.toFixed(4)} SOL but needs ${minSol}.\n` +
      `  The devnet airdrop RPC is closed, so fund it with one of:\n` +
      `    solana transfer ${kp.publicKey.toBase58()} ${(needed + 0.05).toFixed(2)} ` +
      `-u devnet --allow-unfunded-recipient\n` +
      `    or paste the address into https://faucet.solana.com`,
  );
}

/* ------------------------------------------------------------------ *
 * Transactions
 * ------------------------------------------------------------------ */

export interface SendOpts {
  computeUnits?: number;
  /** Set false for instructions that never touch the heap (e.g. plain transfers). */
  heapFrame?: boolean;
  label: string;
  /** Retries for transient failures. Program errors are never retried. */
  attempts?: number;
}

/**
 * A failure worth retrying: the network dropped the request or the blockhash
 * expired before confirmation. A `custom program error` is deterministic — the
 * program rejected the instruction — and retrying it only wastes time.
 */
function isTransient(msg: string): boolean {
  if (/custom program error|invalid instruction data|insufficient funds/i.test(msg)) return false;
  return /block height exceeded|blockhash|fetch failed|timeout|ECONNRESET|503|502|429|Too Many Requests|was not confirmed/i.test(
    msg,
  );
}

/**
 * Did a transaction we lost track of actually land?
 *
 * A confirmation timeout does NOT mean the transaction failed — it means we
 * stopped watching. Blindly resending is how you open a position twice. This
 * cost us a duplicated trade in spike 3 before it was added: the open landed,
 * the confirm timed out, the retry fired, and the second attempt came back
 * `EngineLockActive` against a position that already existed.
 */
async function landed(conn: Connection, signature: string): Promise<boolean> {
  try {
    const st = await conn.getSignatureStatus(signature, { searchTransactionHistory: true });
    const v = st.value;
    if (!v) return false;
    if (v.err) return false;
    return v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized";
  } catch {
    return false;
  }
}

/** web3.js attaches the signature to expiry errors; dig it out if present. */
function signatureOf(err: unknown): string | null {
  const s = (err as { signature?: unknown })?.signature;
  return typeof s === "string" && s.length > 0 ? s : null;
}

/**
 * Sends instructions with Percolator's required compute budget and heap frame,
 * then logs the signature (PRD rule 9: log every transaction signature).
 *
 * Retries transient RPC failures with a fresh blockhash. The public devnet
 * endpoint drops requests and lets transactions expire often enough that the
 * oracle keeper would be unreliable without this.
 */
export async function send(
  conn: Connection,
  signers: Signer[],
  ixs: TransactionInstruction[],
  opts: SendOpts,
): Promise<string> {
  const {
    computeUnits = DEFAULT_COMPUTE_UNITS,
    heapFrame = true,
    label,
    attempts = 3,
  } = opts;

  const payer = signers[0];
  if (!payer) throw new Error("send() needs at least one signer");

  const t0 = Date.now();
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    // A fresh Transaction each time, so it picks up a new blockhash.
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
    // Escalate the priority fee on each retry — if the first price was too low
    // to land during a congestion spike, repeating it will not help.
    tx.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: DEFAULT_PRIORITY_MICROLAMPORTS * attempt,
      }),
    );
    if (heapFrame) tx.add(ComputeBudgetProgram.requestHeapFrame({ bytes: HEAP_FRAME_BYTES }));
    for (const ix of ixs) tx.add(ix);

    try {
      const sig = await sendAndConfirmTransaction(conn, tx, signers, {
        commitment: "confirmed",
        skipPreflight: false,
        maxRetries: 10,
      });
      const ms = Date.now() - t0;
      logSignature({ label, signature: sig, ms, ok: true, attempts: attempt });
      console.log(`  ✓ ${label} — ${ms}ms${attempt > 1 ? ` (attempt ${attempt})` : ""} — ${sig}`);
      return sig;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);

      // Before concluding anything, find out whether it actually landed.
      // A confirmation timeout means we stopped watching, not that it failed.
      const sig = signatureOf(err);
      if (sig) {
        await new Promise((r) => setTimeout(r, 2000));
        if (await landed(conn, sig)) {
          const ms = Date.now() - t0;
          logSignature({ label, signature: sig, ms, ok: true, attempts: attempt });
          console.log(`  ✓ ${label} — ${ms}ms (confirm timed out, but it landed) — ${sig}`);
          return sig;
        }
      }

      if (attempt < attempts && isTransient(msg)) {
        console.log(`  ${DIM}${label}: ${msg.split("\n")[0]} — retrying (${attempt}/${attempts})${OFF}`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      const ms = Date.now() - t0;
      logSignature({ label, signature: null, ms, ok: false, error: msg, attempts: attempt });
      console.error(`  ✗ ${label} — ${ms}ms — ${msg}`);
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface SigRecord {
  label: string;
  signature: string | null;
  ms: number;
  attempts?: number;
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
  return BigInt(await withRetry(() => conn.getSlot("confirmed"), "read current slot"));
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
