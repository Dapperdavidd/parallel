import { PublicKey } from "@solana/web3.js";
import { recentHedges, recordHedge } from "@/lib/server/data";
import { TradeVerificationError, verifyTrade } from "@/lib/server/verify-trade";

/**
 * F9 — hedge mode.
 *
 * A hedge is not a different kind of position: it is a 1x long on the market
 * for the currency being protected, opened through the same guarded route as
 * any other trade. What this endpoint stores is the *intent* — the local
 * amount and the date it is needed by — and it will only store it against a
 * position that really exists.
 *
 * So the signature goes through the same verification as `/api/trades`, and is
 * additionally required to be an **open**, **long** position: a close or a
 * short cannot be filed as a hedge.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  signature?: string;
  wallet?: string;
  portfolio?: string;
  marketId?: string;
  amountLocal?: number;
  dueDate?: string;
}

const fail = (error: string, status = 400): Response => Response.json({ error }, { status });

/** `YYYY-MM-DD`, and a real date in that calendar. */
function validDueDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function GET(request: Request): Promise<Response> {
  const wallet = new URL(request.url).searchParams.get("wallet");
  if (!wallet) return fail("A wallet address is required");
  try {
    new PublicKey(wallet);
  } catch {
    return fail("A valid wallet address is required");
  }
  return Response.json({ hedges: await recentHedges(wallet) });
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return fail("Cross-origin hedge records are refused", 403);
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return fail("A JSON hedge record is required");
  }

  const amountLocal = Number(body.amountLocal);
  if (!Number.isFinite(amountLocal) || amountLocal <= 0) {
    return fail("The amount being hedged must be a positive number");
  }
  const dueDate = String(body.dueDate ?? "");
  if (!validDueDate(dueDate)) return fail("A due date of the form YYYY-MM-DD is required");

  let wallet: PublicKey;
  let portfolio: PublicKey;
  try {
    wallet = new PublicKey(String(body.wallet ?? ""));
    portfolio = new PublicKey(String(body.portfolio ?? ""));
  } catch {
    return fail("Valid wallet and portfolio addresses are required");
  }

  try {
    // A hedge is always opened at 1x: the position is the same dollar size as
    // the savings it protects, which is what makes the two cancel out.
    const trade = await verifyTrade({
      signature: String(body.signature ?? ""),
      wallet,
      portfolio,
      marketId: body.marketId,
      action: "open",
      leverage: 1,
    });
    if (trade.side !== "long") return fail("A hedge is a long position", 409);

    await recordHedge({
      wallet: trade.wallet,
      marketId: trade.marketId,
      amountLocal,
      amountUsd: trade.sizeUsdc,
      dueDate,
      txSignature: trade.txSignature,
      createdAt: trade.ts,
    });
    return Response.json({ hedge: { ...trade, amountLocal, dueDate } });
  } catch (error) {
    if (error instanceof TradeVerificationError) return fail(error.message, error.status);
    return fail(error instanceof Error ? error.message : "The hedge record failed", 500);
  }
}
