import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { latestTick, listMarkets } from "@/lib/server/data";
import {
  marketRiskState,
  notionalAtoms,
  sizeQForNotional,
  tradeNoCpi,
} from "@/lib/server/percolator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  wallet?: string;
  portfolio?: string;
  marketId?: string;
  side?: "long" | "short";
  marginUsdc?: number;
  leverage?: number;
}

function connection(): Connection {
  const rpc = process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  if (!/devnet/i.test(rpc)) throw new Error("Trading refuses a non-devnet RPC");
  return new Connection(rpc, "confirmed");
}

async function vaultSigner(currency: string, expected: string): Promise<Keypair> {
  const map = process.env.PARALLEL_LIQUIDITY_SECRETS;
  let bytes: number[];
  if (map) {
    const parsed = JSON.parse(map) as Record<string, number[]>;
    bytes = parsed[currency] ?? [];
  } else {
    const path = join(process.cwd(), "..", "wallets", `liquidity-${currency.toLowerCase()}.json`);
    bytes = JSON.parse(await readFile(path, "utf8")) as number[];
  }
  const signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
  if (signer.publicKey.toBase58() !== expected) throw new Error("Liquidity authority does not match the registry");
  return signer;
}

const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Cross-origin trades are refused", 403);

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return fail("A JSON trade request is required");
  }

  let user: PublicKey;
  let userPortfolio: PublicKey;
  try {
    user = new PublicKey(String(body.wallet ?? ""));
    userPortfolio = new PublicKey(String(body.portfolio ?? ""));
  } catch {
    return fail("Valid wallet and portfolio addresses are required");
  }

  const margin = Number(body.marginUsdc);
  const leverage = Number(body.leverage);
  if (!Number.isFinite(margin) || margin < 10 || margin > 5_000) return fail("Margin must be between 10 and 5,000 tUSDC");
  if (!Number.isInteger(leverage) || leverage < 1) return fail("Leverage must be a positive whole number");
  if (body.side !== "long" && body.side !== "short") return fail("Side must be long or short");

  try {
    const market = (await listMarkets()).find((entry) => entry.id === body.marketId);
    if (!market) return fail("Unknown market", 404);
    if (!market.liquidityVault) return fail("This market's liquidity portfolio is not ready", 503);
    if (leverage > market.maxLeverage) return fail(`This market allows at most ${market.maxLeverage}x leverage`);

    const tick = await latestTick(market.id);
    if (!tick || tick.median === null || tick.unitPriceUsd === null || tick.status === "paused") {
      return fail("This market is paused because its index is not healthy", 409);
    }

    const requestedNotional = margin * leverage;
    if (requestedNotional > market.liquidityVault.maxNotionalUsdc) {
      return fail(`Maximum notional per trade is ${market.liquidityVault.maxNotionalUsdc} tUSDC`, 409);
    }

    const conn = connection();
    const marketKey = new PublicKey(market.market);
    const marketAccount = await conn.getAccountInfo(marketKey, "confirmed");
    if (!marketAccount) return fail("The devnet market account is unavailable", 503);
    const risk = marketRiskState(marketAccount.data);
    const notionalInAtoms = BigInt(Math.round(requestedNotional * 1e6));
    const absoluteSizeQ = sizeQForNotional(notionalInAtoms, risk.effectivePriceE6);
    const sizeQ = body.side === "long" ? absoluteSizeQ : -absoluteSizeQ;
    const resultingSideOi =
      notionalAtoms(
        body.side === "long" ? risk.openInterestLongQ + absoluteSizeQ : risk.openInterestShortQ + absoluteSizeQ,
        risk.effectivePriceE6,
      ) / 1_000_000n;
    if (resultingSideOi > BigInt(market.liquidityVault.maxOpenInterestUsdc)) {
      return fail("The market open-interest limit would be exceeded", 409);
    }

    const signer = await vaultSigner(market.currency, market.liquidityVault.authority);
    const transaction = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }),
      tradeNoCpi({
        user,
        vaultAuthority: signer.publicKey,
        market: marketKey,
        userPortfolio,
        vaultPortfolio: new PublicKey(market.liquidityVault.portfolio),
        sizeQ,
        effectivePriceE6: risk.effectivePriceE6,
      }),
    );
    transaction.feePayer = user;
    transaction.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    transaction.partialSign(signer);

    return Response.json({
      transaction: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      quote: {
        marketId: market.id,
        side: body.side,
        marginUsdc: margin,
        leverage,
        notionalUsdc: requestedNotional,
        effectivePriceE6: risk.effectivePriceE6.toString(),
        sizeQ: sizeQ.toString(),
        expiresWithBlockhash: true,
      },
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Trade preparation failed", 500);
  }
}
