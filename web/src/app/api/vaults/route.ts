import { vaultSnapshot } from "@/lib/server/vaults";
import { CEILINGS, route } from "@/lib/server/request";
import { ok } from "@/lib/server/respond";

export const runtime = "nodejs";
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
export const GET = route("vaults", { ceiling: CEILINGS.read, sameOrigin: false }, async () =>
  ok(await vaultSnapshot(), {
    // A vault's capital changes with every trade, but not every second.
    "Cache-Control": "public, max-age=5, stale-while-revalidate=25",
  }),
);
