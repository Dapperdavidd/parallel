/**
 * The market registry: which Percolator market account is which currency.
 *
 * Committed to the repo rather than kept only in the database, because the
 * keeper, the market-creation script and the web app all need it and only one
 * of them has database credentials. It holds no secrets — every value in it is
 * a public devnet address.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AuthMarkWire } from "./percolator.js";

export const REGISTRY_PATH = "market-registry.json";

export interface RegistryEntry {
  id: string;
  currency: string;
  unit: number;
  unitLabel: string;
  status: string;
  maxLeverage: number;
  /** The Percolator market account. */
  market: string;
  /** Collateral vault ATA. */
  vault: string;
  assetIndex: number;
  authMarkWire: AuthMarkWire;
  initialPriceE6: string;
  createdAt: string;
  /** Parallel's isolated counterparty portfolio for this market. */
  liquidityVault?: {
    authority: string;
    portfolio: string;
    capitalAtoms: string;
    maxNotionalUsdc: number;
    maxOpenInterestUsdc: number;
    createdAt: string;
  };
}

export interface Registry {
  network: "devnet";
  percolatorProgram: string;
  collateralMint: string;
  oracleAuthority: string;
  markets: RegistryEntry[];
}

export function loadRegistry(path = REGISTRY_PATH): Registry | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Registry;
}

export function saveRegistry(r: Registry, path = REGISTRY_PATH): void {
  writeFileSync(path, `${JSON.stringify(r, null, 2)}\n`);
}

export function registryEntry(r: Registry, id: string): RegistryEntry {
  const e = r.markets.find((m) => m.id === id);
  if (!e) throw new Error(`market ${id} is not in the registry`);
  return e;
}
