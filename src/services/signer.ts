/**
 * The liquidity signer.
 *
 * Parallel's web app is a counterparty to every trade: each one needs a
 * signature from that market's liquidity authority. Holding those thirteen
 * keys inside the Next.js process means any file-read or template bug in the
 * whole dependency tree is a key compromise, and the keys sit on the same box
 * as the public HTTP surface.
 *
 * This is the other half of `web/src/lib/server/signing.ts`. It holds the
 * keys, and it will sign exactly one shape of transaction:
 *
 *   - every instruction belongs to the compute-budget program or to Percolator;
 *   - exactly one Percolator instruction, and it is a trade (tag 6);
 *   - its vault-authority account is the key being asked for;
 *   - its market and vault-portfolio accounts match the registry;
 *   - the authority is not the fee payer, so it cannot be made to spend SOL.
 *
 * So a compromised web app cannot borrow this service to move the authority's
 * funds, retarget another market's vault, or sign anything that is not a trade
 * against the market it claims. Requests are authenticated by an HMAC over the
 * authority name and the message bytes, which also binds a captured request to
 * the one transaction it was made for.
 *
 * Run it beside the keeper, on the machine that already holds the keys:
 *
 *   PARALLEL_SIGNER_SECRET=… npm run signer -- --port=8787
 *
 * and point the web app at it with PARALLEL_SIGNER_URL.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, createPrivateKey, sign, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";
import { Turnkey } from "@turnkey/sdk-server";
import { TurnkeySigner } from "@turnkey/solana";
import { loadRegistry, type Registry } from "../lib/registry.js";
import { refusalReason } from "../lib/signer-policy.js";
import { readSource, SOURCES } from "../lib/sources.js";
import { stayAlive } from "../lib/stay-alive.js";

const MAX_BODY_BYTES = 8 * 1024;

const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const OFF = "\x1b[0m";

const stamp = (): string => new Date().toISOString();

type KeyBackend = "local" | "turnkey";

const TURNKEY_KEYS = [
  "TURNKEY_API_PUBLIC_KEY",
  "TURNKEY_API_PRIVATE_KEY",
  "TURNKEY_ORGANIZATION_ID",
] as const;

function keyBackend(): KeyBackend {
  const present = TURNKEY_KEYS.filter((name) => Boolean(process.env[name]));
  if (present.length === 0) return "local";
  if (present.length !== TURNKEY_KEYS.length) {
    const missing = TURNKEY_KEYS.filter((name) => !process.env[name]);
    throw new Error(`incomplete Turnkey configuration; missing ${missing.join(", ")}`);
  }
  return "turnkey";
}

let managedSigner: TurnkeySigner | undefined;

function turnkeySigner(): TurnkeySigner {
  if (managedSigner) return managedSigner;
  const organizationId = process.env.TURNKEY_ORGANIZATION_ID!;
  const turnkey = new Turnkey({
    apiBaseUrl: process.env.TURNKEY_API_BASE_URL ?? "https://api.turnkey.com",
    apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
    apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
    defaultOrganizationId: organizationId,
  });
  managedSigner = new TurnkeySigner({
    client: turnkey.apiClient(),
    organizationId,
  });
  return managedSigner;
}

function secret(): Buffer {
  const value = process.env.PARALLEL_SIGNER_SECRET;
  if (!value || value.length < 32) {
    throw new Error("PARALLEL_SIGNER_SECRET must be set, and at least 32 characters");
  }
  return Buffer.from(value, "utf8");
}

/** Where this machine keeps its keys. Mirrors the web app's local mode. */
function keypairFor(authority: string): Keypair {
  const inline = process.env.PARALLEL_LIQUIDITY_SECRETS;
  if (inline) {
    const bytes = (JSON.parse(inline) as Record<string, number[]>)[authority];
    if (!bytes) throw new Error(`no secret configured for ${authority}`);
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  }
  const file = `liquidity-${authority.toLowerCase()}.json`;
  const directory = process.env.PARALLEL_LIQUIDITY_SECRETS_DIR ?? "wallets";
  const path = resolve(directory, file);
  if (!path.startsWith(resolve(directory))) {
    throw new Error("refusing a path outside the key directory");
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
}

/**
 * Sign with Node's own ed25519, rather than a signature library.
 *
 * A Solana secret key is the 32-byte seed followed by the public key; Node
 * takes the seed wrapped in the fixed PKCS#8 prefix for the curve. Verified
 * against `Transaction.addSignature`, which checks a signature before
 * accepting it.
 */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function signWith(keypair: Keypair, message: Buffer): Buffer {
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(keypair.secretKey.subarray(0, 32))]),
    format: "der",
    type: "pkcs8",
  });
  return sign(null, message, key);
}

