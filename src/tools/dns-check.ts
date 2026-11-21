/** Which resolver, if any, can see each source host. Diagnostic only. */
import { diagnose } from "../lib/resolver.js";
import { SOURCES } from "../lib/sources.js";

const hosts = [...new Set(SOURCES.map((s) => new URL(s.url).hostname))].sort();
for (const h of hosts) {
  console.log(h.padEnd(28), await diagnose(h));
}
