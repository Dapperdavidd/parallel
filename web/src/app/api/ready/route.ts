import { Connection } from "@solana/web3.js";
import { latestTicks, listMarkets } from "@/lib/server/data";
import { mode, rpcUrl } from "@/lib/server/env";
import { CEILINGS, route } from "@/lib/server/request";
import { ok } from "@/lib/server/respond";

/**
 * Readiness: can this process actually serve a trader?
 *
 * Three dependencies, checked independently so the answer says *which* one is
 * down rather than just "not ready": the market registry, the index store, and
 * devnet. Each failure is reported rather than thrown, because a readiness
 * probe that 500s tells an operator less than one that explains itself.
 *
 * The HTTP status is the machine-readable part — 200 when a trade could be
 * placed, 503 when it could not — so this can sit behind an uptime check
 * without a body parser.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How long a dependency may take before readiness calls it down.
 *
 * Four seconds was too tight. The first Supabase call in a cold process spends
 * about three on connection setup, so a perfectly healthy deployment reported
 * "the index store did not answer" on its first probe — and a readiness check
 * that cries wolf is worse than none, because the response is to stop reading
 * it. Eight is comfortably past a cold start and still well inside the
 * sixty-second interval an uptime check would use.
 */
const CHECK_TIMEOUT_MS = 8_000;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function within<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, rejectWith) => {
        timer = setTimeout(
          () => rejectWith(new Error(`${label} did not answer in ${CHECK_TIMEOUT_MS}ms`)),
          CHECK_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : "failed";

export const GET = route("ready", { ceiling: CEILINGS.read, sameOrigin: false }, async () => {
  const checks: Check[] = [];

  let liveMarkets = 0;
  let totalMarkets = 0;
  try {
    const markets = await within(listMarkets(), "the market registry");
    totalMarkets = markets.length;
    checks.push({
      name: "registry",
      ok: markets.length > 0,
      detail: `${markets.length} markets configured`,
    });
  } catch (error) {
    checks.push({ name: "registry", ok: false, detail: describe(error) });
  }

  try {
    const ticks = await within(latestTicks(), "the index store");
    liveMarkets = [...ticks.values()].filter((tick) => tick.status === "ok").length;
    checks.push({
      name: "index",
      ok: liveMarkets > 0,
      detail: `${liveMarkets} of ${totalMarkets || ticks.size} markets priced`,
    });
  } catch (error) {
    checks.push({ name: "index", ok: false, detail: describe(error) });
  }

  try {
    const slot = await within(new Connection(rpcUrl(), "confirmed").getSlot("confirmed"), "devnet");
    checks.push({ name: "devnet", ok: slot > 0, detail: `slot ${slot}` });
  } catch (error) {
    checks.push({ name: "devnet", ok: false, detail: describe(error) });
  }

  const ready = checks.every((check) => check.ok);
  const body = {
    ready,
    mode: mode(),
    marketsLive: liveMarkets,
    marketsTotal: totalMarkets,
    checks,
    at: new Date().toISOString(),
  };
  return ready
    ? ok(body)
    : new Response(JSON.stringify(body), {
        status: 503,
        headers: { "content-type": "application/json", "Cache-Control": "no-store" },
      });
});
