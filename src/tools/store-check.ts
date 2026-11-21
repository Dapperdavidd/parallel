/** Read back what the index service wrote, through the Store interface. */
import { openStore } from "../lib/store/index.js";

const store = openStore();
console.log("store:", store.name);

const t = await store.latestTick("USD/NGN");
console.log("latest NGN tick:", t?.ts, t?.status, t?.unitPriceUsd, "sources:", t?.sourcesUsed.join(","));
console.log("breakdown rows:", t?.breakdown.length, "| failed:", t?.failed.length, "| dropped:", t?.dropped.length);

const ticks = await store.recentTicks("USD/NGN", 10);
console.log("recent ticks:", ticks.length);

const c = await store.candles("USD/NGN", "1H", 5);
console.log("1H candles:", c.length, c[c.length - 1]);

console.log("lastPush:", await store.lastPush("USD/NGN"));
await store.close();
