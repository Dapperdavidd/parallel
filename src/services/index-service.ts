/**
 * F1 — the price index service.
 *
 * "Every 2 minutes, each market's median is calculated from its sources using
 * the rules in the oracle section and stored with a per-source breakdown."
 *
 * One tick for every launch market, computed by `computeIndex` (which owns the
 * rules) and written through the Store (which owns persistence). This module
 * only orchestrates: fetch official rates once, fan out across markets, save.
 *
 *   npm run index          # one pass
 *   npm run index -- --loop
 *   npm run index -- --loop --every=120 USD/NGN
 */

import { LAUNCH_MARKETS, getMarket, type MarketDef } from "../lib/markets.js";
import { fetchOfficialRates, readSource, sourcesFor, type SourceReading } from "../lib/sources.js";
import { computeIndex, type IndexTick } from "../lib/index-math.js";
import { openStore, type Store, type StoredTick, TIMEFRAMES } from "../lib/store/index.js";

/** The PRD's polling interval. */
export const TICK_INTERVAL_MS = 2 * 60 * 1000;

export interface TickRunResult {
  ticks: StoredTick[];
  officialDate: string | null;
  /** Markets that produced no usable price this pass. */
  paused: string[];
  elapsedMs: number;
}

async function runMarket(market: MarketDef, official: number | null): Promise<IndexTick> {
  const defs = sourcesFor(market.id);
  const readings: SourceReading[] = await Promise.all(defs.map((d) => readSource(d)));
  return computeIndex(market, readings, official);
}

/**
 * One pass over the given markets. Never throws for a single bad source — a
 * market that cannot be priced comes back `paused`, which is the designed
 * behaviour, not an error.
 */
export async function runOnce(
  store: Store,
  markets: readonly MarketDef[] = LAUNCH_MARKETS,
): Promise<TickRunResult> {
  const started = Date.now();

  // PRD rule 1: official rates are a daily sanity check, so one fetch covers
  // every market. Losing them costs us the ±15% band, not the index.
  let official: Record<string, number> = {};
  let officialDate: string | null = null;
  try {
    const o = await fetchOfficialRates();
    official = o.rates;
    officialDate = o.date;
  } catch {
    officialDate = null;
  }

  const ticks = await Promise.all(
    markets.map((m) => runMarket(m, official[m.currency.toLowerCase()] ?? null)),
  );

  const stored: StoredTick[] = ticks.map((t) => ({ ...t, pushedTx: null, pushedSlot: null }));
  await store.saveTicks(stored);

  return {
    ticks: stored,
    officialDate,
    paused: stored.filter((t) => t.status !== "ok").map((t) => t.market),
    elapsedMs: Date.now() - started,
  };
}

/** Re-roll candles for every timeframe from the ticks just written. */
export async function rollAllCandles(
  store: Store,
  markets: readonly MarketDef[] = LAUNCH_MARKETS,
): Promise<void> {
  for (const m of markets) {
    for (const tf of TIMEFRAMES) {
      await store.rollCandles(m.id, tf);
    }
  }
}

/* ------------------------------------------------------------------ CLI -- */

const GREEN = "\x1b[32m", YELLOW = "\x1b[33m", RED = "\x1b[31m", DIM = "\x1b[2m", OFF = "\x1b[0m";

function line(t: StoredTick, unitLabel: string): string {
  const tag =
    t.status === "ok"
      ? `${GREEN}OK    ${OFF}`
      : t.status === "paused_few_sources"
        ? `${RED}PAUSED${OFF}`
        : `${YELLOW}PAUSED${OFF}`;
  const median =
    t.median === null
      ? "—"
      : t.median.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const premium = t.premiumPct === null ? "—" : `${t.premiumPct >= 0 ? "+" : ""}${t.premiumPct.toFixed(1)}%`;
  const unit = t.unitPriceUsd === null ? "—" : `$${t.unitPriceUsd.toFixed(4)}`;
  return (
    `${t.market.padEnd(9)} ${tag}  ${median.padStart(14)}  ${premium.padStart(8)}  ` +
    `${unitLabel.padEnd(8)} ${unit.padStart(10)}   ${t.sourcesUsed.join(",") || "—"}`
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const loop = argv.includes("--loop");
  const everyArg = argv.find((a) => a.startsWith("--every="));
  const everyMs = everyArg ? Number(everyArg.slice(8)) * 1000 : TICK_INTERVAL_MS;
  const ids = argv.filter((a) => !a.startsWith("--"));
  const markets = ids.length > 0 ? ids.map(getMarket) : [...LAUNCH_MARKETS];

  const store = openStore();
  console.log(`\n${DIM}Parallel — index service · store: ${store.name}${OFF}`);
  console.log(
    `${DIM}${markets.length} market(s) · ${loop ? `every ${everyMs / 1000}s` : "single pass"}${OFF}\n`,
  );

  let stopping = false;
  const onSignal = (): void => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log(`\n${DIM}finishing the current pass, then stopping…${OFF}`);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  for (;;) {
    const res = await runOnce(store, markets);
    await rollAllCandles(store, markets);

    console.log(`${DIM}── ${new Date().toISOString()} · ${res.elapsedMs} ms ──${OFF}`);
    for (const t of res.ticks) console.log(line(t, getMarket(t.market).unitLabel));
    if (res.officialDate === null) {
      console.log(`${YELLOW}official rates unavailable — ±15% band not applied this pass${OFF}`);
    }
    console.log(
      `${DIM}${res.ticks.length - res.paused.length}/${res.ticks.length} priced` +
        `${res.paused.length ? ` · paused: ${res.paused.join(", ")}` : ""}${OFF}\n`,
    );

    if (!loop || stopping) break;
    await new Promise((r) => setTimeout(r, everyMs));
    if (stopping) break;
  }

  await store.close();
}

// Only run when invoked directly, so the web app can import runOnce().
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (invokedDirectly) {
  main().catch((err) => {
    console.error("index service failed:", err);
    process.exit(1);
  });
}
