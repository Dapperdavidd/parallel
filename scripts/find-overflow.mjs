/**
 * Find what is making a page wider than its viewport.
 *
 * Drives headless Chrome over the DevTools Protocol, emulates a phone-width
 * viewport, and reports every element whose box sticks out past it. Beats
 * guessing at CSS.
 *
 *   node scripts/find-overflow.mjs <url> [width]
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const URL_ = process.argv[2] ?? "http://localhost:3000/";
const WIDTH = Number(process.argv[3] ?? 414);
const PORT = 9222;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  `--remote-debugging-port=${PORT}`,
  "--no-first-run",
  "--user-data-dir=/tmp/chrome-overflow-profile",
  "about:blank",
], { stdio: "ignore" });

const cleanup = () => { try { chrome.kill(); } catch { /* already gone */ } };
process.on("exit", cleanup);

let target;
for (let i = 0; i < 40; i++) {
  await sleep(300);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const list = await res.json();
    target = list.find((t) => t.type === "page");
    if (target?.webSocketDebuggerUrl) break;
  } catch { /* not up yet */ }
}
if (!target) { console.error("could not reach Chrome"); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH, height: 820, deviceScaleFactor: 1, mobile: true,
});
await send("Page.navigate", { url: URL_ });
await sleep(6000);

const expr = `(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.position === "fixed") continue;

    // Skip anything sitting inside a container that already clips or scrolls
    // horizontally — it cannot widen the document, so it is noise.
    let clipped = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "hidden" || ox === "scroll") { clipped = true; break; }
    }
    if (clipped) continue;

    const right = r.left + r.width;
    if (right > vw + 1 || r.left < -1) {
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 44),
        left: Math.round(r.left),
        width: Math.round(r.width),
        right: Math.round(right),
        over: Math.round(right - vw),
        ws: style.whiteSpace,
        text: (el.textContent || "").trim().slice(0, 28),
      });
    }
  }
  out.sort((a, b) => b.over - a.over);
  return JSON.stringify({
    viewport: vw,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    worst: out.slice(0, 14),
  });
})()`;

const { result } = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
const data = JSON.parse(result.result.value);

console.log(`viewport ${data.viewport}  ·  html.scrollWidth ${data.scrollWidth}  ·  body.scrollWidth ${data.bodyScrollWidth}\n`);
if (data.worst.length === 0) {
  console.log("nothing overflows");
} else {
  console.log("tag/class".padEnd(48), "left".padStart(6), "width".padStart(7), "over".padStart(6), " white-space");
  console.log("-".repeat(96));
  for (const e of data.worst) {
    console.log(
      `${e.tag}.${e.cls}`.slice(0, 48).padEnd(48),
      String(e.left).padStart(6),
      String(e.width).padStart(7),
      String(e.over).padStart(6),
      ` ${e.ws}`,
      e.text ? ` “${e.text}”` : "",
    );
  }
}
ws.close();
cleanup();
process.exit(0);
