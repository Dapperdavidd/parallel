import { recentTrades, recordTrade } from "@/lib/server/data";
import { holdQuote } from "@/lib/server/quotes";
import { CEILINGS, readJson, route } from "@/lib/server/request";
import { ok } from "@/lib/server/respond";
import { address, shape, signature, text } from "@/lib/server/validate";
import { verifyTrade } from "@/lib/server/verify-trade";

/**
 * The trade history.
 *
 * GET reads what has been stored. POST adds a row, and only ever from two
 * things the caller cannot forge: a quote this server signed, and a
 * transaction devnet confirmed. See `lib/server/verify-trade.ts` — a client
 * cannot author history here, and can no longer colour it in either.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAGE = 100;

export const GET = route("trades.read", { ceiling: CEILINGS.read, sameOrigin: false }, async ({ url }) => {
  const wallet = url.searchParams.get("wallet");
  if (wallet) {
    // Parsed for its side effect: a malformed address should be a 400 rather
    // than a silent empty page.
    address()(wallet, "wallet");
  }
  const marketId = url.searchParams.get("marketId");
  const limit = Math.min(
    MAX_PAGE,
    Math.max(1, Number(url.searchParams.get("limit") ?? 40) || 40),
  );

  // Filtering by wallet happens after the read, so widen the window first.
  const rows = await recentTrades(marketId, wallet ? 200 : limit);
  const filtered = wallet ? rows.filter((row) => row.wallet === wallet) : rows;
  return ok(
    { trades: filtered.slice(0, limit) },
    // Public, and a few seconds stale is fine: the feed polls.
    { "Cache-Control": "public, max-age=2, stale-while-revalidate=10" },
  );
});

const body = shape({
  signature: signature(),
  /** The signed quote from a prepare route. Everything recorded comes from it. */
  quoteToken: text({ max: 2_048 }),
});

export const POST = route("trades.write", { ceiling: CEILINGS.write }, async ({ request }) => {
  const input = await readJson(request, body);
  const held = holdQuote(input.quoteToken);

  const trade = await verifyTrade({ signature: input.signature, quote: held.payload });
  // Spend the quote only once the chain has agreed with it, so a failed
  // verification leaves the caller able to retry the same quote.
  held.spend();
  await recordTrade(trade);
  return ok({ trade });
});
