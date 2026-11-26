import { recordTrade, tradePage } from "@/lib/server/data";
import { holdQuote } from "@/lib/server/quotes";
import { CEILINGS, readJson, route } from "@/lib/server/request";
import { ok } from "@/lib/server/respond";
import {
  address,
  integer,
  isoTimestamp,
  optional,
  shape,
  signature,
  text,
  withDefault,
} from "@/lib/server/validate";
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

export const GET = route(
  "trades.read",
  { ceiling: CEILINGS.read, sameOrigin: false },
  async ({ url }) => {
    const wallet = optional(address())(url.searchParams.get("wallet") ?? undefined, "wallet");
    const marketId = optional(text({ max: 16, pattern: /^USD\/[A-Z]{3}$/ }))(
      url.searchParams.get("marketId") ?? undefined,
      "marketId",
    );
    const before = optional(isoTimestamp())(url.searchParams.get("before") ?? undefined, "before");
    const limit = withDefault(integer({ min: 1, max: MAX_PAGE }), 40)(
      url.searchParams.get("limit") ?? undefined,
      "limit",
    );

    // Filtered and paged in the database. This used to read the most recent
    // two hundred trades globally and filter afterwards, so a wallet whose
    // last trade was two hundred trades ago saw nothing at all.
    const page = await tradePage({ wallet: wallet?.toBase58(), marketId, before, limit });

    return ok(
      page,
      wallet
        // One wallet's own history: never shared between callers.
        ? { "Cache-Control": "private, no-store" }
        : { "Cache-Control": "public, max-age=2, stale-while-revalidate=10" },
    );
  },
);

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
