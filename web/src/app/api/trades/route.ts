import { Connection, PublicKey } from "@solana/web3.js";
import { listMarkets, recentTrades, recordTrade } from "@/lib/server/data";
import { notionalAtoms, PERCOLATOR_PROGRAM_ID } from "@/lib/server/percolator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  signature?: string;
  wallet?: string;
  portfolio?: string;
  marketId?: string;
  action?: "open" | "close";
  leverage?: number;
}

const fail = (error: string, status = 400) => Response.json({ error }, { status });

function connection(): Connection {
  const rpc = process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  if (!/devnet/i.test(rpc)) throw new Error("Trade history refuses a non-devnet RPC");
  return new Connection(rpc, "confirmed");
}

const readI128 = (data: Uint8Array, offset: number): bigint => {
  const bytes = Buffer.from(data);
  const value = bytes.readBigUInt64LE(offset) + (bytes.readBigUInt64LE(offset + 8) << 64n);
  return value >= 1n << 127n ? value - (1n << 128n) : value;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  const marketId = url.searchParams.get("marketId");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 40)));
  const rows = await recentTrades(marketId, wallet ? 200 : limit);
  return Response.json({ trades: (wallet ? rows.filter((row) => row.wallet === wallet) : rows).slice(0, limit) });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Cross-origin trade records are refused", 403);

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return fail("A JSON trade record is required");
  }
  if (body.action !== "open" && body.action !== "close") return fail("Action must be open or close");
  const leverage = Number(body.leverage);
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > 100) return fail("Invalid leverage");

  let wallet: PublicKey;
  let portfolio: PublicKey;
  try {
    wallet = new PublicKey(String(body.wallet ?? ""));
    portfolio = new PublicKey(String(body.portfolio ?? ""));
  } catch {
    return fail("Valid wallet and portfolio addresses are required");
  }

  try {
    const market = (await listMarkets()).find((entry) => entry.id === body.marketId);
    if (!market?.liquidityVault) return fail("Unknown or unconfigured market", 404);
    const signature = String(body.signature ?? "");
    const tx = await connection().getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx || tx.meta?.err) return fail("Transaction is missing or failed", 409);
    const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
    const instruction = tx.transaction.message.compiledInstructions.find(
      (entry) => keys[entry.programIdIndex]?.equals(PERCOLATOR_PROGRAM_ID) && entry.data[0] === 6,
    );
    if (!instruction) return fail("Transaction has no Percolator trade", 409);
    const accounts = instruction.accountKeyIndexes.map((index) => keys[index]!.toBase58());
    const expected = [
      wallet.toBase58(),
      market.liquidityVault.authority,
      market.market,
      portfolio.toBase58(),
      market.liquidityVault.portfolio,
    ];
    if (expected.some((address, index) => accounts[index] !== address)) {
      return fail("Transaction accounts do not match this trade", 409);
    }

    const data = Buffer.from(instruction.data);
    if (data.readUInt16LE(1) !== 0) return fail("Unsupported asset index", 409);
    const sizeQ = readI128(data, 3);
    const priceE6 = data.readBigUInt64LE(19);
    const side = body.action === "open" ? (sizeQ > 0n ? "long" : "short") : sizeQ < 0n ? "long" : "short";
    const blockTime = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : new Date().toISOString();
    const trade = {
      marketId: market.id,
      wallet: wallet.toBase58(),
      side: side as "long" | "short",
      action: body.action,
      sizeUsdc: Number(notionalAtoms(sizeQ, priceE6)) / 1e6,
      leverage,
      price: Number(priceE6) / 1e6,
      txSignature: signature,
      ts: blockTime,
    };
    await recordTrade(trade);
    return Response.json({ trade });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Trade record failed", 500);
  }
}
