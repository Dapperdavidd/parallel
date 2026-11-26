import "server-only";

import { createPublicKey, verify } from "node:crypto";
import type { PublicKey } from "@solana/web3.js";
import { open, sign } from "./tokens";
import { Rejection } from "./respond";

/**
 * Proof that the browser asking for something holds the wallet it names.
 *
 * The faucet mints real devnet balances. Before this, it minted them to *any*
 * address in a POST body, which made it a free top-up service for every wallet
 * on devnet and a way to drain our mint authority's SOL. Being authenticated
 * is not enough either: a signed-in user could still name somebody else's
 * address.
 *
 * So the wallet signs. The server issues a challenge it can rebuild from the
 * token alone, the wallet signs that exact text, and the signature is checked
 * against the address being funded. Nothing is stored between the two calls.
 *
 * Solana keys are ed25519, and Node verifies ed25519 natively — the 32 raw
 * bytes of a public key become a key object by wrapping them in the fixed
 * 12-byte SPKI prefix for that curve. No signature library, so no dependency
 * holding a key-handling CVE.
 */

const KIND = "wallet-proof";
const TTL_MS = 5 * 60_000;
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type Purpose = "faucet";

interface Payload {
  wallet: string;
  purpose: Purpose;
  issued: string;
}

/**
 * The words the wallet is asked to sign.
 *
 * Written to be read by the person approving it: a signing prompt that says
 * nothing is a prompt people learn to approve blindly. Rebuilt from the signed
 * payload at verification time, so the two can never disagree.
 */
function challengeText(payload: Payload, nonce: string): string {
  return [
    "Parallel — prove you hold this wallet",
    "",
    `Wallet:  ${payload.wallet}`,
    `For:     ${payload.purpose === "faucet" ? "devnet test funds" : payload.purpose}`,
    `Issued:  ${payload.issued}`,
    `Nonce:   ${nonce}`,
    "",
    "Signing costs nothing and moves nothing. Parallel is devnet only.",
  ].join("\n");
}

export interface Challenge {
  /** Exactly what the wallet must sign, byte for byte. */
  readonly message: string;
  /** Returned with the signature so the server can rebuild the message. */
  readonly token: string;
  readonly expiresInSeconds: number;
}

export function issueChallenge(wallet: PublicKey, purpose: Purpose): Challenge {
  const payload: Payload = {
    wallet: wallet.toBase58(),
    purpose,
    issued: new Date().toISOString(),
  };
  const token = sign(KIND, payload, TTL_MS);
  const { nonce } = open<Payload>(KIND, token);
  return {
    message: challengeText(payload, nonce),
    token,
    expiresInSeconds: Math.floor(TTL_MS / 1000),
  };
}

/** Throws unless this signature is this wallet's, over this challenge. */
export function verifyChallenge(input: {
  wallet: PublicKey;
  purpose: Purpose;
  token: string;
  signature: Buffer;
}): void {
  const { payload, nonce } = open<Payload>(KIND, input.token);
  if (payload.wallet !== input.wallet.toBase58()) {
    throw new Rejection("forbidden", "This proof was issued for a different wallet");
  }
  if (payload.purpose !== input.purpose) {
    throw new Rejection("forbidden", "This proof was issued for something else");
  }

  const key = createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(input.wallet.toBytes())]),
    format: "der",
    type: "spki",
  });
  const message = Buffer.from(challengeText(payload, nonce), "utf8");
  if (!verify(null, message, key, input.signature)) {
    throw new Rejection("forbidden", "That signature does not match this wallet");
  }
}
