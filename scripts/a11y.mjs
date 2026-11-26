/**
 * An accessibility pass over a page, in the page.
 *
 * Not a replacement for a real audit — it checks the things that are
 * mechanically checkable and that this codebase is most likely to get wrong:
 * controls with no accessible name, text below the WCAG AA contrast ratio,
 * focusable things with no visible focus ring, images with no alt, and
 * touch targets smaller than a fingertip.
 *
 *   node scripts/a11y.mjs <url> [width]
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const [URL_, WIDTH = "1512"] = process.argv.slice(2);
const PORT = 9234;

const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`, "--no-first-run",
    "--user-data-dir=/tmp/chrome-a11y", "about:blank",
  ],
  { stdio: "ignore" },
);
const cleanup = () => { try { chrome.kill(); } catch { /* gone */ } };
process.on("exit", cleanup);
setTimeout(() => { console.error("timed out"); process.exit(1); }, 90_000).unref();

let target;
for (let i = 0; i < 60; i += 1) {
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
await send("Emulation.setDeviceMetricsOverride", {
  width: Number(WIDTH), height: 900, deviceScaleFactor: 1, mobile: Number(WIDTH) < 900,
});
await send("Page.navigate", { url: URL_ });
await sleep(5000);

const AUDIT = String.raw`(() => {
  const out = { nameless: [], contrast: [], noFocus: [], noAlt: [], smallTargets: [], headings: [] };
  const describe = (el) => {
    const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0,2).join(".") : "";
    const text = (el.textContent || "").trim().slice(0, 28);
    return el.tagName.toLowerCase() + cls + (text ? ' "' + text + '"' : "");
  };

  // --- luminance and contrast ------------------------------------------
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((n) => parseFloat(n));
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const backdrop = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.95) return bg;
      node = node.parentElement;
    }
    return { r: 11, g: 11, b: 12, a: 1 };
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // Anything inside an aria-hidden subtree is not in the accessibility tree,
  // so it is not a finding — decorative wordmarks and icon paths live there.
  const hidden = (el) => el.closest('[aria-hidden="true"]') !== null;

  const visible = (el) => {
    if (hidden(el)) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  };

  // --- controls without an accessible name ------------------------------
  for (const el of document.querySelectorAll('button, a[href], [role="button"], input, select, summary')) {
    if (!visible(el)) continue;
    // A label element counts, whether it points at the control by id or
    // wraps it. Missing that reported every properly-labelled input.
    const labelled = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    const wrapping = el.closest("label");
    const name = (el.getAttribute("aria-label") || el.getAttribute("title") ||
      (el.getAttribute("aria-labelledby") ? (document.getElementById(el.getAttribute("aria-labelledby"))||{}).textContent : "") ||
      (labelled ? labelled.textContent : "") ||
      (wrapping ? wrapping.textContent : "") ||
      el.textContent || el.getAttribute("alt") || el.getAttribute("placeholder") || "").trim();
    if (name.length === 0) out.nameless.push(describe(el));
  }

  // --- contrast on visible text -----------------------------------------
  const seen = new Set();
  for (const el of document.querySelectorAll("p, span, b, a, li, td, th, h1, h2, h3, h4, label, small, button, div")) {
    if (!visible(el)) continue;
    const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!direct) continue;
    const st = getComputedStyle(el);
    const fg = parse(st.color);
    if (!fg) continue;
    const bg = backdrop(el);
    const r = ratio(over(fg, bg), bg);
    const size = parseFloat(st.fontSize);
    const bold = parseInt(st.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (r < need) {
      const key = st.color + "|" + size;
      if (seen.has(key)) continue;
      seen.add(key);
      out.contrast.push({ el: describe(el), ratio: Math.round(r * 100) / 100, need, color: st.color, size });
    }
  }

  // --- images ------------------------------------------------------------
  for (const img of document.querySelectorAll("img")) {
    if (hidden(img)) continue;
    if (!img.hasAttribute("alt")) out.noAlt.push(describe(img));
  }

  // --- touch targets ------------------------------------------------------
  //
  // WCAG 2.2's 24x24 minimum (2.5.8) exempts a link inside a sentence, where
  // enlarging it would break the line. So a link whose parent is running prose
  // is not a finding; a control is.
  if (window.innerWidth < 900) {
    const inlineParents = new Set(["P", "LI", "SPAN", "TD", "SMALL", "LABEL", "H1", "H2", "H3"]);
    for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
      if (!visible(el)) continue;
      // Hidden until focused, by design.
      if (el.classList.contains("sr-only")) continue;
      const parent = el.parentElement;
      const inSentence =
        el.tagName === "A" &&
        parent &&
        inlineParents.has(parent.tagName) &&
        (parent.textContent || "").trim().length > (el.textContent || "").trim().length + 12;
      if (inSentence) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 24 || r.width < 24) {
        out.smallTargets.push(describe(el) + " " + Math.round(r.width) + "x" + Math.round(r.height));
      }
    }
  }

  // --- heading order ------------------------------------------------------
  let last = 0;
  for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    if (!visible(h)) continue;
    const level = Number(h.tagName[1]);
    if (last && level > last + 1) out.headings.push("jumped h" + last + " to h" + level + ": " + describe(h));
    last = level;
  }

  return JSON.stringify(out);
})()`;

const result = await send("Runtime.evaluate", { expression: AUDIT, returnByValue: true });
const report = JSON.parse(result.result.result.value);

/**
 * Focus, tested the way a keyboard user meets it.
 *
 * `element.focus()` from script does not satisfy `:focus-visible` — Chrome
 * only applies it when focus arrived by keyboard. An audit that focuses
 * programmatically therefore reports every control on the page as missing a
 * focus ring, which is both alarming and wrong. So this presses Tab.
 */
const tab = async () => {
  await send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, key: "Tab", code: "Tab",
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, key: "Tab", code: "Tab",
  });
};

