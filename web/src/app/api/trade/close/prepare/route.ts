import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { listMarkets } from "@/lib/server/data";
import {
  marketRiskState,
  notionalAtoms,
  PERCOLATOR_PROGRAM_ID,
  portfolioState,
  tradeNoCpi,
} from "@/lib/server/percolator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  wallet?: string;
  portfolio?: string;
  marketId?: string;
}

const fail = (error: string, status = 400) => Response.json({ error }, { status });

function connection(): Connection {
  const rpc = process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  if (!/devnet/i.test(rpc)) throw new Error("Trading refuses a non-devnet RPC");
  return new Connection(rpc, "confirmed");
}

async function vaultSigner(currency: string, expected: string): Promise<Keypair> {
  const map = process.env.PARALLEL_LIQUIDITY_SECRETS;
  let bytes: number[];
  if (map) {
    bytes = (JSON.parse(map) as Record<string, number[]>)[currency] ?? [];
  } else {
    const path = join(process.cwd(), "..", "wallets", `liquidity-${currency.toLowerCase()}.json`);
    bytes = JSON.parse(await readFile(path, "utf8")) as number[];
  }
  const signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
  if (signer.publicKey.toBase58() !== expected) throw new Error("Liquidity authority does not match the registry");
  return signer;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Cross-origin trades are refused", 403);

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return fail("A JSON close request is required");
  }

  let user: PublicKey;
  let userPortfolio: PublicKey;
  try {
    user = new PublicKey(String(body.wallet ?? ""));
    userPortfolio = new PublicKey(String(body.portfolio ?? ""));
  } catch {
    return fail("Valid wallet and portfolio addresses are required");
  }

  try {
    const market = (await listMarkets()).find((entry) => entry.id === body.marketId);
    if (!market) return fail("Unknown market", 404);
    if (!market.liquidityVault) return fail("This market's liquidity portfolio is not ready", 503);

    const conn = connection();
    const marketKey = new PublicKey(market.market);
    const [marketAccount, portfolioAccount] = await Promise.all([
      conn.getAccountInfo(marketKey, "confirmed"),
      conn.getAccountInfo(userPortfolio, "confirmed"),
    ]);
    if (!marketAccount || !portfolioAccount) return fail("The devnet market or portfolio is unavailable", 503);
    if (!portfolioAccount.owner.equals(PERCOLATOR_PROGRAM_ID)) return fail("Portfolio is not owned by Percolator", 409);

    const portfolio = portfolioState(portfolioAccount.data);
    if (!portfolio.owner.equals(user)) return fail("This wallet does not own the portfolio", 403);
    if (!portfolio.marketGroupId.equals(marketKey)) return fail("Portfolio belongs to another market", 409);
    const openLegs = portfolio.legs.filter((leg) => leg.assetIndex === 0 && leg.basisPosQ !== 0n);
    if (openLegs.length === 0) return fail("This portfolio has no open position", 409);
    if (openLegs.length !== 1) return fail("This portfolio has an unsupported position layout", 409);

    const risk = marketRiskState(marketAccount.data);
    const closeSizeQ = -openLegs[0]!.basisPosQ;
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
        sizeQ: closeSizeQ,
        effectivePriceE6: risk.effectivePriceE6,
      }),
    );
    transaction.feePayer = user;
    transaction.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    transaction.partialSign(signer);

    return Response.json({
      transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      quote: {
        marketId: market.id,
        side: openLegs[0]!.basisPosQ > 0n ? "long" : "short",
        closeSizeQ: closeSizeQ.toString(),
        notionalUsdc: Number(notionalAtoms(closeSizeQ, risk.effectivePriceE6)) / 1e6,
        effectivePriceE6: risk.effectivePriceE6.toString(),
        expiresWithBlockhash: true,
      },
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Close preparation failed", 500);
  }
}
