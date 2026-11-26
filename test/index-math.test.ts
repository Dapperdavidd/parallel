import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeIndex,
  median,
  MIN_SOURCES,
  OFFICIAL_BAND_PCT,
  OUTLIER_PCT,
  pctDiff,
  PUSH_MAX_AGE_MS,
  shouldPush,
} from "../src/lib/index-math.js";
import type { MarketDef } from "../src/lib/markets.js";
import type { SourceReading } from "../src/lib/sources.js";

/**
 * The oracle rules, tested against the prices they will actually see.
 *
 * This is the arithmetic every position on the platform is marked against, so
 * each PRD rule gets a case that fails if the rule is relaxed — including the
 * two that *refuse* to produce a price, which are the ones that keep us from
 * marking a position against a number we do not believe.
 */

const NGN: MarketDef = {
  id: "USD/NGN",
  currency: "NGN",
  unitSize: 1_000,
  unitLabel: "kNGN",
  status: "live",
  region: "West Africa",
  maxLeverage: 5,
};

const reading = (id: string, rate: number | null, error?: string): SourceReading => ({
  id,
  label: id,
  kind: "street",
  ok: rate !== null,
  ...(rate !== null ? { rate } : {}),
  ...(error ? { error } : {}),
  ms: 120,
});

test("median is the middle of an odd set and the mean of the middle two", () => {
  assert.equal(median([3]), 3);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  // Order of arrival must not matter.
  assert.equal(median([1_500, 1_450, 1_460]), median([1_460, 1_500, 1_450]));
  assert.throws(() => median([]), /empty/);
});

test("pctDiff is signed and relative to the reference", () => {
  assert.equal(pctDiff(110, 100), 10);
  assert.equal(pctDiff(90, 100), -10);
});

test("a healthy set of sources produces a price and a unit price", () => {
  const tick = computeIndex(
    NGN,
    [reading("a", 1_450), reading("b", 1_455), reading("c", 1_452)],
    1_430,
  );
  assert.equal(tick.status, "ok");
  assert.equal(tick.median, 1_452);
  // What Percolator is told: dollars per 1,000 naira.
  assert.ok(Math.abs(tick.unitPriceUsd! - 1_000 / 1_452) < 1e-12);
  assert.equal(tick.sourcesUsed.length, 3);
  assert.equal(tick.dropped.length, 0);
  assert.ok(Math.abs(tick.premiumPct! - pctDiff(1_452, 1_430)) < 1e-12);
});

test("rule 3: a source beyond the outlier band is dropped and the median recomputed", () => {
  const tick = computeIndex(
    NGN,
    [reading("a", 1_450), reading("b", 1_455), reading("c", 1_452), reading("rogue", 2_900)],
    1_430,
  );
  assert.equal(tick.status, "ok");
  assert.deepEqual(tick.dropped.map((d) => d.id), ["rogue"]);
  assert.equal(tick.median, 1_452);
  assert.ok(!tick.sourcesUsed.includes("rogue"));
  // A reading just inside the band stays.
  const inside = computeIndex(
    NGN,
    [reading("a", 1_450), reading("b", 1_455), reading("c", 1_452 * (1 + (OUTLIER_PCT - 1) / 100))],
    1_430,
  );
  assert.equal(inside.dropped.length, 0);
});

test("rule 4: one live source is not an index", () => {
  const tick = computeIndex(
    NGN,
    [reading("a", 1_450), reading("b", null, "ECONNRESET"), reading("c", null, "timeout")],
    1_430,
  );
  assert.equal(tick.status, "paused_few_sources");
  assert.equal(tick.median, null);
  assert.equal(tick.unitPriceUsd, null);
  assert.match(tick.reason ?? "", new RegExp(`need ${MIN_SOURCES}`));
  // The failures are still reported, so the open index page can show them.
  assert.equal(tick.failed.length, 2);
});

test("rule 4 again: outlier removal can itself starve a market", () => {
  // Two sources far apart: the provisional median sits between them and drops
  // both, which must pause rather than invent a price from nothing.
  const tick = computeIndex(NGN, [reading("a", 1_000), reading("b", 2_000)], 1_430);
  assert.equal(tick.status, "paused_few_sources");
  assert.equal(tick.median, null);
  assert.match(tick.reason ?? "", /outlier rule/);
  assert.equal(tick.dropped.length, 2);
});

test("rule 5: a median far from the official rate pauses the market", () => {
  const official = 1_000;
  const tick = computeIndex(
    NGN,
    [reading("a", 1_200), reading("b", 1_205), reading("c", 1_202)],
    official,
  );
  assert.equal(tick.status, "paused_official_band");
  // The numbers are still returned — the market pauses, it does not go blind.
  assert.equal(tick.median, 1_202);
  assert.ok(tick.premiumPct! > OFFICIAL_BAND_PCT);
  assert.match(tick.reason ?? "", /from official/);
});

test("rule 5 does not apply when there is no official rate to compare with", () => {
  const tick = computeIndex(NGN, [reading("a", 5_000), reading("b", 5_010)], null);
  assert.equal(tick.status, "ok");
  assert.equal(tick.premiumPct, null);
});

test("rule 6: the first price is always pushed", () => {
  const tick = computeIndex(NGN, [reading("a", 1_450), reading("b", 1_452)], 1_430);
  assert.deepEqual(shouldPush(tick, null), { push: true, reason: "first push" });
});

test("rule 6: a move past the threshold is pushed, a smaller one waits", () => {
  const tick = computeIndex(NGN, [reading("a", 1_450), reading("b", 1_450)], 1_430);
  const unit = tick.unitPriceUsd!;
  const now = Date.now();

  const moved = shouldPush(tick, { unitPriceUsd: unit * 0.99, at: now }, now);
  assert.equal(moved.push, true);
  assert.match(moved.reason, /moved/);

  const still = shouldPush(tick, { unitPriceUsd: unit * 1.0001, at: now }, now);
  assert.equal(still.push, false);
});

test("rule 6: a quiet market is pushed once the age limit passes", () => {
  const tick = computeIndex(NGN, [reading("a", 1_450), reading("b", 1_450)], 1_430);
  const unit = tick.unitPriceUsd!;
  const now = Date.now();
  const stale = shouldPush(tick, { unitPriceUsd: unit, at: now - PUSH_MAX_AGE_MS - 1 }, now);
  assert.equal(stale.push, true);
  assert.match(stale.reason, /since last push/);
});

test("a paused market is never pushed on-chain", () => {
  const paused = computeIndex(NGN, [reading("a", 1_450)], 1_430);
  const verdict = shouldPush(paused, { unitPriceUsd: 0.5, at: 0 });
  assert.equal(verdict.push, false);
  assert.match(verdict.reason, /paused_few_sources/);
});