const PROBE = String.raw`(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return JSON.stringify({ end: true });
  const st = getComputedStyle(el);
  const ring = (st.outlineStyle !== "none" && parseFloat(st.outlineWidth) > 0) ||
    (st.boxShadow && st.boxShadow !== "none" && !/inset/.test(st.boxShadow));
  const cls = typeof el.className === "string" && el.className
    ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
  const r = el.getBoundingClientRect();
  return JSON.stringify({
    tag: el.tagName.toLowerCase() + cls,
    text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 26),
    ring,
    matchesFocusVisible: el.matches(":focus-visible"),
    offscreen: r.width === 0 && r.height === 0,
  });
})()`;

const stops = [];
for (let i = 0; i < 70; i += 1) {
  await tab();
  const probe = await send("Runtime.evaluate", { expression: PROBE, returnByValue: true });
  const stop = JSON.parse(probe.result.result.value);
  if (stop.end) break;
  stops.push(stop);
}
report.noFocus = stops
  .filter((stop) => stop.matchesFocusVisible && !stop.ring && !stop.offscreen)
  .map((stop) => `${stop.tag}${stop.text ? ` "${stop.text}"` : ""}`);
report.tabStops = stops.length;

const show = (title, rows, format = (r) => r) => {
  if (rows.length === 0) return 0;
  console.log(`\n  ${title} (${rows.length})`);
  for (const row of rows.slice(0, 12)) console.log("    " + format(row));
  if (rows.length > 12) console.log(`    … and ${rows.length - 12} more`);
  return rows.length;
};

console.log(`\n${URL_}  @${WIDTH}px  ·  ${report.tabStops} tab stops`);
let total = 0;
total += show("No accessible name", report.nameless);
total += show("Contrast below AA", report.contrast, (r) => `${r.ratio}:1 (needs ${r.need}) ${r.color} ${r.size}px — ${r.el}`);
total += show("No visible focus", report.noFocus);
total += show("Image without alt", report.noAlt);
total += show("Touch target under 24px", report.smallTargets);
total += show("Heading level skipped", report.headings);
if (total === 0) console.log("\n  nothing found\n");
else console.log(`\n  ${total} findings\n`);

ws.close();
cleanup();
process.exit(0);
