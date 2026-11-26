import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, sign as signBytes } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { issueChallenge, verifyChallenge } from "@/lib/server/wallet-proof";
import { Rejection } from "@/lib/server/respond";

/** Sign as a Solana wallet would: ed25519 over the raw message bytes. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function walletSign(keypair: Keypair, message: string): Buffer {
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(keypair.secretKey.subarray(0, 32))]),
    format: "der",
    type: "pkcs8",
  });
  return signBytes(null, Buffer.from(message, "utf8"), key);
}

const expectRejection = (run: () => unknown, expecting: RegExp): void => {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof Rejection, `expected a Rejection, got ${String(error)}`);
    assert.match(error.message, expecting);
    return true;
  });
};

test("a wallet's own signature over its own challenge is accepted", () => {
  const wallet = Keypair.generate();
  const challenge = issueChallenge(wallet.publicKey, "faucet");
  assert.match(challenge.message, /prove you hold this wallet/);
  assert.match(challenge.message, new RegExp(wallet.publicKey.toBase58()));
  verifyChallenge({
    wallet: wallet.publicKey,
    purpose: "faucet",
    token: challenge.token,
    signature: walletSign(wallet, challenge.message),
  });
});

test("another wallet's signature over the same challenge is refused", () => {
  const wallet = Keypair.generate();
  const stranger = Keypair.generate();
  const challenge = issueChallenge(wallet.publicKey, "faucet");
  expectRejection(
    () =>
      verifyChallenge({
        wallet: wallet.publicKey,
        purpose: "faucet",
        token: challenge.token,
        signature: walletSign(stranger, challenge.message),
      }),
    /does not match this wallet/,
  );
});

test("a challenge cannot be redirected at a different wallet", () => {
  const wallet = Keypair.generate();
  const stranger = Keypair.generate();
  const challenge = issueChallenge(wallet.publicKey, "faucet");
  // The stranger signs honestly — for a challenge that names someone else.
  expectRejection(
    () =>
      verifyChallenge({
        wallet: stranger.publicKey,
        purpose: "faucet",
        token: challenge.token,
        signature: walletSign(stranger, challenge.message),
      }),
    /issued for a different wallet/,
  );
});

test("a signature over different words does not verify", () => {
  const wallet = Keypair.generate();
  const challenge = issueChallenge(wallet.publicKey, "faucet");
  expectRejection(
    () =>
      verifyChallenge({
        wallet: wallet.publicKey,
        purpose: "faucet",
        token: challenge.token,
        signature: walletSign(wallet, `${challenge.message} and also mint me more`),
      }),
    /does not match this wallet/,
  );
});

test("a garbage signature is a refusal rather than a crash", () => {
  const wallet = Keypair.generate();
  const challenge = issueChallenge(wallet.publicKey, "faucet");
  expectRejection(
    () =>
      verifyChallenge({
        wallet: wallet.publicKey,
        purpose: "faucet",
        token: challenge.token,
        signature: Buffer.alloc(64, 9),
      }),
    /does not match this wallet/,
  );
});
