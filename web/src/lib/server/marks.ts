import "server-only";

import { Connection, PublicKey } from "@solana/web3.js";
import { listMarkets } from "./data";
import { rpcUrl } from "./env";
import { marketRiskState } from "./percolator";
import { warn } from "./log";

/**
 * The engine's own price for every market, in one read.
 *
 * The terminal has always shown a "Mark" stat labelled *the engine's
 * effective price, positions are marked against this* — and filled it with
 * the index median, which is a different number. They are close, because the
 * keeper pushes on a 0.1% move or every ten minutes, but close is not the
 * same, and the gap between them is exactly what a perps trader needs to see:
 * it is the basis, and it is where a fill lands relative to the street.
 *
 * Reading it costs one batched account fetch for all thirteen markets, so it
 * is memoised for a few seconds. A burst of requests shares one RPC call, and
 * the route's own cache header absorbs the rest.
 *
 * A failure here is not a failure of the market board: the mark is omitted
 * and the board renders without it.
 */

export interface EngineMark {
  /** USD per contract, as the engine holds it. */
  unitPriceUsd: number;
  effectivePriceE6: string;
  openInterestLongUsdc: number;
  openInterestShortUsdc: number;
}

const FRESH_MS = 5_000;

let cache: { at: number; marks: Map<string, EngineMark> } | null = null;
let inFlight: Promise<Map<string, EngineMark>> | null = null;

async function read(): Promise<Map<string, EngineMark>> {
  const markets = await listMarkets();
  const out = new Map<string, EngineMark>();
  if (markets.length === 0) return out;

  const conn = new Connection(rpcUrl(), "confirmed");
  const infos = await conn.getMultipleAccountsInfo(
    markets.map((market) => new PublicKey(market.market)),
    "confirmed",
  );

  markets.forEach((market, index) => {
    const info = infos[index];
    if (!info) return;
    try {
      const risk = marketRiskState(info.data);
      const priceE6 = Number(risk.effectivePriceE6);
      if (!(priceE6 > 0)) return;
      const scale = priceE6 / 1e6;
      out.set(market.id, {
        unitPriceUsd: scale,
        effectivePriceE6: risk.effectivePriceE6.toString(),
        // Open interest in contracts times the price, in whole tUSDC.
        openInterestLongUsdc: Number(risk.openInterestLongQ / 1_000_000n) * scale,
        openInterestShortUsdc: Number(risk.openInterestShortQ / 1_000_000n) * scale,
      });
    } catch (error) {
      // A single unparseable account must not take the whole board down.
      warn({ event: "mark_unreadable", marketId: market.id, error });
    }
  });
  return out;
}

export async function engineMarks(): Promise<Map<string, EngineMark>> {
  const now = Date.now();
  if (cache && now - cache.at < FRESH_MS) return cache.marks;
  if (inFlight) return inFlight;

  inFlight = read()
    .then((marks) => {
      cache = { at: Date.now(), marks };
      return marks;
    })
    .catch((error: unknown) => {
      warn({ event: "marks_unavailable", error });
      // Last known marks are better than none; an empty map if there are none.
      return cache?.marks ?? new Map<string, EngineMark>();
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
