import { Connection, PublicKey } from "@solana/web3.js";
import { latestTick, listMarkets } from "@/lib/server/data";
import { rpcUrl } from "@/lib/server/env";
import {
  approximateLiquidationPrice,
  assertEnginePriceSane,
  marketRiskState,
  notionalAtoms,
  sizeQForNotional,
} from "@/lib/server/percolator";
import { CEILINGS, readJson, route } from "@/lib/server/request";
import { ok, reject } from "@/lib/server/respond";
import { integer, number, oneOf, shape, text } from "@/lib/server/validate";
import { engineSign } from "@/lib/side";

/**
 * What a trade would cost, without preparing one.
 *
 * The order ticket used to price its own review screen: the index price from
 * the market board, a liquidation estimate computed in the browser, and no
 * mention of the gap between the index and the price the engine would
 * actually fill at. On a market whose mark has drifted — BRL is currently
 * 5% out — the review said one thing and the fill did another.
 *
 * This answers with the same arithmetic the prepare route uses, from the same
 * on-chain read, and signs nothing. A preview must not spend a liquidity
 * authority's signature or a blockhash, which is why it is a separate route
 * rather than a flag on that one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = shape({
  marketId: text({ max: 16, pattern: /^USD\/[A-Z]{3}$/ }),
  side: oneOf(["long", "short"] as const),
  marginUsdc: number({ min: 1, max: 100_000 }),
  leverage: integer({ min: 1, max: 100 }),
});

export const POST = route("trade/quote", { ceiling: CEILINGS.read }, async ({ request }) => {
  const input = await readJson(request, body);

  const market = (await listMarkets()).find((entry) => entry.id === input.marketId);
  if (!market) reject("not_found", "We do not have a market with that name");
  const vault = market!.liquidityVault;

  const tick = await latestTick(market!.id);
  if (!tick?.unitPriceUsd) {
    reject("conflict", "This market has no price right now, so there is nothing to quote");
  }

  const conn = new Connection(rpcUrl(), "confirmed");
  const account = await conn.getAccountInfo(new PublicKey(market!.market), "confirmed");
  if (!account) reject("unavailable", "The devnet market account is not readable right now");

  const risk = marketRiskState(account!.data);
  const impactBps = assertEnginePriceSane(risk.effectivePriceE6, tick!.unitPriceUsd!, market!.id);

  const notional = input.marginUsdc * input.leverage;
  const absoluteSizeQ = sizeQForNotional(BigInt(Math.round(notional * 1e6)), risk.effectivePriceE6);
  const sizeQ = absoluteSizeQ * engineSign(input.side);
  const entryPrice = Number(risk.effectivePriceE6) / 1e6;

  // Open-interest headroom, so the ticket can say "this side is nearly full"
  // before somebody commits to a size that will be refused.
  const sideOiUsdc =
    Number(
      notionalAtoms(
        sizeQ < 0n ? risk.openInterestShortQ : risk.openInterestLongQ,
        risk.effectivePriceE6,
      ),
    ) / 1e6;

  return ok(
    {
      marketId: market!.id,
      side: input.side,
      marginUsdc: input.marginUsdc,
      leverage: input.leverage,
      notionalUsdc: notional,
      /** Where this would fill, in the engine's own units and the quote scale. */
      entryPrice,
      entryQuote: market!.unit / entryPrice,
      effectivePriceE6: risk.effectivePriceE6.toString(),
      indexPrice: tick!.unitPriceUsd,
      indexQuote: tick!.median,
      /** Fill against index, in basis points. */
      priceImpactBps: impactBps,
      approximateLiquidationPrice: approximateLiquidationPrice(
        entryPrice,
        input.leverage,
        input.side,
      ),
      approximateLiquidationQuote:
        market!.unit /
        Math.max(
          1e-12,
          approximateLiquidationPrice(entryPrice, input.leverage, input.side),
        ),
      maxLeverage: market!.maxLeverage,
      maxNotionalUsdc: vault?.maxNotionalUsdc ?? null,
      maxOpenInterestUsdc: vault?.maxOpenInterestUsdc ?? null,
      sideOpenInterestUsdc: sideOiUsdc,
      /** False when a position cannot be opened at all right now, and why. */
      tradable: tick!.status === "ok" && Boolean(vault),
      blockedBecause:
        tick!.status !== "ok"
          ? "This market is paused: its index does not have enough healthy sources."
          : !vault
            ? "This market's liquidity is not ready yet."
            : notional > (vault.maxNotionalUsdc ?? 0)
              ? `The largest position this market takes is ${vault.maxNotionalUsdc.toLocaleString()} tUSDC.`
              : null,
      at: new Date().toISOString(),
    },
    // Short-lived on purpose: this is a price, and the ticket re-asks.
    { "Cache-Control": "private, no-store" },
  );
});
