import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Connection,
  Keypair,
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET_SOL = 0.12;
const TARGET_USDC_ATOMS = FAUCET_USDC_TARGET_ATOMS;

async function loadAuthority(): Promise<Keypair> {
  const encoded = process.env.PARALLEL_MINT_AUTHORITY_SECRET;
  if (encoded) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(encoded) as number[]));

  const path =
    process.env.PARALLEL_MINT_AUTHORITY_FILE ??
    join(process.cwd(), "..", "wallets", "oracle-authority.json");
  const bytes = JSON.parse(await readFile(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function collateralMint(): Promise<PublicKey> {
  const path = process.env.PARALLEL_REGISTRY ?? join(process.cwd(), "..", "market-registry.json");
  const registry = JSON.parse(await readFile(path, "utf8")) as { collateralMint?: string };
  if (!registry.collateralMint) throw new Error("The market registry has no collateral mint");
  return new PublicKey(registry.collateralMint);
}

function devnetConnection(): Connection {
  const rpc = process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  if (!/devnet/i.test(rpc)) throw new Error("The faucet refuses a non-devnet RPC");
  return new Connection(rpc, "confirmed");
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-origin faucet requests are refused" }, { status: 403 });
  }

  let wallet: PublicKey;
  try {
    const body = (await request.json()) as { wallet?: string };
    wallet = new PublicKey(String(body.wallet ?? ""));
  } catch {
    return Response.json({ error: "A valid Solana wallet is required" }, { status: 400 });
  }

  try {
    const [authority, mint] = await Promise.all([loadAuthority(), collateralMint()]);
    const connection = devnetConnection();
    const ata = getAssociatedTokenAddressSync(mint, wallet);
    const [lamports, authorityLamports, ataInfo] = await Promise.all([
      connection.getBalance(wallet, "confirmed"),
      connection.getBalance(authority.publicKey, "confirmed"),
      connection.getAccountInfo(ata, "confirmed"),
    ]);
    const targetLamports = Math.round(TARGET_SOL * 1e9);
    const solNeeded = Math.max(0, targetLamports - lamports);
    if (solNeeded > 0 && authorityLamports < solNeeded + 10_000) {
      return Response.json({ error: "The devnet faucet needs more SOL" }, { status: 503 });
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

    return Response.json({
      wallet: wallet.toBase58(),
      tokenAccount: ata.toBase58(),
      balance: Number(after) / 1e6,
      added: Number(mintAmount) / 1e6,
      network: "devnet",
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Devnet funding failed" },
      { status: 500 },
    );
  }
}
