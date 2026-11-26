import { recentHedges, recordHedge } from "@/lib/server/data";
import { holdQuote } from "@/lib/server/quotes";
import { CEILINGS, readJson, route } from "@/lib/server/request";
import { ok, reject } from "@/lib/server/respond";
import { address, calendarDay, number, shape, signature, text } from "@/lib/server/validate";
import { verifyTrade } from "@/lib/server/verify-trade";

/**
 * F9 — hedge mode.
 *
 * A hedge is not a different kind of position: it is a 1x long on the market
 * for the currency being protected, opened through the same guarded route as
 * any other trade. What this endpoint stores is the *intent* — the local
 * amount and the date it is needed by — and it will only store it against a
 * position that really exists.
 *
 * So it goes through the same two-sided verification as `/api/trades`: the
 * server's own signed quote, and the confirmed transaction. It additionally
 * requires an **open**, **long**, 1x position; a close, a short, or a levered
 * position cannot be filed as a hedge.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("hedge.read", { ceiling: CEILINGS.read }, async ({ url }) => {
  const wallet = address()(url.searchParams.get("wallet") ?? undefined, "wallet");
  return ok({ hedges: await recentHedges(wallet.toBase58()) });
});

const body = shape({
  signature: signature(),
  quoteToken: text({ max: 2_048 }),
  /** How much local currency this position is protecting. */
  amountLocal: number({ min: 0.01, max: 1e12 }),
  dueDate: calendarDay(),
});

export const POST = route("hedge.write", { ceiling: CEILINGS.write }, async ({ request }) => {
  const input = await readJson(request, body);
  const held = holdQuote(input.quoteToken);

  // A hedge is always opened at 1x: the position is the same dollar size as
  // the savings it protects, which is what makes the two cancel out.
  if (held.payload.action !== "open") reject("conflict", "A hedge is an opening position");
  if (held.payload.side !== "long") reject("conflict", "A hedge is a long position");
  if (held.payload.leverage !== 1) reject("conflict", "A hedge is opened at 1x, without leverage");

  const trade = await verifyTrade({ signature: input.signature, quote: held.payload });
  held.spend();

  await recordHedge({
    wallet: trade.wallet,
    marketId: trade.marketId,
    amountLocal: input.amountLocal,
    amountUsd: trade.sizeUsdc,
    dueDate: input.dueDate,
    txSignature: trade.txSignature,
    createdAt: trade.ts,
  });
  return ok({ hedge: { ...trade, amountLocal: input.amountLocal, dueDate: input.dueDate } });
});
