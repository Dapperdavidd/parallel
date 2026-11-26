/**
 * What a page actually downloads.
 *
 * The build's "first load JS" is an estimate of a route's own module graph.
 * This is the real number: every response the browser fetched, by type, over
 * the wire, with the heaviest named. Cache disabled, so it is always the
 * first-visit cost.
 *
 *   node scripts/weigh.mjs <url> [width]
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const [URL_, WIDTH = "1512"] = process.argv.slice(2);
if (!URL_) {
  console.error("usage: node scripts/weigh.mjs <url> [width]");
  process.exit(1);
}

const PORT = 9231;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`,
    "--no-first-run",
    "--user-data-dir=/tmp/chrome-weigh-profile",
    "about:blank",
  ],
  { stdio: "ignore" },
);
const cleanup = () => {
  try {
    chrome.kill();
  } catch {
    /* already gone */
  }
};
process.on("exit", cleanup);
setTimeout(() => {
  console.error("timed out");
  process.exit(1);
}, 90_000).unref();

let target;
for (let i = 0; i < 60; i += 1) {
  await sleep(400);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === "page");
    if (target?.webSocketDebuggerUrl) break;
  } catch {
    /* not up yet */
  }
}
if (!target) {
  console.error("no Chrome");
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
const seen = new Map();
const done = [];

ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  if (m.method === "Network.responseReceived") {
    seen.set(m.params.requestId, { url: m.params.response.url, type: m.params.type });
  }
  if (m.method === "Network.loadingFinished") {
    const info = seen.get(m.params.requestId);
    if (info) done.push({ ...info, bytes: m.params.encodedDataLength });
  }
});

const send = (method, params = {}) =>
  new Promise((res) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: Number(WIDTH),
  height: 900,
  deviceScaleFactor: 1,
  mobile: Number(WIDTH) < 900,
});
await send("Page.navigate", { url: URL_ });
await sleep(7000);

const byType = new Map();
let total = 0;
for (const entry of done) {
  total += entry.bytes;
  byType.set(entry.type, (byType.get(entry.type) ?? 0) + entry.bytes);
}

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(`\n${URL_}  @${WIDTH}px`);
for (const [type, bytes] of [...byType].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type.padEnd(12)} ${kb(bytes).padStart(9)}`);
}
console.log(`  ${"TOTAL".padEnd(12)} ${kb(total).padStart(9)}  (${done.length} requests)`);
for (const entry of [...done].sort((a, b) => b.bytes - a.bytes).slice(0, 5)) {
  console.log(`    ${kb(entry.bytes).padStart(9)}  ${entry.url.replace(/^https?:\/\/[^/]+/, "")}`);
}

ws.close();
cleanup();
process.exit(0);