async function signFor(
  authority: string,
  message: Buffer,
  registry: Registry,
  backend: KeyBackend,
): Promise<Buffer> {
  if (backend === "local") return signWith(keypairFor(authority), message);
  const entry = registry.markets.find((market) => market.currency === authority);
  const address = entry?.liquidityVault?.authority;
  if (!address) throw new Error(`no managed signing address configured for ${authority}`);
  return Buffer.from(await turnkeySigner().signMessage(message, address));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error("request body is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const send = (response: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  response.end(text);
};

function macMatches(presented: string | undefined, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented, "base64");
  const b = Buffer.from(expected, "base64");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  registry: Registry,
  key: Buffer,
  backend: KeyBackend,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://parallel.local");
  if (request.method === "GET" && url.pathname === "/source/okx") {
    const market = url.searchParams.get("market");
    const source = SOURCES.find(
      (candidate) => candidate.market === market && candidate.id === "okx_p2p",
    );
    if (!source) {
      send(response, 404, { error: "unknown market" });
      return;
    }
    const reading = await readSource(source, { timeoutMs: 12_000, retries: 1 });
    if (!reading.ok) {
      send(response, 503, { error: "source unavailable" });
      return;
    }
    send(response, 200, { rate: reading.rate });
    return;
  }
  if (request.url === "/health") {
    send(response, 200, { ok: true, markets: registry.markets.length, keyBackend: backend });
    return;
  }
  if (request.method !== "POST" || request.url !== "/sign") {
    send(response, 404, { error: "not found" });
    return;
  }

  let body: { authority?: string; message?: string };
  try {
    body = JSON.parse(await readBody(request)) as { authority?: string; message?: string };
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : "unreadable body" });
    return;
  }

  const authority = String(body.authority ?? "");
  const encoded = String(body.message ?? "");
  if (!/^[A-Z]{3}$/.test(authority) || encoded === "") {
    send(response, 400, { error: "authority and message are required" });
    return;
  }

  const expected = createHmac("sha256", key).update(`${authority}\n${encoded}`).digest("base64");
  if (!macMatches(request.headers["x-parallel-mac"] as string | undefined, expected)) {
    console.error(`${RED}${stamp()} signer: rejected an unauthenticated request${OFF}`);
    send(response, 401, { error: "unauthenticated" });
    return;
  }

  const messageBytes = Buffer.from(encoded, "base64");
  const refusal = refusalReason(messageBytes, authority, registry);
  if (refusal) {
    console.error(`${RED}${stamp()} signer: refused ${authority} — ${refusal}${OFF}`);
    send(response, 403, { error: `refused: ${refusal}` });
    return;
  }

  try {
    const signature = await signFor(authority, messageBytes, registry, backend);
    console.log(`${DIM}${stamp()} signer: signed a ${authority} trade${OFF}`);
    send(response, 200, { signature: signature.toString("base64") });
  } catch (error) {
    console.error(`${RED}${stamp()} signer: ${error instanceof Error ? error.message : error}${OFF}`);
    send(response, 500, { error: "signing failed" });
  }
}

async function main(): Promise<void> {
  stayAlive("signer");
  const port = Number(
    process.argv.find((arg) => arg.startsWith("--port="))?.split("=")[1] ??
      process.env.PARALLEL_SIGNER_PORT ??
      8787,
  );
  const registry = loadRegistry();
  if (!registry) throw new Error("market-registry.json is missing — run the market creation first");
  const key = secret();
  const backend = keyBackend();

  // Loopback by default. A signer reachable from the network is a key
  // reachable from the network; binding wider should be a deliberate act.
  const host = process.env.PARALLEL_SIGNER_HOST ?? "127.0.0.1";

  const server = createServer((request, response) => {
    void handle(request, response, registry, key, backend).catch(() =>
      send(response, 500, { error: "failed" }),
    );
  });
  server.listen(port, host, () => {
    console.log(
      `signer: listening on http://${host}:${port} for ${registry.markets.length} markets\n` +
        `${DIM}  signing only Percolator trades against registry markets · keys: ${backend}${OFF}`,
    );
  });
}

void main().catch((error: unknown) => {
  console.error(`${RED}signer failed to start:${OFF} ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
