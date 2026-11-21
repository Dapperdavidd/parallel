/**
 * A DNS resolver the index service controls.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 21 Nov 2026 every market paused at once: twelve of the thirteen could not
 * reach a single source. The cause was not the venues and not our code — the
 * network in use (a phone hotspot, gateway 172.20.10.1) simply would not
 * resolve `api.luno.com`, `www.okx.com` or `api.binance.com`, while the same
 * names resolved instantly through 1.1.1.1. Carrier and café DNS routinely
 * filters exchange domains.
 *
 * The PRD already names the shape of this risk — "P2P endpoints block cloud
 * IPs … markets pause safely instead of mispricing" — but pausing all thirteen
 * markets because of the *host's* resolver is not a safe pause, it is an
 * outage with a misleading cause. An index whose uptime target is 99% of
 * two-minute intervals cannot inherit whatever DNS the machine happens to have.
 *
 * So the HTTP layer resolves names itself, through public resolvers, and only
 * falls back to the system one. Nothing else about the request changes: real
 * TLS to the real host, same SNI, same certificate validation.
 */

import { Resolver } from "node:dns";
import { lookup as systemLookup } from "node:dns";
import { Agent, type Dispatcher } from "undici";

/** Public resolvers, tried in order. Cloudflare, then Google, then Quad9. */
const RESOLVERS = (process.env.PARALLEL_DNS ?? "1.1.1.1,8.8.8.8,9.9.9.9")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  addresses: { address: string; family: number }[];
  at: number;
}

const cache = new Map<string, CacheEntry>();

function resolveWith(server: string, hostname: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const r = new Resolver({ timeout: 2500, tries: 1 });
    r.setServers([server]);
    r.resolve4(hostname, (err, addrs) => {
      if (err) reject(err);
      else resolve(addrs);
    });
  });
}

type LookupOptions = { all?: boolean; family?: number };
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

/**
 * An undici-compatible `lookup`. Tries each public resolver, caches the
 * answer, and falls back to the operating system so a machine with working
 * DNS and no outbound port 53 still works.
 */
export const lookup = (
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
): void => {
  const hit = cache.get(hostname);
  if (hit && Date.now() - hit.at < TTL_MS) {
    // `all` asks for the full list; otherwise undici wants a single address.
    if (options.all) return callback(null, hit.addresses as never);
    const first = hit.addresses[0]!;
    return callback(null, first.address as never, first.family as never);
  }

  void (async () => {
    for (const server of RESOLVERS) {
      try {
        const addrs = await resolveWith(server, hostname);
        if (addrs.length === 0) continue;
        const entry: CacheEntry = {
          addresses: addrs.map((address) => ({ address, family: 4 })),
          at: Date.now(),
        };
        cache.set(hostname, entry);
        if (options.all) return callback(null, entry.addresses as never);
        const first = entry.addresses[0]!;
        return callback(null, first.address as never, first.family as never);
      } catch {
        /* try the next resolver */
      }
    }
    // Everything public failed — the box may be behind a resolver-only
    // network. Let the OS try; it is the one that knows about split horizons.
    systemLookup(hostname, options as never, callback as never);
  })();
};

/**
 * The dispatcher every outbound request in the index service uses.
 * Connection reuse matters: thirteen markets fan out to ~30 endpoints at once.
 */
export const dispatcher: Dispatcher = new Agent({
  connect: { lookup: lookup as never, timeout: 10_000 },
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 30_000,
  connections: 32,
});

/** Diagnostic: which resolver, if any, can see a host. */
export async function diagnose(hostname: string): Promise<string> {
  for (const server of RESOLVERS) {
    try {
      const addrs = await resolveWith(server, hostname);
      if (addrs.length > 0) return `${server} → ${addrs[0]}`;
    } catch (err) {
      void err;
    }
  }
  return "no resolver could answer";
}
