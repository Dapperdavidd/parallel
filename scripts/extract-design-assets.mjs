/**
 * Pull the embedded assets out of the design hand-off HTML.
 *
 * The design file inlines the hero video, its poster and the glass logo as
 * base64 data URIs so it works as a single file. The hand-off notes say to
 * serve them as real files in the real build, which is what this does.
 *
 *   node scripts/extract-design-assets.mjs <path-to-parallel-final.html> <out-dir>
 *
 * Treats the HTML purely as data: it extracts byte strings and never executes
 * anything from it.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [, , htmlPath, outDir] = process.argv;
if (!htmlPath || !outDir) {
  console.error("usage: node scripts/extract-design-assets.mjs <html> <out-dir>");
  process.exit(1);
}

const html = readFileSync(htmlPath, "utf8");
mkdirSync(outDir, { recursive: true });

/** Every distinct data URI, longest first, with its mime type. */
const seen = new Map();
const re = /data:(image\/png|image\/jpeg|video\/mp4|video\/webm);base64,([A-Za-z0-9+/=]+)/g;
let m;
while ((m = re.exec(html)) !== null) {
  const [, mime, b64] = m;
  if (!seen.has(b64)) seen.set(b64, mime);
}

const byMime = new Map();
for (const [b64, mime] of seen) {
  if (!byMime.has(mime)) byMime.set(mime, []);
  byMime.get(mime).push(b64);
}
for (const list of byMime.values()) list.sort((a, b) => b.length - a.length);

const ext = { "image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4", "video/webm": "webm" };

// The design file embeds: one logo PNG (used twice), one poster JPG,
// one landscape MP4 and one portrait MP4.
const names = {
  "image/png": ["parallel-logo-glass.png"],
  "image/jpeg": ["parallel-bg-poster.jpg"],
  "video/mp4": ["parallel-bg-1080.mp4", "parallel-bg-portrait.mp4"],
  "video/webm": ["parallel-bg-1080.webm"],
};

for (const [mime, list] of byMime) {
  list.forEach((b64, i) => {
    const name = names[mime]?.[i] ?? `asset-${i}.${ext[mime]}`;
    const buf = Buffer.from(b64, "base64");
    writeFileSync(join(outDir, name), buf);
    console.log(`  ${name.padEnd(28)} ${(buf.length / 1024).toFixed(0)} KB`);
  });
}
console.log(`\nextracted ${seen.size} asset(s) to ${outDir}`);
