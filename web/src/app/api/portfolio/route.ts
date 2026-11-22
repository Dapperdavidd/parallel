import { Connection, PublicKey } from "@solana/web3.js";
import { NextRequest, NextResponse } from "next/server";
import { listMarkets, registryMeta } from "@/lib/server/data";
import {
  PERCOLATOR_PROGRAM_ID,
  PORTFOLIO_ACCOUNT_LEN,
  PORTFOLIO_OWNER_OFF,
  POS_SCALE,
  marketRiskState,
  portfolioState,
} from "@/lib/server/percolator";
import { sideOf } from "@/lib/side";

/**
 * F12 — the portfolio, read from the chain rather than from the browser.
 *
 * Everything here is a confirmed account read at one slot: the wallet's mock
 * USDC balance, every Percolator portfolio the wallet owns, the capital and
 * stored PnL in each, and the open legs with the engine's current effective
 * price. Nothing is seeded and nothing is interpolated — a figure this route
 * cannot read, it does not return, so the UI can show a dash instead of a
 * plausible number.
 *
 * Portfolios are found by program scan, filtered on the exact account size and
 * on the owner at its fixed offset, so a wallet that opened a portfolio on a
 * different machine still sees it here.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const fail = (error: string, status = 400): NextResponse =>
  NextResponse.json({ error }, { status });

const abs = (value: bigint): bigint => (value < 0n ? -value : value);

/** Devnet only, like every other signing or reading path in the app. */
function connection(): Connection {
  const rpc =
    process.env.SOLANA_RPC_URL ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    "https://api.devnet.solana.com";
  if (!/devnet/i.test(rpc)) throw new Error("The portfolio read refuses a non-devnet RPC");
  return new Connection(rpc, "confirmed");
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(request.nextUrl.searchParams.get("wallet") ?? "");
  } catch {
    return fail("A valid wallet address is required");
  }

  try {
    const [markets, meta] = await Promise.all([listMarkets(), registryMeta()]);
    if (!meta?.collateralMint) return fail("The collateral mint is unavailable", 503);

    const conn = connection();
    const mint = new PublicKey(meta.collateralMint);
    const [slot, accounts, tokenAccounts] = await Promise.all([
      conn.getSlot("confirmed"),
      conn.getProgramAccounts(PERCOLATOR_PROGRAM_ID, {
        commitment: "confirmed",
        filters: [
          { dataSize: PORTFOLIO_ACCOUNT_LEN },
          { memcmp: { offset: PORTFOLIO_OWNER_OFF, bytes: wallet.toBase58() } },
        ],
      }),
      conn.getTokenAccountsByOwner(wallet, { mint }, "confirmed"),
    ]);

    const marketByAddress = new Map(markets.map((market) => [market.market, market]));
    const parsed = accounts.map(({ pubkey, account }) => ({
      pubkey,
      state: portfolioState(account.data),
    }));

    // One batched read for the markets these portfolios belong to, so the
    // effective price beside a position is the engine's, at this slot.
    const marketKeys = [...new Set(parsed.map(({ state }) => state.marketGroupId.toBase58()))];
    const riskByMarket = new Map<string, ReturnType<typeof marketRiskState>>();
    if (marketKeys.length > 0) {
      const infos = await conn.getMultipleAccountsInfo(
        marketKeys.map((key) => new PublicKey(key)),
        "confirmed",
      );
      marketKeys.forEach((key, index) => {
        const info = infos[index];
        if (info) riskByMarket.set(key, marketRiskState(info.data));
      });
    }

    // SPL token account: amount is a u64 at offset 64.
    let walletAtoms = 0n;
    for (const { account } of tokenAccounts.value) {
      if (account.data.length >= 72) walletAtoms += account.data.readBigUInt64LE(64);
    }

    let portfolioEquityAtoms = 0n;
    let storedPnlAtoms = 0n;
    const portfolios = parsed.flatMap(({ pubkey, state }) => {
      const address = state.marketGroupId.toBase58();
      const market = marketByAddress.get(address);
      const risk = riskByMarket.get(address);
      // A portfolio on a market outside our registry is not ours to describe.
      if (!market || !risk) return [];

      const equityAtoms = state.capitalAtoms + state.pnlAtoms;
      portfolioEquityAtoms += equityAtoms;
      storedPnlAtoms += state.pnlAtoms;

      return [
        {
          address: pubkey.toBase58(),
          marketId: market.id,
          code: market.currency,
          /** Contracts are a bundle of local currency; the UI needs it to show a familiar price. */
          unit: market.unit,
          unitLabel: market.unitLabel,
          maxLeverage: market.maxLeverage,
          capitalAtoms: state.capitalAtoms.toString(),
          pnlAtoms: state.pnlAtoms.toString(),
          equityAtoms: equityAtoms.toString(),
          effectivePriceE6: risk.effectivePriceE6.toString(),
          positions: state.legs
            .filter((leg) => leg.assetIndex === market.assetIndex && leg.basisPosQ !== 0n)
            .map((leg) => ({
              side: sideOf(leg.basisPosQ),
              sizeQ: leg.basisPosQ.toString(),
              notionalAtoms: ((abs(leg.basisPosQ) * risk.effectivePriceE6) / POS_SCALE).toString(),
            })),
        },
      ];
    });

    return NextResponse.json(
      {
        wallet: wallet.toBase58(),
        slot,
        walletAtoms: walletAtoms.toString(),
        portfolioEquityAtoms: portfolioEquityAtoms.toString(),
        storedPnlAtoms: storedPnlAtoms.toString(),
        totalEquityAtoms: (walletAtoms + portfolioEquityAtoms).toString(),
        portfolios,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The portfolio read failed", 503);
  }
}
