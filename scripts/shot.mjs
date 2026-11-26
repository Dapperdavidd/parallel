/**
 * Screenshot a page through the DevTools Protocol with real device emulation,
 * optionally scrolled to an element, optionally full-page.
 *
 * Plain `--window-size` screenshots do not emulate a device, so the layout can
 * differ from what a phone actually renders. Using CDP keeps the picture and
 * any measurements in agreement.
 *
 *   node scripts/shot.mjs <url> <out.png> [width] [height] [--full] [--to=#sel]
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { chromePath } from "./chrome.mjs";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const pos = args.filter((a) => !a.startsWith("--"));

const URL_ = pos[0] ?? "http://localhost:3000/";
const OUT = pos[1] ?? "/tmp/shot.png";
const WIDTH = Number(pos[2] ?? 1440);
const HEIGHT = Number(pos[3] ?? 900);
const FULL = flags.includes("--full");
const MOBILE = WIDTH < 820;
const TO = flags.find((f) => f.startsWith("--to="))?.slice(5);

const PORT = 9223;
const CHROME = chromePath();

// Never hang: a page with autoplaying video can keep Chrome busy, and a stuck
// screenshot is worse than a missing one.
const HARD_TIMEOUT_MS = 90_000;
setTimeout(() => {
  console.error("timed out waiting for Chrome");
  process.exit(1);
}, HARD_TIMEOUT_MS).unref();

// Headless defaults to no GPU, which also means no WebGL. --gpu swaps in a
// software rasteriser so WebGL content can be captured.
const GPU = flags.includes("--gpu");

const chrome = spawn(CHROME, [
  "--headless=new",
  ...(GPU
    ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    : ["--disable-gpu"]),
  "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,
  "--no-first-run",
  "--user-data-dir=/tmp/chrome-shot-profile",
  "about:blank",
], { stdio: "ignore" });

const cleanup = () => { try { chrome.kill(); } catch { /* gone */ } };
process.on("exit", cleanup);

let target;
let lastErr;
for (let i = 0; i < 60; i++) {
  await sleep(400);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === "page");
    if (target?.webSocketDebuggerUrl) break;
    lastErr = `no page target among ${list.length} targets`;
  } catch (e) {
    lastErr = e instanceof Error ? e.message : String(e);
  }
}
if (!target) {
  console.error(`could not reach Chrome on ${PORT}: ${lastErr}`);
  process.exit(1);
}

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
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: MOBILE ? 2 : 1, mobile: MOBILE,
});
// --state=<json> seeds the demo store before the app loads, so pages behind
// sign-in can be captured without driving the sign-in form every time.
const STATE = flags.find((f) => f.startsWith("--state="))?.slice(8);
if (STATE) {
  const origin = new URL(URL_).origin;
  await send("Page.navigate", { url: `${origin}/` });
  await sleep(1500);
  await send("Runtime.evaluate", {
    expression: `sessionStorage.setItem("parallel.demo", ${JSON.stringify(STATE)})`,
  });
}

await send("Page.navigate", { url: URL_ });
// --wait= for pages that need longer to settle (software WebGL, say).
await sleep(Number(flags.find((f) => f.startsWith("--wait="))?.slice(7) ?? 5500));

const SCROLL = flags.find((f) => f.startsWith("--scroll="))?.slice(9);
if (SCROLL) {
  // Absolute scroll, in px or in viewport heights with a `vh` suffix.
  const expr = SCROLL.endsWith("vh")
    ? `scrollTo({top: innerHeight * ${parseFloat(SCROLL)}, behavior:"instant"})`
    : `scrollTo({top: ${parseFloat(SCROLL)}, behavior:"instant"})`;
  await send("Runtime.evaluate", { expression: expr });
  await sleep(1600);
}

// --click=<selector> clicks something before the shot, for menus and popovers.
const CLICK = flags.find((f) => f.startsWith("--click="))?.slice(8);
if (CLICK) {
  await send("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(CLICK)})?.click()`,
  });
  await sleep(700);
}

if (TO) {
  await send("Runtime.evaluate", {
    expression: `(()=>{const e=document.querySelector(${JSON.stringify(TO)});
      if(e){const y=e.getBoundingClientRect().top+scrollY;scrollTo({top:y,behavior:"instant"});}})()`,
  });
  await sleep(1800);
}

// Pause any playing video first. Chrome can sit waiting for a stable frame
// otherwise, and captureScreenshot never returns. It also makes shots
// deterministic, which matters when comparing before and after.
await send("Runtime.evaluate", {
  expression: `document.querySelectorAll("video").forEach(v=>{try{v.pause()}catch(e){}})`,
});
await sleep(400);

const params = { format: "png", captureBeyondViewport: FULL };
if (FULL) {
  const { result } = await send("Runtime.evaluate", {
    expression: `JSON.stringify({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight})`,
    returnByValue: true,
  });
  const { w, h } = JSON.parse(result.result.value);
  params.clip = { x: 0, y: 0, width: w, height: Math.min(h, 20000), scale: 1 };
}

const shot = await send("Page.captureScreenshot", params);
writeFileSync(OUT, Buffer.from(shot.result.data, "base64"));
console.log(`${OUT}  ${WIDTH}x${HEIGHT}${MOBILE ? " (mobile)" : ""}${FULL ? " full" : ""}`);

ws.close();
cleanup();
process.exit(0);
