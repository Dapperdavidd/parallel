import { ComputeBudgetProgram, Connection, PublicKey, Transaction } from "@solana/web3.js";
import { latestTick, listMarkets } from "@/lib/server/data";
import { rpcUrl } from "@/lib/server/env";
import {
  approximateLiquidationPrice,
  assertEnginePriceSane,
  marketRiskState,
  notionalAtoms,
  sizeQForNotional,
  tradeNoCpi,
} from "@/lib/server/percolator";
import { issueQuote, QUOTE_TTL_MS } from "@/lib/server/quotes";
import { CEILINGS, readJson, route } from "@/lib/server/request";
import { ok, reject } from "@/lib/server/respond";
import { authoritySign } from "@/lib/server/signing";
import {
  accountAddress,
  address,
  integer,
  number,
  oneOf,
  optional,
  shape,
  text,
  withDefault,
} from "@/lib/server/validate";
import { engineSign } from "@/lib/side";

/**
 * Prepare one trade, priced and signed by the house.
 *
 * Parallel is the counterparty, so opening a position needs a signature from
 * the market's liquidity authority. This route is where every limit that
 * protects that authority is applied — margin bounds, the market's leverage
 * cap, per-trade notional, open-interest headroom — and now two more that
 * protect the trader instead:
 *
 *  - **Slippage.** The terminal shows a price, then asks for a transaction.
 *    Between those two moments the engine's effective price can move. The
 *    client sends the price it displayed and how far it will tolerate; a
 *    bigger move is refused rather than filled quietly.
 *
 *  - **Price impact.** The quote states, in basis points, how far the fill
 *    sits from the index everything else on screen is quoted against. A trader
 *    who cannot see that is trading blind.
 *
 * The response's `quote` is signed (`lib/server/quotes.ts`). It is what
 * `/api/trades` reads the recorded numbers from, so history records the
 * server's arithmetic rather than the browser's.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_MARGIN_USDC = 10;
const MAX_MARGIN_USDC = 5_000;
const DEFAULT_SLIPPAGE_BPS = 100;
const MAX_SLIPPAGE_BPS = 1_000;

const body = shape({
  wallet: address(),
  portfolio: accountAddress(),
  marketId: text({ max: 16, pattern: /^USD\/[A-Z]{3}$/ }),
  side: oneOf(["long", "short"] as const),
  marginUsdc: number({ min: MIN_MARGIN_USDC, max: MAX_MARGIN_USDC }),
  leverage: integer({ min: 1, max: 100 }),
  /** What the terminal was showing, in whole micro-dollars per unit. */
  expectedPriceE6: optional(number({ min: 1, max: 1e15 })),
  maxSlippageBps: withDefault(
    integer({ min: 1, max: MAX_SLIPPAGE_BPS }),
    DEFAULT_SLIPPAGE_BPS,
  ),
});

