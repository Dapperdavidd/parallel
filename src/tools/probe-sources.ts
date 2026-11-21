/** Read every source for the given markets and print ok/fail with the reason. */
import { getMarket, LAUNCH_MARKETS } from "../lib/markets.js";
import { readSource, sourcesFor } from "../lib/sources.js";

const ids = process.argv.slice(2);
const markets = ids.length ? ids.map(getMarket) : [...LAUNCH_MARKETS];
for (const m of markets) {
  const readings = await Promise.all(sourcesFor(m.id).map((s) => readSource(s)));
  for (const r of readings) {
    console.log(`${m.id.padEnd(9)} ${r.id.padEnd(14)} ${r.ok ? `OK   ${r.rate}` : `FAIL ${r.error}`}`);
  }
}
