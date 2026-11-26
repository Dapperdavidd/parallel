import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { FAUCET_USDC_TARGET_ATOMS } from "@/lib/faucet";
import { faucetClaim, recordFaucetClaim } from "@/lib/server/data";
import { rpcUrl } from "@/lib/server/env";
import { info } from "@/lib/server/log";
import { CEILINGS, readJson, route } from "@/lib/server/request";
import { ok, reject } from "@/lib/server/respond";
import { mintAuthority } from "@/lib/server/signing";
import { address, base64Bytes, shape, text } from "@/lib/server/validate";
import { verifyChallenge } from "@/lib/server/wallet-proof";

/**
 * Devnet test funds, for a wallet that has proved it is yours.
 *
 * This route mints. It used to mint to any address in a POST body, from any
 * origin, as often as asked — a free top-up service for every wallet on
 * devnet, and a way for a stranger with a loop to drain the mint authority's
 * SOL until nobody could trade.
 *
 * Three things now stand in the way, and all three have to pass:
 *
 *  1. a signature from the wallet being funded, over a challenge this server
 *     issued minutes ago (`lib/server/wallet-proof.ts`);
 *  2. a short per-caller ceiling, which stops a loop;
 *  3. a cooldown recorded in the store, which stops the patient version and
 *     survives a restart.
 *
 * The top-up itself is unchanged and still idempotent: it tops a wallet *up
 * to* a target rather than adding to it, so a retry after a timeout cannot
 * double-fund.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET_SOL = 0.12;
const TARGET_USDC_ATOMS = FAUCET_USDC_TARGET_ATOMS;
/** Long enough to be a cooldown, short enough not to strand a real tester. */
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** A wallet asking for a fortieth top-up is not testing. */
const LIFETIME_CLAIMS = 40;

const body = shape({
  wallet: address(),
  /** The token from /api/auth/challenge. */
  proof: text({ max: 1_024 }),
  /** The wallet's signature over that challenge's message. */
  signature: base64Bytes({ bytes: 64 }),
});

async function collateralMint(): Promise<PublicKey> {
  const path = process.env.PARALLEL_REGISTRY ?? join(process.cwd(), "..", "market-registry.json");
  const registry = JSON.parse(await readFile(path, "utf8")) as { collateralMint?: string };
  if (!registry.collateralMint) reject("unavailable", "The devnet faucet is not configured yet");
  return new PublicKey(registry.collateralMint!);
}

export const POST = route("faucet", { ceiling: CEILINGS.faucet }, async ({ request }) => {
  const { wallet, proof, signature } = await readJson(request, body);

  verifyChallenge({ wallet, purpose: "faucet", token: proof, signature });

  const address58 = wallet.toBase58();
  const claim = await faucetClaim(address58);
  if (claim) {
    if (claim.claims >= LIFETIME_CLAIMS) {
      reject("forbidden", "This wallet has taken its share of test funds. Devnet is for testing.");
    }
    const since = Date.now() - new Date(claim.lastClaimAt).getTime();
    if (since < COOLDOWN_MS) {
      const hours = Math.ceil((COOLDOWN_MS - since) / 3_600_000);
      reject("rate_limited", `This wallet can top up again in about ${hours}h.`);
    }
  }

  const [authority, mint] = await Promise.all([mintAuthority(), collateralMint()]);
  const connection = new Connection(rpcUrl(), "confirmed");
  const ata = getAssociatedTokenAddressSync(mint, wallet);
  const [lamports, authorityLamports, ataInfo] = await Promise.all([
    connection.getBalance(wallet, "confirmed"),
    connection.getBalance(authority.publicKey, "confirmed"),
    connection.getAccountInfo(ata, "confirmed"),
  ]);

  const targetLamports = Math.round(TARGET_SOL * 1e9);
  const solNeeded = Math.max(0, targetLamports - lamports);
  if (solNeeded > 0 && authorityLamports < solNeeded + 10_000) {
    reject("unavailable", "The devnet faucet is out of SOL. We are refilling it.");
  }

  const transaction = new Transaction();
  if (!ataInfo) {
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, ata, wallet, mint),
    );
  }
  if (solNeeded > 0) {
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: wallet,
        lamports: solNeeded,
      }),
    );
  }
  if (transaction.instructions.length > 0) {
    await sendAndConfirmTransaction(connection, transaction, [authority], {
      commitment: "confirmed",
      maxRetries: 8,
    });
  }

  const before = (await getAccount(connection, ata, "confirmed")).amount;
  const mintAmount = before < TARGET_USDC_ATOMS ? TARGET_USDC_ATOMS - before : 0n;
  if (mintAmount > 0n) {
    await mintTo(connection, authority, mint, ata, authority, mintAmount, [], {
      commitment: "confirmed",
      maxRetries: 8,
    });
  }
  const after = (await getAccount(connection, ata, "confirmed")).amount;

  // Only a top-up that moved something counts against the cooldown: a wallet
  // already at the target can ask again without being penalised for it.
  if (mintAmount > 0n || solNeeded > 0) {
    await recordFaucetClaim(address58);
    info({ event: "faucet_funded", wallet: address58, addedAtoms: mintAmount.toString() });
  }

  return ok({
    wallet: address58,
    tokenAccount: ata.toBase58(),
    balance: Number(after) / 1e6,
    added: Number(mintAmount) / 1e6,
    network: "devnet",
    nextTopUpAfter: new Date(Date.now() + COOLDOWN_MS).toISOString(),
  });
});
