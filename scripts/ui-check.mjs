/**
 * The interface checks, as a gate.
 *
 * Accessibility, mobile layout and page weight were each fixed once by
 * running a script by hand and reading the output. That lasts until the next
 * person adds a component — so the same three checks run here, over every
 * page, with thresholds, and a non-zero exit when they are not met.
 *
 * The thresholds are the state of the app when they were written, with a
 * little headroom. They are meant to be *lowered* as things improve, and
 * raising one should take an argument.
 *
 *   node scripts/ui-check.mjs [baseUrl]
 */

import { spawn } from "node:child_process";
import { once } from "node:events";

const BASE = process.argv[2] ?? "http://localhost:3000";

/** Every page a visitor can reach, and the widths that matter. */
const PAGES = [
  "/",
  "/docs",
  "/docs/prices",
  "/docs/faq",
  "/docs/api",
  "/status",
  "/legal/terms",
  "/legal/privacy",
  "/open-index",
  "/vaults",
  "/signin",
  "/app/markets",
  "/app/trade?m=NGN",
  "/app/portfolio",
  "/app/hedge",
];

const WIDTHS = [390, 1512];

/**
 * Script budgets, in kB over the wire, first visit.
 *
 * Public pages are held much tighter than the app: somebody reading the
 * documentation has not asked for a trading terminal, and the people this is
 * for are paying by the megabyte.
 */
const SCRIPT_BUDGET_KB = [
  { prefix: "/app", limit: 1_250 },
  { prefix: "/signin", limit: 1_100 },
  { prefix: "/", limit: 200 },
];

const budgetFor = (path) =>
  SCRIPT_BUDGET_KB.find((entry) => path.startsWith(entry.prefix) && entry.prefix !== "/")?.limit ??
  SCRIPT_BUDGET_KB[SCRIPT_BUDGET_KB.length - 1].limit;

async function run(script, args) {
  const child = spawn("node", [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (out += chunk));
  const [code] = await once(child, "close");
  return { code, out };
}

const failures = [];
let checks = 0;

console.log(`\nUI checks against ${BASE}\n`);

// ------------------------------------------------------- accessibility --
for (const page of PAGES) {
  for (const width of WIDTHS) {
    const { out } = await run("scripts/a11y.mjs", [`${BASE}${page}`, String(width)]);
    checks += 1;
    const found = /(\d+) findings/.exec(out);
    if (found) {
      failures.push(`a11y  ${page} @${width}  ${found[1]} findings\n${out.split("\n").slice(2).join("\n")}`);
      console.log(`  FAIL  a11y      ${page} @${width} — ${found[1]} findings`);
    } else if (/nothing found/.test(out)) {
      console.log(`  ok    a11y      ${page} @${width}`);
    } else {
      failures.push(`a11y  ${page} @${width}  did not run\n${out}`);
      console.log(`  FAIL  a11y      ${page} @${width} — did not run`);
    }
  }
}

// ------------------------------------------------------- mobile layout --
for (const page of PAGES) {
  const { out } = await run("scripts/find-overflow.mjs", [`${BASE}${page}`, "390"]);
  checks += 1;
  if (/nothing overflows/.test(out)) {
    console.log(`  ok    overflow  ${page} @390`);
  } else {
    failures.push(`overflow  ${page}\n${out}`);
    console.log(`  FAIL  overflow  ${page} @390`);
  }
}

// ----------------------------------------------------------- page weight --
for (const page of PAGES) {
  const { out } = await run("scripts/weigh.mjs", [`${BASE}${page}`, "390"]);
  checks += 1;
  const script = /Script\s+(\d+) kB/.exec(out);
  const limit = budgetFor(page);
  if (!script) {
    failures.push(`weight  ${page}  could not be measured\n${out}`);
    console.log(`  FAIL  weight    ${page} — not measured`);
    continue;
  }
  const kb = Number(script[1]);
  if (kb > limit) {
    failures.push(`weight  ${page}  ${kb} kB of script, budget ${limit} kB`);
    console.log(`  FAIL  weight    ${page} — ${kb} kB > ${limit} kB`);
  } else {
    console.log(`  ok    weight    ${page} — ${kb} kB (budget ${limit})`);
  }
}

console.log(`\n${checks - failures.length}/${checks} passed`);
if (failures.length > 0) {
  console.log(`\n${failures.length} failing:\n`);
  for (const failure of failures) console.log(`${failure}\n`);
  process.exit(1);
}
console.log("");