export const POST = route("trade/prepare", { ceiling: CEILINGS.prepare }, async ({ request }) => {
  const input = await readJson(request, body);

  const market = (await listMarkets()).find((entry) => entry.id === input.marketId);
  if (!market) reject("not_found", "We do not have a market with that name");
  if (!market!.liquidityVault) {
    reject("unavailable", "This market's liquidity is not ready yet");
  }
  const vault = market!.liquidityVault!;
  if (input.leverage > market!.maxLeverage) {
    reject("bad_request", `This market allows at most ${market!.maxLeverage}x leverage`);
  }

  const tick = await latestTick(market!.id);
  if (!tick || tick.median === null || tick.unitPriceUsd === null || tick.status === "paused") {
    reject("conflict", "This market is paused: its index does not have enough healthy sources");
  }

  const requestedNotional = input.marginUsdc * input.leverage;
  if (requestedNotional > vault.maxNotionalUsdc) {
    reject(
      "conflict",
      `The largest position this market takes is ${vault.maxNotionalUsdc.toLocaleString()} tUSDC`,
    );
  }

  const conn = new Connection(rpcUrl(), "confirmed");
  const marketKey = new PublicKey(market!.market);
  const marketAccount = await conn.getAccountInfo(marketKey, "confirmed");
  if (!marketAccount) reject("unavailable", "The devnet market account is not readable right now");

  const risk = marketRiskState(marketAccount!.data);
  // Fails closed if the engine's price cannot be reconciled with our index —
  // the only check available against a layout change under our feet.
  const impactBps = assertEnginePriceSane(
    risk.effectivePriceE6,
    tick!.unitPriceUsd!,
    market!.id,
  );

  // Slippage is measured against what the trader was actually shown, when the
  // client tells us. Without it, the index is the only reference we have.
  const referenceE6 = input.expectedPriceE6 ?? tick!.unitPriceUsd! * 1e6;
  const moveBps = Math.round((Number(risk.effectivePriceE6) / referenceE6 - 1) * 10_000);
  if (Math.abs(moveBps) > input.maxSlippageBps) {
    reject(
      "conflict",
      `The price moved ${(Math.abs(moveBps) / 100).toFixed(2)}% while you were deciding. ` +
        "Check the new price and try again.",
    );
  }

  const notionalInAtoms = BigInt(Math.round(requestedNotional * 1e6));
  const absoluteSizeQ = sizeQForNotional(notionalInAtoms, risk.effectivePriceE6);
  // A user-facing long is an engine short — see `lib/side.ts`. Getting this
  // backwards would open the position that loses when the local currency
  // falls, which is the opposite of what every screen promises.
  const sizeQ = absoluteSizeQ * engineSign(input.side);
  const resultingSideOi =
    notionalAtoms(
      sizeQ < 0n
        ? risk.openInterestShortQ + absoluteSizeQ
        : risk.openInterestLongQ + absoluteSizeQ,
      risk.effectivePriceE6,
    ) / 1_000_000n;
  if (resultingSideOi > BigInt(vault.maxOpenInterestUsdc)) {
    reject(
      "conflict",
      "This side of the market is full. Liquidity caps the open interest we take.",
    );
  }

  const transaction = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }),
    tradeNoCpi({
      user: input.wallet,
      vaultAuthority: new PublicKey(vault.authority),
      market: marketKey,
      userPortfolio: input.portfolio,
      vaultPortfolio: new PublicKey(vault.portfolio),
      sizeQ,
      effectivePriceE6: risk.effectivePriceE6,
    }),
  );
  transaction.feePayer = input.wallet;
  transaction.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  await authoritySign({
    authority: market!.currency,
    expected: vault.authority,
    transaction,
  });

  const entryPrice = Number(risk.effectivePriceE6) / 1e6;
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();

  return ok({
    transaction: transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    /** Signed; `/api/trades` reads the recorded numbers out of this. */
    quoteToken: issueQuote({
      action: "open",
      marketId: market!.id,
      wallet: input.wallet.toBase58(),
      portfolio: input.portfolio.toBase58(),
      side: input.side,
      leverage: input.leverage,
      marginUsdc: input.marginUsdc,
      notionalUsdc: requestedNotional,
      sizeQ: sizeQ.toString(),
      priceE6: risk.effectivePriceE6.toString(),
    }),
    quote: {
      marketId: market!.id,
      side: input.side,
      marginUsdc: input.marginUsdc,
      leverage: input.leverage,
      notionalUsdc: requestedNotional,
      /** What this trade fills at. */
      entryPrice,
      effectivePriceE6: risk.effectivePriceE6.toString(),
      /** The index price the rest of the screen is quoted against. */
      indexPrice: tick!.unitPriceUsd,
      /** Fill versus index, in basis points: positive means worse for a buyer. */
      priceImpactBps: impactBps,
      /** How far the price moved between the screen and this quote. */
      priceMoveBps: moveBps,
      maxSlippageBps: input.maxSlippageBps,
      /** Approximate, before fees and funding — see `approximateLiquidationPrice`. */
      approximateLiquidationPrice: approximateLiquidationPrice(
        entryPrice,
        input.leverage,
        input.side,
      ),
      sizeQ: sizeQ.toString(),
      expiresAt,
      expiresInSeconds: Math.floor(QUOTE_TTL_MS / 1000),
    },
  });
});
