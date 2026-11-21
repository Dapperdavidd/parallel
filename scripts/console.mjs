/**
 * Print a page's console output and uncaught exceptions.
 *
 *   node scripts/console.mjs <url>
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const URL_ = process.argv[2] ?? "http://localhost:3000/";
const PORT = 9226;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--user-data-dir=/tmp/chrome-console-profile", "about:blank",
], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill(); } catch { /* gone */ } };
process.on("exit", cleanup);
setTimeout(() => { console.error("timed out"); process.exit(1); }, 70_000).unref();

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
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }

  if (m.method === "Runtime.consoleAPICalled") {
    const text = (m.params.args ?? [])
      .map((a) => a.value ?? a.description ?? a.type)
      .join(" ");
    console.log(`[${m.params.type}] ${text}`);
  }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    console.log(`[EXCEPTION] ${d.exception?.description ?? d.text}`);
  }
  if (m.method === "Network.loadingFailed") {
    console.log(`[FAILED] ${m.params.errorText} ${m.params.type}`);
  }
  if (m.method === "Network.responseReceived" && m.params.response.status >= 400) {
    console.log(`[HTTP ${m.params.response.status}] ${m.params.response.url}`);
  }
  if (m.method === "Log.entryAdded") {
    console.log(`[${m.params.entry.level}] ${m.params.entry.text}`);
  }
});

const send = (method, params = {}) =>
  new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

await send("Runtime.enable");
await send("Network.enable");
await send("Log.enable");
await send("Page.enable");
await send("Page.navigate", { url: URL_ });
await sleep(7000);

ws.close(); cleanup(); process.exit(0);
