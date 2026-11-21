/**
 * Measure elements on a page through CDP. Beats guessing at layout.
 *
 *   node scripts/measure.mjs <url> <scrollVh> <selector> [selector...]
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const [, , URL_, SCROLL = "0", ...SELECTORS] = process.argv;
const PORT = 9225;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`, "--no-first-run",
  "--user-data-dir=/tmp/chrome-measure-profile", "about:blank",
], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill(); } catch { /* gone */ } };
process.on("exit", cleanup);
setTimeout(() => { console.error("timed out"); process.exit(1); }, 90_000).unref();

let target;
for (let i = 0; i < 60; i++) {
  await sleep(400);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === "page");
    if (target?.webSocketDebuggerUrl) break;
  } catch { /* not up */ }
}
if (!target) { console.error("no Chrome"); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) =>
  new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1512, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: URL_ });
await sleep(5000);
await send("Runtime.evaluate", { expression: `scrollTo({top: innerHeight*${SCROLL}, behavior:"instant"})` });
await sleep(1200);

const expr = `(() => {
  const sels = ${JSON.stringify(SELECTORS)};
  const out = sels.map(sel => {
    const el = document.querySelector(sel);
    if (!el) return { sel, missing: true };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { sel, top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width),
             display: cs.display, justify: cs.justifyContent, pos: cs.position,
             cssHeight: cs.height, minHeight: cs.minHeight };
  });
  return JSON.stringify({ vh: innerHeight, out }, null, 1);
})()`;
const { result } = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
console.log(result.result.value);
ws.close(); cleanup(); process.exit(0);
