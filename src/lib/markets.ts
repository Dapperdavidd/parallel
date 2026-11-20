/**
 * Parallel market registry.
 *
 * WHY UNITS EXIST
 * ---------------
 * Percolator quotes a USD price per unit of the traded asset. A raw naira is
 * worth ~$0.00069, which is far too small for the engine's e6 price scale to
 * carry useful precision. So each market trades a BUNDLE of local currency
 * (1,000 NGN, 10 ZAR, ...) chosen so the USD unit price lands roughly in the
 * $0.05 - $10 band. Measured on 2026-11-20 every launch market sits inside it.
 *
 *   unitPriceUsd = unitSize / streetRate
 *   e.g. NGN: 1000 / 1452.45 = $0.6885
 *
 * The UI always shows the familiar quote (NGN 1,447 per $1); units are an
 * internal detail of the on-chain market.
 */

export type MarketStatus = "live" | "beta" | "stretch";

export interface MarketDef {
  /** Canonical market id, as shown to users. */
  id: string;
  /** ISO code of the local currency. */
  currency: string;
  /** How many units of local currency make up one tradable unit. */
  unitSize: number;
  /** Short label for that bundle, e.g. "kNGN". */
  unitLabel: string;
  status: MarketStatus;
  region: string;
  /** Leverage cap: 5x for live markets, 2x for beta (PRD risk section). */
  maxLeverage: number;
}

export const MARKETS: readonly MarketDef[] = [
  { id: "USD/NGN", currency: "NGN", unitSize: 1000, unitLabel: "kNGN",  status: "live", region: "Africa",        maxLeverage: 5 },
  { id: "USD/ZAR", currency: "ZAR", unitSize: 10,   unitLabel: "10ZAR", status: "live", region: "Africa",        maxLeverage: 5 },
  { id: "USD/ARS", currency: "ARS", unitSize: 1000, unitLabel: "kARS",  status: "live", region: "Latin America", maxLeverage: 5 },
  { id: "USD/BRL", currency: "BRL", unitSize: 1,    unitLabel: "BRL",   status: "live", region: "Latin America", maxLeverage: 5 },
  { id: "USD/MXN", currency: "MXN", unitSize: 10,   unitLabel: "10MXN", status: "live", region: "Latin America", maxLeverage: 5 },
  { id: "USD/COP", currency: "COP", unitSize: 1000, unitLabel: "kCOP",  status: "live", region: "Latin America", maxLeverage: 5 },
  { id: "USD/TRY", currency: "TRY", unitSize: 10,   unitLabel: "10TRY", status: "live", region: "Europe/Asia",   maxLeverage: 5 },
  { id: "USD/INR", currency: "INR", unitSize: 100,  unitLabel: "100INR",status: "live", region: "Asia",          maxLeverage: 5 },
  { id: "USD/PHP", currency: "PHP", unitSize: 100,  unitLabel: "100PHP",status: "live", region: "Asia",          maxLeverage: 5 },
  { id: "USD/KES", currency: "KES", unitSize: 100,  unitLabel: "100KES",status: "beta", region: "Africa",        maxLeverage: 2 },
  { id: "USD/GHS", currency: "GHS", unitSize: 10,   unitLabel: "10GHS", status: "beta", region: "Africa",        maxLeverage: 2 },
  { id: "USD/EGP", currency: "EGP", unitSize: 100,  unitLabel: "100EGP",status: "beta", region: "Africa",        maxLeverage: 2 },
  { id: "USD/PKR", currency: "PKR", unitSize: 100,  unitLabel: "100PKR",status: "beta", region: "Asia",          maxLeverage: 2 },
] as const;

export const LAUNCH_MARKETS = MARKETS.filter((m) => m.status !== "stretch");

export function getMarket(id: string): MarketDef {
  const m = MARKETS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown market: ${id}`);
  return m;
}

/** Street rate (local per 1 USD) -> USD price of one tradable unit. */
export function unitPriceUsd(market: MarketDef, streetRate: number): number {
  if (!(streetRate > 0)) throw new Error(`bad street rate for ${market.id}: ${streetRate}`);
  return market.unitSize / streetRate;
}
