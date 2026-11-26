/**
 * Where Chrome is.
 *
 * Every driving script hard-coded the macOS application path, which is right
 * on the machine this was built on and wrong everywhere else — including CI,
 * which is where these checks are most worth running. One place to look, and
 * an override for anything unusual.
 */

import { existsSync } from "node:fs";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
].filter((path) => typeof path === "string" && path.length > 0);

export function chromePath() {
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "No Chrome found. Set CHROME_PATH, or install Chrome or Chromium.\n" +
      `Looked in:\n${CANDIDATES.map((c) => `  ${c}`).join("\n")}`,
  );
}

/** The flags every one of these scripts wants. */
export const HEADLESS_FLAGS = [
  "--headless=new",
  "--hide-scrollbars",
  "--no-first-run",
  "--disable-gpu",
  // CI containers run as root without a user namespace; without these,
  // Chrome refuses to start and the failure reads as a timeout.
  ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
];
