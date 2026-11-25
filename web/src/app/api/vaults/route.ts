import { NextResponse } from "next/server";
import { vaultSnapshot } from "@/lib/server/vaults";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The trade terminal's liquidity panel.
 *
 * There is deliberately no synthetic order book on Parallel: trades match an
 * isolated Percolator vault. This exposes the same chain snapshot as /vaults
 * so the terminal can show the capital and caps that actually stand behind a
 * market.
 */
export async function GET(): Promise<NextResponse> {
  const snapshot = await vaultSnapshot();
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "no-store" },
  });
}
