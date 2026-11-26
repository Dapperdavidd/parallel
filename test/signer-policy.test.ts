import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { refusalReason, TRADE_TAG } from "../src/lib/signer-policy.js";
import type { Registry } from "../src/lib/registry.js";

/**
 * Every case here is a transaction that, if the signer agreed to sign it,
 * would give a compromised web app something the signer exists to deny.
 */

const program = Keypair.generate().publicKey;
const authority = Keypair.generate();
const vaultPortfolio = Keypair.generate().publicKey;
const marketAccount = Keypair.generate().publicKey;
const otherMarket = Keypair.generate().publicKey;
const user = Keypair.generate();
const userPortfolio = Keypair.generate().publicKey;

const registry: Registry = {
  network: "devnet",
  percolatorProgram: program.toBase58(),
  collateralMint: Keypair.generate().publicKey.toBase58(),
  oracleAuthority: Keypair.generate().publicKey.toBase58(),
  markets: [
    {
      id: "USD/NGN",
      currency: "NGN",
      unit: 1_000,
      unitLabel: "kNGN",
      status: "live",
      maxLeverage: 5,
      market: marketAccount.toBase58(),
      vault: Keypair.generate().publicKey.toBase58(),
      assetIndex: 0,
      authMarkWire: "short",
      initialPriceE6: "694028",
      createdAt: new Date().toISOString(),
      liquidityVault: {
        authority: authority.publicKey.toBase58(),
        portfolio: vaultPortfolio.toBase58(),
        capitalAtoms: "50000000000",
        maxNotionalUsdc: 5_000,
        maxOpenInterestUsdc: 50_000,
        createdAt: new Date().toISOString(),
      },
    },
  ],
};

/** The trade instruction's byte layout, written out independently here. */
function tradeData(tag = TRADE_TAG): Buffer {
  const out = Buffer.alloc(1 + 2 + 16 + 8 + 8);
  out.writeUInt8(tag, 0);
  out.writeUInt16LE(0, 1);
  out.writeBigUInt64LE(1_000_000n, 3); // low half of the i128 size
  out.writeBigUInt64LE(694_028n, 19);
  return out;
}

function trade(overrides: {
  market?: PublicKey;
  vaultPortfolio?: PublicKey;
  authority?: PublicKey;
  tag?: number;
} = {}): TransactionInstruction {
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: user.publicKey, isSigner: true, isWritable: false },
      { pubkey: overrides.authority ?? authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: overrides.market ?? marketAccount, isSigner: false, isWritable: true },
      { pubkey: userPortfolio, isSigner: false, isWritable: true },
      { pubkey: overrides.vaultPortfolio ?? vaultPortfolio, isSigner: false, isWritable: true },
    ],
    data: tradeData(overrides.tag),
  });
}

/** Serialise as the web app would before asking for a signature. */
function message(instructions: TransactionInstruction[], feePayer = user.publicKey): Buffer {
  const tx = new Transaction().add(...instructions);
  tx.feePayer = feePayer;
  tx.recentBlockhash = bs58.encode(Buffer.alloc(32, 3));
  return tx.serializeMessage();
}

const budget = [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
  ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }),
];

test("an ordinary trade against a registry market is signed", () => {
  assert.equal(refusalReason(message([...budget, trade()]), "NGN", registry), null);
});

test("a trade with no compute-budget instructions is still fine", () => {
  assert.equal(refusalReason(message([trade()]), "NGN", registry), null);
});

test("an authority no market uses is refused", () => {
  assert.match(refusalReason(message([trade()]), "ZAR", registry) ?? "", /no market in the registry/);
});

test("a smuggled transfer is refused", () => {
  // The attack this check exists for: a real trade with the authority's SOL
  // quietly leaving in the same transaction.
  const theft = SystemProgram.transfer({
    fromPubkey: authority.publicKey,
    toPubkey: user.publicKey,
    lamports: 1_000_000_000,
  });
  // Two separate rules catch this — the foreign program, and the authority
  // becoming writable so it can be debited. Either refusal is correct.
  assert.match(
    refusalReason(message([...budget, trade(), theft]), "NGN", registry) ?? "",
    /unexpected program|may not be writable/,
  );
});

test("two Percolator instructions in one message are refused", () => {
  assert.match(
    refusalReason(message([trade(), trade()]), "NGN", registry) ?? "",
    /exactly one Percolator instruction, found 2/,
  );
});

test("a Percolator instruction that is not a trade is refused", () => {
  assert.match(
    refusalReason(message([trade({ tag: 3 })]), "NGN", registry) ?? "",
    /is not a trade/,
  );
});

test("a trade against a market outside the registry is refused", () => {
  assert.match(
    refusalReason(message([trade({ market: otherMarket })]), "NGN", registry) ?? "",
    /do not match the registry/,
  );
});

test("a trade paying into somebody else's vault portfolio is refused", () => {
  assert.match(
    refusalReason(
      message([trade({ vaultPortfolio: Keypair.generate().publicKey })]),
      "NGN",
      registry,
    ) ?? "",
    /do not match the registry/,
  );
});

test("a trade that does not name this authority as the vault signer is refused", () => {
  const stranger = Keypair.generate().publicKey;
  const reason = refusalReason(message([trade({ authority: stranger })]), "NGN", registry) ?? "";
  assert.match(reason, /does not include this authority|vault signer/);
});

test("the authority may not be made the fee payer", () => {
  // Fee payer pays, and is writable, so this is the other way to drain it.
  const reason =
    refusalReason(message([trade()], authority.publicKey), "NGN", registry) ?? "";
  assert.match(reason, /fee payer/);
});

test("bytes that are not a transaction are refused", () => {
  assert.match(
    refusalReason(Buffer.from("not a solana message at all"), "NGN", registry) ?? "",
    /does not parse/,
  );
  assert.match(refusalReason(Buffer.alloc(0), "NGN", registry) ?? "", /does not parse/);
});
