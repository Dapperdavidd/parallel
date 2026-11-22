import "server-only";

import { PublicKey } from "@solana/web3.js";
import { listMarkets } from "@/lib/server/data";
import { POS_SCALE, marketRiskState, portfolioState } from "@/lib/server/percolator";
import { devnetConnection } from "@/lib/server/verify-trade";
import { sideOf } from "@/lib/side";

/**
 * F10 — the state of the liquidity that takes the other side of every trade.
 *
 * Parallel is the counterparty, through one isolated portfolio per market
 * (§7.x, "Register isolated market liquidity portfolios"). That is a claim
 * about where the money is, so it should be checkable: this reads each vault
 * portfolio and its market at one slot and reports the capital, the inventory
 * the vault is actually carrying, and how close the market is to the caps the
 * trade route enforces.
 *
 * Caps come from the committed registry because they are **server-side policy**
 * rather than chain state — the engine does not know about them. The capital,
 * the inventory and the open interest are all read from the chain.
 */

export interface VaultState {
  marketId: string;
  code: string;
  unit: number;
  unitLabel: string;
  maxLeverage: number;
  market: string;
  authority: string;
  portfolio: string;
  /** Null when the account could not be read at this slot. */
  capitalUsdc: number | null;
  pnlUsdc: number | null;
  equityUsdc: number | null;
  /** The vault's own position: positive is long, negative short. */
  inventoryUsdc: number | null;
  inventorySide: "long" | "short" | "flat" | null;
  openInterestLongUsdc: number | null;
  openInterestShortUsdc: number | null;
  /** Local currency per USD, the familiar quote. */
  quote: number | null;
  maxNotionalUsdc: number;
  maxOpenInterestUsdc: number;
  /** Largest side of open interest as a fraction of the cap, 0–1+. */
  utilisation: number | null;
  error: string | null;
}

export interface VaultSnapshot {
  slot: number;
  vaults: VaultState[];
  totals: { capitalUsdc: number; equityUsdc: number; openInterestUsdc: number };
}

const atoms = (value: bigint): number => Number(value) / 1_000_000;

/** Q-scaled position size × e6 price → USDC. */
const notional = (sizeQ: bigint, priceE6: bigint): number =>
  Number((sizeQ < 0n ? -sizeQ : sizeQ) * priceE6 / POS_SCALE) / 1_000_000;

export async function vaultSnapshot(): Promise<VaultSnapshot> {
  const markets = (await listMarkets()).filter((market) => market.liquidityVault);
  const connection = devnetConnection();

  // One batched read for every vault portfolio and every market account, so the
  // whole page describes a single slot rather than a smear of them.
  const keys = markets.flatMap((market) => [
    new PublicKey(market.liquidityVault!.portfolio),
    new PublicKey(market.market),
  ]);
  const [slot, infos] = await Promise.all([
    connection.getSlot("confirmed"),
    keys.length > 0
      ? connection.getMultipleAccountsInfo(keys, "confirmed")
      : Promise.resolve([]),
  ]);

  const totals = { capitalUsdc: 0, equityUsdc: 0, openInterestUsdc: 0 };

  const vaults = markets.map((market, index): VaultState => {
    const vault = market.liquidityVault!;
    const base: VaultState = {
      marketId: market.id,
      code: market.currency,
      unit: market.unit,
      unitLabel: market.unitLabel,
      maxLeverage: market.maxLeverage,
      market: market.market,
      authority: vault.authority,
      portfolio: vault.portfolio,
      capitalUsdc: null,
      pnlUsdc: null,
      equityUsdc: null,
      inventoryUsdc: null,
      inventorySide: null,
      openInterestLongUsdc: null,
      openInterestShortUsdc: null,
      quote: null,
      maxNotionalUsdc: vault.maxNotionalUsdc,
      maxOpenInterestUsdc: vault.maxOpenInterestUsdc,
      utilisation: null,
      error: null,
    };

    const portfolioInfo = infos[index * 2];
    const marketInfo = infos[index * 2 + 1];
    if (!portfolioInfo || !marketInfo) {
      return { ...base, error: "The account could not be read at this slot" };
    }

    try {
      const state = portfolioState(portfolioInfo.data);
      const risk = marketRiskState(marketInfo.data);
      const leg = state.legs.find(
        (entry) => entry.assetIndex === market.assetIndex && entry.basisPosQ !== 0n,
      );

      const capitalUsdc = atoms(state.capitalAtoms);
      const pnlUsdc = atoms(state.pnlAtoms);
      const openInterestLongUsdc = notional(risk.openInterestLongQ, risk.effectivePriceE6);
      const openInterestShortUsdc = notional(risk.openInterestShortQ, risk.effectivePriceE6);
      const unitPrice = Number(risk.effectivePriceE6) / 1_000_000;

      totals.capitalUsdc += capitalUsdc;
      totals.equityUsdc += capitalUsdc + pnlUsdc;
      totals.openInterestUsdc += Math.max(openInterestLongUsdc, openInterestShortUsdc);

      const inventory = leg ? notional(leg.basisPosQ, risk.effectivePriceE6) : 0;
      return {
        ...base,
        capitalUsdc,
        pnlUsdc,
        equityUsdc: capitalUsdc + pnlUsdc,
        inventoryUsdc: leg && leg.basisPosQ < 0n ? -inventory : inventory,
        // In the user-facing convention, like everywhere above the engine
        // boundary. The vault's side is by construction the opposite of the
        // trader's, since it is the counterparty.
        inventorySide: !leg ? "flat" : sideOf(leg.basisPosQ),
        openInterestLongUsdc,
        openInterestShortUsdc,
        quote: unitPrice > 0 ? market.unit / unitPrice : null,
        utilisation:
          vault.maxOpenInterestUsdc > 0
            ? Math.max(openInterestLongUsdc, openInterestShortUsdc) / vault.maxOpenInterestUsdc
            : null,
      };
    } catch (error) {
      return { ...base, error: error instanceof Error ? error.message : "Unreadable account" };
    }
  });

  return { slot, vaults, totals };
}
