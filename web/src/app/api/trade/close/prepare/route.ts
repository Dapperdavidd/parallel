import { ComputeBudgetProgram, Connection, PublicKey, Transaction } from "@solana/web3.js";
import { latestTick, listMarkets, recentTrades } from "@/lib/server/data";
import { rpcUrl } from "@/lib/server/env";
import {
  assertEnginePriceSane,
  marketRiskState,
  notionalAtoms,
  PERCOLATOR_PROGRAM_ID,
  portfolioState,
  tradeNoCpi,
} from "@/lib/server/percolator";
import { issueQuote, QUOTE_TTL_MS } from "@/lib/server/quotes";
import { CEILINGS, readJson, route } from "@/lib/server/request";
import { ok, reject } from "@/lib/server/respond";
import { authoritySign } from "@/lib/server/signing";
import { accountAddress, address, shape, text } from "@/lib/server/validate";

/**
 * Prepare the close of whatever is actually open.
 *
 * Nothing about the size comes from the caller: the portfolio is read from the
 * chain, its ownership and market are checked, and the close is the exact
 * negation of the leg found there. The caller only chooses *which* portfolio to
 * read, and a portfolio it does not own is refused.
 *
 * There is no slippage gate on a close, deliberately. Refusing to let somebody
 * out of a position because the price moved is how a trader ends up
 * liquidated by their own risk control.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = shape({
  wallet: address(),
  portfolio: accountAddress(),
  marketId: text({ max: 16, pattern: /^USD\/[A-Z]{3}$/ }),
});

export const POST = route(
  "trade/close/prepare",
  { ceiling: CEILINGS.prepare },
  async ({ request }) => {
    const input = await readJson(request, body);

    const market = (await listMarkets()).find((entry) => entry.id === input.marketId);
    if (!market) reject("not_found", "We do not have a market with that name");
    if (!market!.liquidityVault) reject("unavailable", "This market's liquidity is not ready yet");
    const vault = market!.liquidityVault!;

    const conn = new Connection(rpcUrl(), "confirmed");
    const marketKey = new PublicKey(market!.market);
    const [marketAccount, portfolioAccount, tick] = await Promise.all([
      conn.getAccountInfo(marketKey, "confirmed"),
      conn.getAccountInfo(input.portfolio, "confirmed"),
      latestTick(market!.id),
    ]);
    if (!marketAccount || !portfolioAccount) {
      reject("unavailable", "The devnet market or portfolio is not readable right now");
    }
    if (!portfolioAccount!.owner.equals(PERCOLATOR_PROGRAM_ID)) {
      reject("conflict", "That account is not a Percolator portfolio");
    }

    const portfolio = portfolioState(portfolioAccount!.data);
    if (!portfolio.owner.equals(input.wallet)) {
      reject("forbidden", "This wallet does not own that portfolio");
    }
    if (!portfolio.marketGroupId.equals(marketKey)) {
      reject("conflict", "That portfolio belongs to another market");
    }
    const openLegs = portfolio.legs.filter(
      (leg) => leg.assetIndex === market!.assetIndex && leg.basisPosQ !== 0n,
    );
    if (openLegs.length === 0) reject("conflict", "There is nothing open to close here");
    if (openLegs.length !== 1) reject("conflict", "This position has a layout we cannot close yet");

    const risk = marketRiskState(marketAccount!.data);
    // A close still refuses an engine price that cannot be reconciled: exiting
    // at a misread price is as damaging as entering at one.
    if (tick?.unitPriceUsd) {
      assertEnginePriceSane(risk.effectivePriceE6, tick.unitPriceUsd, market!.id);
    }

    const leg = openLegs[0]!;
    const closeSizeQ = -leg.basisPosQ;
    const side = leg.basisPosQ > 0n ? ("long" as const) : ("short" as const);

    const transaction = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }),
      tradeNoCpi({
        user: input.wallet,
        vaultAuthority: new PublicKey(vault.authority),
        market: marketKey,
        userPortfolio: input.portfolio,
        vaultPortfolio: new PublicKey(vault.portfolio),
        sizeQ: closeSizeQ,
        effectivePriceE6: risk.effectivePriceE6,
      }),
    );
    transaction.feePayer = input.wallet;
    transaction.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    await authoritySign({ authority: market!.currency, expected: vault.authority, transaction });

    const notionalUsdc = Number(notionalAtoms(closeSizeQ, risk.effectivePriceE6)) / 1e6;
    // History is more useful if a close carries the leverage of the position it
    // settles, which the chain does not record. The wallet's last open on this
    // market is the best available answer, and 1 is the honest fallback.
    const priorOpen = (await recentTrades(market!.id, 200)).find(
      (row) => row.wallet === input.wallet.toBase58() && row.action === "open",
    );

    return ok({
      transaction: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      quoteToken: issueQuote({
        action: "close",
        marketId: market!.id,
        wallet: input.wallet.toBase58(),
        portfolio: input.portfolio.toBase58(),
        side,
        leverage: priorOpen?.leverage ?? 1,
        marginUsdc: priorOpen ? priorOpen.sizeUsdc / (priorOpen.leverage || 1) : notionalUsdc,
        notionalUsdc,
        sizeQ: closeSizeQ.toString(),
        priceE6: risk.effectivePriceE6.toString(),
      }),
      quote: {
        marketId: market!.id,
        side,
        closeSizeQ: closeSizeQ.toString(),
        notionalUsdc,
        exitPrice: Number(risk.effectivePriceE6) / 1e6,
        indexPrice: tick?.unitPriceUsd ?? null,
        effectivePriceE6: risk.effectivePriceE6.toString(),
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
        expiresInSeconds: Math.floor(QUOTE_TTL_MS / 1000),
      },
    });
  },
);
