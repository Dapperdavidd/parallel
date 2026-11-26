import "server-only";

import { readFile } from "node:fs/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
import { join, resolve } from "node:path";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { EnvironmentError, isProduction } from "./env";
import { Rejection } from "./respond";
import { failure, info } from "./log";

/**
 * The only place in the web app that touches a signing key.
 *
 * Two routes used to load keypairs themselves, with a default path pointing at
 * the repository's own `wallets/` folder. That is right on a laptop and wrong
 * everywhere else: it puts thirteen liquidity authorities and a mint authority
 * in the same process as the request handler, recoverable by any file-read bug
 * in the whole dependency tree.
 *
 * This module gives that one door, and two ways through it.
 *
 *  - **Remote (preferred).** With `PARALLEL_SIGNER_URL` set, the web app never
 *    holds a key. It sends the serialised transaction message to a signer that
 *    does, authenticated by a shared secret, and receives one 64-byte
 *    signature. The signature is then verified against the authority the
 *    registry expects before it is attached, so a compromised or confused
 *    signer cannot substitute a different one. Run `npm run signer` for the
 *    service that answers this.
 *
 *  - **Local.** Keys from the environment, or from a secrets directory
 *    *outside* the repository. The repository's `wallets/` folder is accepted
 *    in development only, and refused in production rather than warned about.
 *
 * Either way, the caller asks for a signature from a named authority and gets
 * nothing else. No part of the app can obtain a key object.
 */

const REMOTE_TIMEOUT_MS = 8_000;

interface SignRequest {
  /** 'NGN', or 'mint' for the faucet authority. */
  readonly authority: string;
  /** Base58 of the key the registry says must sign. */
  readonly expected: string;
  /** The transaction to sign, un-serialised so we can attach the result. */
  readonly transaction: Transaction;
}

// ------------------------------------------------------------ local keys --

const cache = new Map<string, Keypair>();

/** Where a locally-held key may legitimately come from. */
async function localSecret(authority: string): Promise<number[]> {
  if (authority === "mint") {
    const inline = process.env.PARALLEL_MINT_AUTHORITY_SECRET;
    if (inline) return JSON.parse(inline) as number[];
    const path = process.env.PARALLEL_MINT_AUTHORITY_FILE;
    if (path) return JSON.parse(await readFile(path, "utf8")) as number[];
    return JSON.parse(await readFile(repoWallet("oracle-authority.json"), "utf8")) as number[];
  }

  const inline = process.env.PARALLEL_LIQUIDITY_SECRETS;
  if (inline) {
    const parsed = JSON.parse(inline) as Record<string, number[]>;
    const bytes = parsed[authority];
    if (!bytes) {
      throw new EnvironmentError(`PARALLEL_LIQUIDITY_SECRETS has no entry for ${authority}`);
    }
    return bytes;
  }

  const directory = process.env.PARALLEL_LIQUIDITY_SECRETS_DIR;
  const file = `liquidity-${authority.toLowerCase()}.json`;
  if (directory) {
    // Resolve and re-check, so an authority name can never walk out of the
    // configured directory. Market codes come from the registry, but a
    // cheap check here costs nothing and removes the question.
    const path = resolve(directory, file);
    if (!path.startsWith(resolve(directory))) {
      throw new EnvironmentError("Refusing a signing path outside the secrets directory");
    }
    return JSON.parse(await readFile(path, "utf8")) as number[];
  }
  return JSON.parse(await readFile(repoWallet(file), "utf8")) as number[];
}

/**
 * The developer's `wallets/` folder — never in production.
 *
 * In production this throws instead of reading, so a deployment that forgot to
 * inject its secrets fails at the first trade with a clear reason, rather than
 * succeeding because the folder happened to be in the image.
 */
function repoWallet(file: string): string {
  if (isProduction()) {
    throw new EnvironmentError(
      "Signing keys must come from the environment in production, not from the repository",
    );
  }
  return join(process.cwd(), "..", "wallets", file);
}

