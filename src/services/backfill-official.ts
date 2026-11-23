/**
 * Official-rate history, for the part of the chart that predates us.
 *
 * PRD F6: "For history before launch, the chart backfills daily official rates
 * from the free currency API, labelled as official history."
 *
 * The index itself only knows what it has measured since it started running,
 * and inventing street history would undermine the one claim the product makes
 * — that the number is checkable. So the pre-launch span is drawn from the
 * published official rate instead, as its own clearly-labelled series. It is a
 * different quantity from the street median and the chart says so.
 *
 * Writes `data/official/<market>.json`, one entry per day.
 *
 *   npm run backfill            # 180 days
 *   npm run backfill -- --days=365
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchJson, sleep } from "../lib/http.js";
import { LAUNCH_MARKETS, unitPriceUsd } from "../lib/markets.js";

const DIM = "\x1b[2m", OFF = "\x1b[0m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m";
const DATA_DIR = process.env.PARALLEL_DATA_DIR ?? "data";

export interface OfficialPoint {
  /** YYYY-MM-DD */
  date: string;
  /** Local currency per 1 USD, as published. */
  rate: number;
  /** USD price of one contract at that rate — directly comparable to the index. */
  unitPriceUsd: number;
}

const file = (marketId: string): string =>
  join(DATA_DIR, "official", `${marketId.replace("/", "-")}.json`);

/** Committed copy the web app reads, so a deploy has the history too. */
const BUNDLE_DIR = join("web", "src", "data");
const BUNDLE_FILE = join(BUNDLE_DIR, "official-rates.json");

export function readOfficialHistory(marketId: string): OfficialPoint[] {
  const path = file(marketId);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as OfficialPoint[];
  } catch {
    return [];
  }
}

const dayString = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * One day of official rates, keyed by lowercase currency code.
 *
 * The API is a pinned-by-date CDN path. A missing day (weekends and holidays
 * are not always published) answers 404; the caller skips it rather than
 * interpolating a rate nobody published.
 */
async function ratesForDay(date: string): Promise<Record<string, number> | null> {
  const url =
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.json`;
  try {
    const body = await fetchJson<{ usd?: Record<string, number> }>(url, {
      timeoutMs: 8_000,
      retries: 1,
    });
    return body.usd ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const daysArg = argv.find((a) => a.startsWith("--days="));
  const days = daysArg ? Number(daysArg.slice(7)) : 180;

  console.log(`\n${DIM}Parallel — backfill official rates · ${days} days${OFF}\n`);

  // Keep what we already have: this is append-only history, and re-running
  // should cost only the days that are new.
  const existing = new Map<string, Map<string, OfficialPoint>>();
  for (const m of LAUNCH_MARKETS) {
    existing.set(m.id, new Map(readOfficialHistory(m.id).map((p) => [p.date, p])));
  }

  const today = new Date();
  let fetched = 0;
  let skipped = 0;
  let cached = 0;

  for (let i = days; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const date = dayString(d);

    // Every market needs this day, or none does: one request covers all.
    const needed = LAUNCH_MARKETS.some((m) => !existing.get(m.id)!.has(date));
    if (!needed) {
      cached += 1;
      continue;
    }

    const rates = await ratesForDay(date);
    if (!rates) {
      skipped += 1;
      continue;
    }
    fetched += 1;

    for (const m of LAUNCH_MARKETS) {
      const rate = rates[m.currency.toLowerCase()];
      if (typeof rate !== "number" || rate <= 0) continue;
      existing.get(m.id)!.set(date, {
        date,
        rate,
        unitPriceUsd: unitPriceUsd(m, rate),
      });
    }

    // The CDN is free and shared; do not hammer it.
    if (fetched % 10 === 0) {
      process.stdout.write(`${DIM}.${OFF}`);
      await sleep(120);
    }
  }

  mkdirSync(join(DATA_DIR, "official"), { recursive: true });
  console.log(`\n`);
  for (const m of LAUNCH_MARKETS) {
    const points = [...existing.get(m.id)!.values()].sort((a, b) => a.date.localeCompare(b.date));
    writeFileSync(file(m.id), JSON.stringify(points, null, 0));
    const first = points[0]?.date ?? "—";
    const last = points[points.length - 1]?.date ?? "—";
    console.log(
      `${m.id.padEnd(9)} ${String(points.length).padStart(4)} days  ${DIM}${first} → ${last}${OFF}`,
    );
  }

  // A committed bundle for the web app.
  //
  // `data/` is gitignored, so on a deployed instance those per-market files do
  // not exist and the charts would lose their entire pre-launch history. This
  // is published reference data — static, public, not secret and not live
  // state — so it belongs in the repo. Compact form: `[date, rate]` pairs with
  // the rate rounded to 6 significant figures, which is far finer than any
  // published rate and keeps the file a third of the raw size.
  const bundle: Record<string, [string, number][]> = {};
  for (const m of LAUNCH_MARKETS) {
    bundle[m.id] = [...existing.get(m.id)!.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((pt) => [pt.date, Number(pt.rate.toPrecision(6))]);
  }
  mkdirSync(BUNDLE_DIR, { recursive: true });
  writeFileSync(BUNDLE_FILE, JSON.stringify(bundle));
  console.log(`${DIM}bundle → ${BUNDLE_FILE}${OFF}`);

  console.log(
    `\n${GREEN}done${OFF} ${DIM}${fetched} days fetched, ${cached} already held, ` +
      `${skipped} not published${OFF}\n`,
  );
  if (fetched === 0 && cached === 0) {
    console.log(`${YELLOW}nothing was retrieved — check connectivity to jsdelivr${OFF}\n`);
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (invokedDirectly) {
  main().catch((err) => {
    console.error("backfill failed:", err);
    process.exit(1);
  });
}
