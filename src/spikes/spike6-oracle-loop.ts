/**
 * SPIKE 6 — the oracle loop.
 *
 * Runs the price index for USD/NGN every 2 minutes for 30 minutes, and pushes
 * the median on-chain only when it moves more than 0.1% or 10 minutes have
 * passed (PRD oracle rule 6). Every tick is logged with its per-source
 * breakdown (rule 7).
 *
 * This is the rehearsal for the production keeper, so it measures the things
 * that decide whether F1 ("99% of 2-minute intervals with at least 2 sources")
 * can actually be met: interval coverage, push latency, and failures.
 *
 *   npm run spike6                       # 30 minutes, 2-minute interval
 *   npm run spike6 -- --minutes 6        # short rehearsal
 *   npm run spike6 -- --interval 30      # seconds between ticks
 *   npm run spike6 -- --dry-run          # index only, never touch the chain
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";

import {
  getConnection,
  loadOrCreateWallet,
  ensureFunded,
  send,
  nowSlot,
  getAccountData,
  toE6,
  fromE6,
} from "../lib/solana.js";
import {
  assetEngineOffset,
  encPushAuthMark,
  ixAuthMark,
  ixCrank,
  readAssetControlSequences,
  type AuthMarkWire,
} from "../lib/percolator.js";
import { parseAsset } from "../vendor/percolator-v16/index.js";
import { getMarket } from "../lib/markets.js";
import { readSource, sourcesFor, fetchOfficialRates } from "../lib/sources.js";
import { computeIndex, shouldPush, PUSH_MOVE_PCT, PUSH_MAX_AGE_MS } from "../lib/index-math.js";

const STATE_PATH = "out/parallel-devnet.json";
const TICK_LOG = "out/index-ticks.jsonl";
const MARKET_ID = "USD/NGN";
const DIM = "\x1b[2m", OFF = "\x1b[0m", GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

async function main(): Promise<void> {
  const minutes = arg("minutes", 30);
  const intervalSec = arg("interval", 120);
  const dryRun = process.argv.includes("--dry-run");

  const market = getMarket(MARKET_ID);
  const defs = sourcesFor(MARKET_ID);
  const ticks = Math.max(1, Math.round((minutes * 60) / intervalSec));

  console.log(`\n${DIM}Parallel — spike 6: oracle loop${OFF}`);
  console.log(
    `${DIM}${MARKET_ID} · every ${intervalSec}s for ${minutes} min (${ticks} ticks) · ` +
      `push when move > ${PUSH_MOVE_PCT}% or ${PUSH_MAX_AGE_MS / 60000} min elapse${dryRun ? " · DRY RUN" : ""}${OFF}\n`,
  );

  // ---- chain setup (skipped on a dry run) ----
  let conn: ReturnType<typeof getConnection> | null = null;
  let marketKey: PublicKey | null = null;
  let portfolio: PublicKey | null = null;
  let admin: ReturnType<typeof loadOrCreateWallet> | null = null;
  let wire: AuthMarkWire = "short";

  if (!dryRun) {
    if (!existsSync(STATE_PATH)) throw new Error(`${STATE_PATH} not found — run \`npm run spike1\``);
    const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as {
      market?: string; portfolioA?: string; authMarkWire?: AuthMarkWire;
    };
    if (!state.market) throw new Error("no market in state — run `npm run spike1`");
    conn = getConnection();
    marketKey = new PublicKey(state.market);
    portfolio = state.portfolioA ? new PublicKey(state.portfolioA) : null;
    wire = state.authMarkWire ?? "short";
    admin = loadOrCreateWallet("oracle-authority");
    await ensureFunded(conn, admin, 0.05, "oracle-authority");
    console.log(`${DIM}market ${marketKey.toBase58()}${OFF}\n`);
  }

  // Official rates once (PRD rule 1: daily is enough).
  let official: number | null = null;
  try {
    official = (await fetchOfficialRates()).rates[market.currency.toLowerCase()] ?? null;
  } catch {
    console.log(`${YELLOW}official rates unavailable — the ±15% band is inactive${OFF}\n`);
  }

  mkdirSync("out", { recursive: true });

  let last: { unitPriceUsd: number; at: number } | null = null;
  let pushes = 0, skips = 0, paused = 0, failures = 0;
  const pushLatencies: number[] = [];
  const started = Date.now();

  console.log("  tick  time      median      unit price   status   decision");
  console.log("  " + "─".repeat(78));

  for (let i = 0; i < ticks; i++) {
    const tickStart = Date.now();
    const readings = await Promise.all(defs.map((d) => readSource(d)));
    const tick = computeIndex(market, readings, official);

    appendFileSync(TICK_LOG, JSON.stringify(tick) + "\n");

    const when = new Date().toISOString().slice(11, 19);
    let decision: string;

    if (tick.status !== "ok" || tick.unitPriceUsd === null) {
      paused++;
      decision = `${RED}paused${OFF} ${DIM}${tick.reason ?? ""}${OFF}`;
    } else {
      const verdict = shouldPush(tick, last, Date.now());
      if (!verdict.push) {
        skips++;
        decision = `${DIM}hold — ${verdict.reason}${OFF}`;
      } else if (dryRun) {
        pushes++;
        last = { unitPriceUsd: tick.unitPriceUsd, at: Date.now() };
        decision = `${GREEN}would push${OFF} ${DIM}— ${verdict.reason}${OFF}`;
      } else {
        try {
          const t0 = Date.now();
          const data = await getAccountData(conn!, marketKey!);
          const asset = parseAsset(data, assetEngineOffset(0), 0);
          const seqs = readAssetControlSequences(data, 0);
          const markE6 = toE6(tick.unitPriceUsd);

          await send(
            conn!,
            [admin!],
            [ixAuthMark(admin!.publicKey, marketKey!, encPushAuthMark({
              assetIndex: 0,
              marketId: asset.marketId,
              nowSlot: await nowSlot(conn!),
              markE6,
              observationSequence: seqs.oracleObservation + 1n,
              authorityEpoch: seqs.authorityEpoch,
            }, wire))],
            { label: `oracle push ${fromE6(markE6).toFixed(6)}` },
          );

          // A push alone is economically inert; the crank walks the effective
          // price toward it. Best effort: no-progress is normal and not a failure.
          if (portfolio) {
            try {
              await send(
                conn!,
                [admin!],
                [ixCrank(admin!.publicKey, marketKey!, portfolio, { nowSlot: await nowSlot(conn!) })],
                { label: "crank", attempts: 1 },
              );
            } catch { /* no progress is fine */ }
          }

          const ms = Date.now() - t0;
          pushLatencies.push(ms);
          pushes++;
          last = { unitPriceUsd: tick.unitPriceUsd, at: Date.now() };
          decision = `${GREEN}pushed${OFF} ${DIM}${ms}ms — ${verdict.reason}${OFF}`;
        } catch (err) {
          failures++;
          const why = (err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "unknown";
          decision = `${RED}push failed${OFF} ${DIM}${why.slice(0, 50)}${OFF}`;
        }
      }
    }

    console.log(
      `  ${String(i + 1).padStart(4)}  ${when}  ` +
        `${(tick.median?.toFixed(2) ?? "—").padStart(9)}  ` +
        `${(tick.unitPriceUsd === null ? "—" : `$${tick.unitPriceUsd.toFixed(6)}`).padStart(11)}  ` +
        `${tick.sourcesUsed.length}/${defs.length} src  ${decision}`,
    );

    if (i < ticks - 1) {
      const elapsed = Date.now() - tickStart;
      const wait = Math.max(0, intervalSec * 1000 - elapsed);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  // ---- summary ----
  const mins = (Date.now() - started) / 60000;
  const covered = ticks - paused;
  const coverage = (covered / ticks) * 100;
  const avgLatency = pushLatencies.length
    ? Math.round(pushLatencies.reduce((a, b) => a + b, 0) / pushLatencies.length)
    : 0;

  console.log(`\n${DIM}─ spike 6 result ─${OFF}`);
  console.log(`  ran for             ${mins.toFixed(1)} min, ${ticks} ticks every ${intervalSec}s`);
  console.log(`  intervals with ≥2 sources  ${covered}/${ticks} = ${coverage.toFixed(1)}% ${DIM}(F1 target: 99%)${OFF}`);
  console.log(`  pushed              ${pushes}`);
  console.log(`  held                ${skips} ${DIM}(move ≤ ${PUSH_MOVE_PCT}% and < ${PUSH_MAX_AGE_MS / 60000} min since last)${OFF}`);
  console.log(`  paused              ${paused}`);
  console.log(`  push failures       ${failures}`);
  if (pushLatencies.length) {
    console.log(`  push latency        avg ${avgLatency}ms, max ${Math.max(...pushLatencies)}ms`);
  }
  console.log(`  tick log            ${TICK_LOG} ${DIM}(every calculation with its per-source breakdown)${OFF}\n`);

  if (coverage < 99 || failures > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("\nspike6 failed:", err);
    process.exit(1);
  });
