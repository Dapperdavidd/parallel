import { PublicKey } from "@solana/web3.js";
import { recentTrades, recordTrade } from "@/lib/server/data";
import { TradeVerificationError, verifyTrade } from "@/lib/server/verify-trade";

/**
 * The wallet's trade history.
 *
 * GET reads what has been stored. POST adds a row, but only after the server
 * has confirmed the signature on devnet and matched the instruction — see
 * `lib/server/verify-trade.ts`. A client cannot author history here.
 */

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

const fail = (error: string, status = 400): Response => Response.json({ error }, { status });

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  const marketId = url.searchParams.get("marketId");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 40)));
  // Filtering by wallet happens after the read, so widen the window first.
  const rows = await recentTrades(marketId, wallet ? 200 : limit);
  const filtered = wallet ? rows.filter((row) => row.wallet === wallet) : rows;
  return Response.json({ trades: filtered.slice(0, limit) });
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return fail("Cross-origin trade records are refused", 403);
  }

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
    const trade = await verifyTrade({
      signature: String(body.signature ?? ""),
      wallet,
      portfolio,
      marketId: body.marketId,
      action: body.action,
      leverage,
    });
    await recordTrade(trade);
    return Response.json({ trade });
  } catch (error) {
    if (error instanceof TradeVerificationError) return fail(error.message, error.status);
    return fail(error instanceof Error ? error.message : "Trade record failed", 500);
  }
}
