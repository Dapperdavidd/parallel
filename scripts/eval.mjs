/**
 * Run an expression in the page and print what it returns. For the questions a
 * screenshot cannot answer — computed colours, counts, text content.
 *
 *   node scripts/eval.mjs <url> '<expression>' [--state=<json>]
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const pos = args.filter((a) => !a.startsWith("--"));
const [URL_, EXPR] = pos;
const STATE = flags.find((f) => f.startsWith("--state="))?.slice(8);

const PORT = 9226;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const GPU = flags.includes("--gpu");
const chrome = spawn(CHROME, [
  "--headless=new", "--hide-scrollbars",
  ...(GPU
    ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    : ["--disable-gpu"]),
  `--remote-debugging-port=${PORT}`, "--no-first-run",
  "--user-data-dir=/tmp/chrome-eval-profile", "about:blank",
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
  } catch { /* not up yet */ }
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

if (STATE) {
  await send("Page.navigate", { url: new URL(URL_).origin + "/" });
  await sleep(1500);
  await send("Runtime.evaluate", {
    expression: `sessionStorage.setItem("parallel.demo", ${JSON.stringify(STATE)})`,
  });
}

await send("Page.navigate", { url: URL_ });
await sleep(5000);

// awaitPromise lets the expression be async — without it a Promise comes back
// as an empty object, which looks like a failed query rather than a pending one.
const { result } = await send("Runtime.evaluate", {
  expression: EXPR, returnByValue: true, awaitPromise: true,
});
console.log(typeof result.result.value === "string"
  ? result.result.value
  : JSON.stringify(result.result.value, null, 1));

ws.close(); cleanup(); process.exit(0);