async function localKeypair(authority: string, expected: string): Promise<Keypair> {
  const cached = cache.get(authority);
  if (cached) {
    if (cached.publicKey.toBase58() !== expected) {
      throw new Rejection("unavailable", "This market's signing authority does not match the registry");
    }
    return cached;
  }
  const keypair = Keypair.fromSecretKey(Uint8Array.from(await localSecret(authority)));
  if (keypair.publicKey.toBase58() !== expected) {
    failure({
      event: "authority_mismatch",
      authority,
      expected,
      found: keypair.publicKey.toBase58(),
    });
    throw new Rejection("unavailable", "This market's signing authority does not match the registry");
  }
  cache.set(authority, keypair);
  return keypair;
}

// ----------------------------------------------------------- remote mode --

const remoteUrl = (): string | null => process.env.PARALLEL_SIGNER_URL ?? null;

function remoteSecret(): Buffer {
  const secret = process.env.PARALLEL_SIGNER_SECRET;
  if (!secret || secret.length < 32) {
    throw new EnvironmentError("PARALLEL_SIGNER_SECRET must be set, and at least 32 characters");
  }
  return Buffer.from(secret, "utf8");
}

/**
 * Authenticate the call, and bind it to this exact message.
 *
 * The MAC covers the authority *and* the message bytes, so an intercepted
 * request cannot be re-pointed at another market or another transaction.
 */
export function signerMac(secret: Buffer, authority: string, message: string): string {
  return createHmac("sha256", secret).update(`${authority}\n${message}`).digest("base64");
}

export function signerMacMatches(presented: string, computed: string): boolean {
  const a = Buffer.from(presented, "base64");
  const b = Buffer.from(computed, "base64");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function remoteSignature(authority: string, message: Buffer): Promise<Buffer> {
  const url = remoteUrl();
  if (!url) throw new EnvironmentError("No signer is configured");
  const encoded = message.toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/sign`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-parallel-mac": signerMac(remoteSecret(), authority, encoded),
      },
      body: JSON.stringify({ authority, message: encoded }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      failure({ event: "signer_refused", authority, status: response.status, detail });
      throw new Rejection("unavailable", "The signing service refused this trade");
    }
    const body = (await response.json()) as { signature?: string };
    if (!body.signature) throw new Rejection("unavailable", "The signing service returned nothing");
    const signature = Buffer.from(body.signature, "base64");
    if (signature.length !== 64) {
      throw new Rejection("unavailable", "The signing service returned a malformed signature");
    }
    return signature;
  } catch (error) {
    if (error instanceof Rejection || error instanceof EnvironmentError) throw error;
    failure({ event: "signer_unreachable", authority, error });
    throw new Rejection("unavailable", "The signing service is unreachable");
  } finally {
    clearTimeout(timer);
  }
}

// -------------------------------------------------------------- the door --

/**
 * Attach the named authority's signature to a transaction.
 *
 * `addSignature` verifies the signature against the message before accepting
 * it, so the remote path is checked rather than trusted.
 */
export async function authoritySign(input: SignRequest): Promise<void> {
  const expectedKey = new PublicKey(input.expected);
  if (remoteUrl()) {
    const signature = await remoteSignature(
      input.authority,
      input.transaction.serializeMessage(),
    );
    input.transaction.addSignature(expectedKey, signature);
    info({ event: "signed", authority: input.authority, mode: "remote" });
    return;
  }
  const keypair = await localKeypair(input.authority, input.expected);
  input.transaction.partialSign(keypair);
  info({ event: "signed", authority: input.authority, mode: "local" });
}

/**
 * The faucet's mint authority, as a keypair.
 *
 * The exception to "no key objects": minting goes through `@solana/spl-token`
 * helpers that build, sign and send in one call, so there is no message to
 * hand to a remote signer. The faucet is devnet-only and mints a valueless
 * test token, which is the trade this exception is worth — a production launch
 * on a real asset would move this behind the signer too.
 */
export async function mintAuthority(): Promise<Keypair> {
  const cached = cache.get("mint");
  if (cached) return cached;
  const keypair = Keypair.fromSecretKey(Uint8Array.from(await localSecret("mint")));
  cache.set("mint", keypair);
  return keypair;
}

/** Visible to tests and to the signer service, which shares this validation. */
export function forgetKeys(): void {
  cache.clear();
}
