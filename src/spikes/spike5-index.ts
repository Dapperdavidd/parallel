/**
 * SPIKE 5 — Parallel street price index.
 *
 * Proves: we can build a live street-rate index for all 13 launch markets from
 * public endpoints, apply the PRD's median / outlier / minimum-source / official
 * -band rules, and produce the USD unit price that Percolator needs.
 *
 * No chain access. No keys. Read-only HTTP.
 *
 *   npm run spike5              # all launch markets
 *   npm run spike5 -- USD/NGN   # one market
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { LAUNCH_MARKETS, getMarket, type MarketDef } from "../lib/markets.js";
import { fetchOfficialRates, readSource, sourcesFor, type SourceReading } from "../lib/sources.js";
import { computeIndex, type IndexTick } from "../lib/index-math.js";

const GREEN = "\x1b[32m", YELLOW = "\x1b[33m", RED = "\x1b[31m", DIM = "\x1b[2m", OFF = "\x1b[0m";

function statusTag(t: IndexTick): string {
  if (t.status === "ok") return `${GREEN}OK    ${OFF}`;
  if (t.status === "paused_few_sources") return `${RED}PAUSED${OFF}`;
  return `${YELLOW}PAUSED${OFF}`;
}

function fmt(n: number | null, dp: number): string {
  return n === null
    ? "—"
    : n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

async function runMarket(market: MarketDef, official: number | null): Promise<IndexTick> {
  const defs = sourcesFor(market.id);
  const readings: SourceReading[] = await Promise.all(defs.map((d) => readSource(d)));
  return computeIndex(market, readings, official);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const markets = argv.length > 0 ? argv.map(getMarket) : [...LAUNCH_MARKETS];

  console.log(`\n${DIM}Parallel — spike 5: street price index${OFF}`);
  console.log(`${DIM}${new Date().toISOString()} · ${markets.length} market(s)${OFF}\n`);

  // Official rates: one fetch for every market (PRD rule 1 — daily is enough).
  let official: Record<string, number> = {};
  let officialDate = "unavailable";
  try {
    const o = await fetchOfficialRates();
    official = o.rates;
    officialDate = o.date;
    console.log(`${DIM}official rates: fawazahmed0 currency-api, dated ${officialDate}${OFF}\n`);
  } catch (err) {
    console.log(
      `${YELLOW}official rates unavailable (${err instanceof Error ? err.message : err}) — ` +
        `continuing without the ±15% sanity band${OFF}\n`,
    );
  }

  const ticks = await Promise.all(
    markets.map((m) => runMarket(m, official[m.currency.toLowerCase()] ?? null)),
  );

  // ---- one line per market ----
  console.log(
    "market    status   median(local/USD)   official   premium   unit        unit price   sources",
  );
  console.log("─".repeat(108));

  for (const [i, t] of ticks.entries()) {
    const m = markets[i]!;
    const used = t.sourcesUsed.length > 0 ? t.sourcesUsed.join(",") : "—";
    const extras = [
      ...t.dropped.map(
        (d) =>
          `${DIM}-${d.id}(${d.deviationPct > 0 ? "+" : ""}${d.deviationPct.toFixed(1)}%)${OFF}`,
      ),
      ...t.failed.map((f) => `${RED}✗${f.id}${OFF}`),
    ];
    const premium =
      t.premiumPct === null
        ? "—"
        : `${t.premiumPct >= 0 ? "+" : ""}${t.premiumPct.toFixed(2)}%`;
    const unitPrice = t.unitPriceUsd === null ? "—" : `$${t.unitPriceUsd.toFixed(4)}`;

    console.log(
      `${m.id.padEnd(9)} ${statusTag(t)}  ` +
        `${fmt(t.median, 2).padStart(16)}  ` +
        `${fmt(t.official, 2).padStart(9)}  ` +
        `${premium.padStart(8)}  ` +
        `${m.unitLabel.padEnd(8)}  ` +
        `${unitPrice.padStart(10)}   ` +
        `${used} ${extras.join(" ")}`,
    );
    if (t.reason) console.log(`${" ".repeat(10)}${DIM}↳ ${t.reason}${OFF}`);
  }

  // ---- checks the spike has to pass ----
  const okCount = ticks.filter((t) => t.status === "ok").length;
  const priced = ticks.filter((t) => t.unitPriceUsd !== null);
  const inBand = priced.filter((t) => t.unitPriceUsd! >= 0.05 && t.unitPriceUsd! <= 10).length;

  console.log(`\n${DIM}─ checks ─${OFF}`);
  console.log(`  markets OK                 ${okCount}/${ticks.length}`);
  console.log(`  unit price in $0.05–$10    ${inBand}/${priced.length} priced markets`);
  console.log(
    `  min 2 sources satisfied    ${ticks.filter((t) => t.sourcesUsed.length >= 2).length}/${ticks.length}`,
  );

  mkdirSync("out", { recursive: true });
  const path = `out/spike5-index-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(path, JSON.stringify({ officialDate, ticks }, null, 2));
  console.log(`\n${DIM}full per-source breakdown written to ${path}${OFF}\n`);

  // Non-zero exit if any launch market could not be priced at all.
  if (priced.length < ticks.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("spike5 failed:", err);
  process.exit(1);
});
